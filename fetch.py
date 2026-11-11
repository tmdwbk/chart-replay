#!/usr/bin/env python3
"""차트 리플레이용 1분봉 받기.

사용 예:
    python3 fetch.py SANDUSDT 2026-10-01 2026-10-31
    python3 fetch.py 1000PEPEUSDT 2026-10-01 2026-10-07
    python3 fetch.py BORA 2026-10-01 2026-10-07 --source upbit

- 날짜는 KST 기준이다. 시작일 00:00 ~ 끝날 23:59 (KST) 를 받는다.
- 1순위: 바이낸스 USDT-M 무기한 선물 공개 아카이브(data.binance.vision, 키 필요 없음).
- 바이낸스 선물에 없는 종목은 업비트 원화 현물 공개 API 로 받는다(현물·원화라고 표시해 둔다).
- 공개 데이터 GET 요청만 쓴다. API 키·주문 기능은 없다.

저장: data/{심볼}_{출처}_{시작}_{끝}.csv  +  data/index.json (리플레이 화면의 목록)
CSV 칸: time_kst, ts_utc(초), open, high, low, close, volume, quote_volume
"""

import argparse
import calendar
import csv
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import zipfile
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

KST = timezone(timedelta(hours=9))
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BINANCE_ROOT = "https://data.binance.vision/data/futures/um"
UPBIT_URL = "https://api.upbit.com/v1/candles/minutes/1"
HEADERS = {"User-Agent": "chart-replay/1.0"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- 바이낸스

def binance_get(url):
    """GET. 없으면 None, 그 밖의 오류는 예외."""
    for attempt in range(4):
        try:
            r = SESSION.get(url, timeout=60)
        except requests.RequestException as e:
            log(f"  연결 오류, 다시 시도 ({attempt + 1}/4): {e.__class__.__name__}")
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 404:
            return None
        if r.status_code == 200:
            return r.content
        log(f"  응답 {r.status_code}, 다시 시도 ({attempt + 1}/4)")
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"받기 실패: {url}")


def parse_binance_zip(zip_bytes, expected_sha256, workdir):
    """zip 을 새 빈 폴더에 저장하고, 체크섬을 확인한 뒤 안의 CSV 를 읽는다."""
    if expected_sha256:
        got = hashlib.sha256(zip_bytes).hexdigest()
        if got != expected_sha256:
            raise RuntimeError("체크섬이 맞지 않습니다. 파일이 깨졌을 수 있어요.")
    zpath = workdir / "download.zip"
    zpath.write_bytes(zip_bytes)
    rows = []
    with zipfile.ZipFile(zpath) as zf:
        for name in zf.namelist():
            if not name.endswith(".csv") or "/" in name or "\\" in name or ".." in name:
                continue
            text = zf.read(name).decode("utf-8", errors="replace")
            for rec in csv.reader(io.StringIO(text)):
                if not rec or not rec[0].strip().isdigit():
                    continue  # 머리글 줄
                t = int(rec[0])
                if t > 10**14:  # 마이크로초로 오는 경우
                    t //= 1000
                rows.append((t // 1000, rec[1], rec[2], rec[3], rec[4], rec[5], rec[7], rec[9] if len(rec) > 9 else ""))
    zpath.unlink()
    return rows


_FILE_CACHE = OrderedDict()  # 달별로 나눠 받을 때 경계 달 파일을 두 번 받지 않도록 최근 2개만 기억
_MISSING = set()


def binance_file(kind, symbol, stamp, workdir):
    """kind: monthly/daily, stamp: 2026-10 또는 2026-10-05. 없으면 None."""
    key = (kind, symbol, stamp)
    if key in _MISSING:
        return None
    if key in _FILE_CACHE:
        _FILE_CACHE.move_to_end(key)
        return _FILE_CACHE[key]
    fname = f"{symbol}-1m-{stamp}.zip"
    url = f"{BINANCE_ROOT}/{kind}/klines/{symbol}/1m/{fname}"
    chk = binance_get(url + ".CHECKSUM")
    data = None if chk is None else binance_get(url)
    if data is None:
        _MISSING.add(key)
        return None
    expected = chk.decode().split()[0].strip().lower()
    rows = parse_binance_zip(data, expected, workdir)
    _FILE_CACHE[key] = rows
    while len(_FILE_CACHE) > 2:
        _FILE_CACHE.popitem(last=False)
    return rows


def binance_has(symbol, start_utc, end_utc):
    """이 기간에 바이낸스 선물 파일이 하나라도 있는지 체크섬 파일(아주 작음)만 GET 해서 확인."""
    first_day = start_utc.date()
    last_day = (end_utc - timedelta(seconds=1)).date()
    today_utc = datetime.now(timezone.utc).date()
    for y, m in month_iter(first_day, last_day):
        month_end = date(y, m, calendar.monthrange(y, m)[1])
        if month_end < today_utc.replace(day=1):
            stamp, kind = f"{y}-{m:02d}", "monthly"
        else:
            d = min(month_end, last_day, today_utc - timedelta(days=1))
            stamp, kind = d.isoformat(), "daily"
        url = f"{BINANCE_ROOT}/{kind}/klines/{symbol}/1m/{symbol}-1m-{stamp}.zip.CHECKSUM"
        if binance_get(url) is not None:
            return True
    return False


def resolve_binance_symbol(sym, start_utc, end_utc):
    """SANDUSDT / PEPEUSDT.P / PEPE 같은 입력을 바이낸스 선물 심볼로. 못 찾으면 None.
    PEPE·SHIB·BONK 처럼 바이낸스 선물에 1000개 묶음으로만 있는 종목은 1000 을 붙여 다시 찾는다."""
    s = sym.upper().strip()
    for suffix in (".P", ".PERP", "PERP"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    if not s.endswith("USDT"):
        s += "USDT"
    candidates = [s] if s.startswith("1000") else [s, "1000" + s]
    for c in candidates:
        if binance_has(c, start_utc, end_utc):
            if c != s:
                log(f"  {s} 는 없고 {c} (1000개 묶음, 가격 1000배)로 있어요. {c} 로 받습니다.")
            return c
    return None


def month_iter(d0, d1):
    y, m = d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def fetch_binance(symbol, start_utc, end_utc):
    """[start_utc, end_utc) 구간. 종목이 없으면 None."""
    first_day = start_utc.date()
    last_day = (end_utc - timedelta(seconds=1)).date()
    today_utc = datetime.now(timezone.utc).date()
    workdir = Path(tempfile.mkdtemp(prefix="chart-replay-zip-"))
    rows = []
    found_any = False
    try:
        for y, m in month_iter(first_day, last_day):
            month_start = date(y, m, 1)
            month_end = date(y, m, calendar.monthrange(y, m)[1])
            got = None
            if month_end < today_utc.replace(day=1):  # 끝난 달만 월별 파일이 있다
                log(f"  월별 파일 {y}-{m:02d} 받는 중…")
                got = binance_file("monthly", symbol, f"{y}-{m:02d}", workdir)
            if got is not None:
                found_any = True
                rows.extend(got)
                continue
            d = max(month_start, first_day)
            stop = min(month_end, last_day)
            while d <= stop:
                if d >= today_utc:
                    log(f"  {d} (UTC) 일별 파일은 아직 없어요(다음 날 올라옴). 건너뜀.")
                    d += timedelta(days=1)
                    continue
                log(f"  일별 파일 {d} 받는 중…")
                got = binance_file("daily", symbol, d.isoformat(), workdir)
                if got is None:
                    log(f"  {d} 파일 없음(상장 전이거나 아직 안 올라옴)")
                else:
                    found_any = True
                    rows.extend(got)
                d += timedelta(days=1)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    if not found_any:
        return None
    s, e = int(start_utc.timestamp()), int(end_utc.timestamp())
    return [r for r in rows if s <= r[0] < e]


# ---------------------------------------------------------------- 업비트

def fetch_upbit(market, start_utc, end_utc):
    """업비트 원화 현물 1분봉. 최신 → 과거 방향으로 200개씩 넘긴다."""
    s, e = int(start_utc.timestamp()), int(end_utc.timestamp())
    cursor = end_utc
    rows = {}
    calls = 0
    while True:
        params = {"market": market, "count": 200,
                  "to": cursor.strftime("%Y-%m-%dT%H:%M:%SZ")}
        r = SESSION.get(UPBIT_URL, params=params, timeout=30)
        calls += 1
        if r.status_code == 429:
            log("  호출 한도에 걸려 잠시 쉼…")
            time.sleep(2)
            continue
        if r.status_code == 404 or (r.status_code == 400 and calls == 1):
            return None
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        oldest = None
        for c in batch:
            t = int(datetime.strptime(c["candle_date_time_utc"], "%Y-%m-%dT%H:%M:%S")
                    .replace(tzinfo=timezone.utc).timestamp())
            oldest = t if oldest is None else min(oldest, t)
            if s <= t < e:
                rows[t] = (t, c["opening_price"], c["high_price"], c["low_price"],
                           c["trade_price"], c["candle_acc_trade_volume"],
                           c["candle_acc_trade_price"], "")  # 업비트 캔들에는 매수·매도 구분이 없음
        if calls % 20 == 0:
            log(f"  {datetime.fromtimestamp(oldest, KST):%Y-%m-%d %H:%M} (KST) 까지 받음…")
        if oldest <= s:
            break
        cursor = datetime.fromtimestamp(oldest, timezone.utc)
        time.sleep(0.15)  # 초당 10회 한도보다 느리게
    return [rows[k] for k in sorted(rows)]


# ---------------------------------------------------------------- 저장

def _write_json(path, obj):
    """다른 종목을 동시에 받아도 깨지지 않게 임시 파일에 쓰고 바꿔치기."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    os.replace(tmp, path)


def rebuild_index():
    """data/<심볼>/index.json 들을 모아 data/index.json (리플레이 화면 목록)을 다시 만든다."""
    entries = []
    for sub in sorted(DATA_DIR.glob("*/index.json")):
        try:
            entries.extend(json.loads(sub.read_text()))
        except ValueError:
            pass
    entries.sort(key=lambda x: (x["symbol"], x["start"]))
    _write_json(DATA_DIR / "index.json", entries)
    secs = []
    for sub in sorted(DATA_DIR.glob("*/sec/index.json")):
        try:
            secs.extend(json.loads(sub.read_text()))
        except ValueError:
            pass
    secs.sort(key=lambda x: (x["symbol"], x["day"]))
    _write_json(DATA_DIR / "sec_index.json", secs)


# ---------------------------------------------------------------- 1초봉 (1분봉이 만들어지는 과정 보기용)
# 바이낸스 선물 체결 내역(aggTrades, 공개 아카이브)을 하루씩 받아 1초 단위 시고저종·거래량으로 묶는다.
# 체결 내역 원본은 크다(페페 하루 15~100MB 압축). 1초봉으로 줄이면 하루 1MB 안팎.

_SEC_CACHE = {}  # UTC 날짜 → {초: [o,h,l,c,v,qv]} (KST 하루가 UTC 이틀에 걸쳐서 바로 다음 날에 다시 씀)


def binance_seconds_utc_day(symbol, d, workdir):
    """UTC 하루치 aggTrades → 1초봉 dict. 파일이 없으면 None."""
    if d in _SEC_CACHE:
        return _SEC_CACHE[d]
    fname = f"{symbol}-aggTrades-{d.isoformat()}.zip"
    url = f"{BINANCE_ROOT}/daily/aggTrades/{symbol}/{fname}"
    chk = binance_get(url + ".CHECKSUM")
    if chk is None:
        return None
    log(f"  체결 내역 {d} (UTC) 받는 중…")
    data = binance_get(url)
    if data is None:
        return None
    if hashlib.sha256(data).hexdigest() != chk.decode().split()[0].strip().lower():
        raise RuntimeError("체크섬이 맞지 않습니다. 파일이 깨졌을 수 있어요.")
    zpath = workdir / "agg.zip"
    zpath.write_bytes(data)
    del data
    secs = {}
    with zipfile.ZipFile(zpath) as zf:
        for name in zf.namelist():
            if not name.endswith(".csv") or "/" in name or "\\" in name or ".." in name:
                continue
            with zf.open(name) as raw:
                for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
                    rec = line.split(",")
                    if len(rec) < 6 or not rec[0].isdigit():
                        continue  # 머리글
                    t = int(rec[5])
                    if t > 10**14:
                        t //= 1000
                    sec = t // 1000
                    px = float(rec[1]); q = float(rec[2])
                    buy = q if len(rec) > 6 and rec[6].strip().lower() == "false" else 0.0  # 사는 쪽이 시장가(테이커) = 매수 체결
                    b = secs.get(sec)
                    if b is None:
                        secs[sec] = [rec[1], px, px, rec[1], q, px * q, buy]
                    else:
                        if px > b[1]: b[1] = px
                        if px < b[2]: b[2] = px
                        b[3] = rec[1]; b[4] += q; b[5] += px * q; b[6] += buy
    zpath.unlink()
    time.sleep(0.3)  # 공개 서버에 몰아서 받지 않게
    if len(_SEC_CACHE) >= 2:
        _SEC_CACHE.pop(min(_SEC_CACHE))
    _SEC_CACHE[d] = secs
    return secs


def save_seconds(symbol, kst_day, rows):
    path = DATA_DIR / symbol / "sec" / f"{symbol}_1s_{kst_day:%Y%m%d}.csv.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", newline="", compresslevel=9) as f:
        w = csv.writer(f)
        w.writerow(["ts_utc", "open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume"])
        for sec, (o, h, l, c, v, qv, bv) in rows:
            w.writerow([sec, o, repr(h), repr(l), c, f"{v:.12g}", f"{qv:.4f}", f"{bv:.12g}"])
    os.replace(tmp, path)
    sub = path.parent / "index.json"
    idx = json.loads(sub.read_text()) if sub.exists() else []
    rel = f"{symbol}/sec/{path.name}"
    idx = [x for x in idx if x["file"] != rel]
    idx.append({"file": rel, "symbol": symbol, "day": kst_day.isoformat(), "rows": len(rows)})
    idx.sort(key=lambda x: x["day"])
    _write_json(sub, idx)
    rebuild_index()
    return path


def fetch_seconds(symbol, start_d, end_d):
    workdir = Path(tempfile.mkdtemp(prefix="chart-replay-agg-"))
    try:
        d = start_d
        while d <= end_d:
            path = DATA_DIR / symbol / "sec" / f"{symbol}_1s_{d:%Y%m%d}.csv.gz"
            if path.exists():
                log(f"[{d}] 이미 있어요. 건너뜀.")
                d += timedelta(days=1)
                continue
            log(f"[{d} KST]")
            s_utc, e_utc = kst_range(d, d)
            s, e = int(s_utc.timestamp()), int(e_utc.timestamp())
            rows = []
            missing = False
            for ud in (s_utc.date(), (e_utc - timedelta(seconds=1)).date()):
                secs = binance_seconds_utc_day(symbol, ud, workdir)
                if secs is None:
                    log(f"  {ud} (UTC) 체결 파일이 아직 없어요(하루 늦게 올라옴).")
                    missing = True
                    continue
                rows.extend((k, v) for k, v in secs.items() if s <= k < e)
            if missing or not rows:
                log("  이 날은 다 받지 못해 저장하지 않았어요.")
            else:
                rows.sort()
                save_seconds(symbol, d, rows)
                log(f"  저장: 1초봉 {len(rows):,}개 → {path.name}")
            d += timedelta(days=1)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def chunk_path(symbol, source, start_d, end_d):
    return DATA_DIR / symbol / f"{symbol}_{source}_{start_d:%Y%m%d}_{end_d:%Y%m%d}.csv.gz"


def save(rows, symbol, source, market_label, quote, start_d, end_d):
    """gzip 으로 압축한 CSV 로 저장(한 달 ≈ 1MB). 압축을 풀면 보통 CSV 와 같다."""
    rows = sorted({r[0]: r for r in rows}.values())
    path = chunk_path(symbol, source, start_d, end_d)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", newline="", compresslevel=9) as f:
        w = csv.writer(f)
        w.writerow(["time_kst", "ts_utc", "open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume"])
        for t, o, h, l, c, v, qv, bv in rows:
            w.writerow([datetime.fromtimestamp(t, KST).strftime("%Y-%m-%d %H:%M"), t, o, h, l, c, v, qv, bv])
    os.replace(tmp, path)

    sub_index = path.parent / "index.json"
    index = json.loads(sub_index.read_text()) if sub_index.exists() else []
    rel = f"{symbol}/{path.name}"
    # 같은 달을 다시 받았으면(예: 이번 달 갱신) 예전 조각을 바꾼다
    index = [x for x in index if x["file"] != rel and not (x["start"] <= end_d.isoformat() and x["end"] >= start_d.isoformat())]
    index.append({
        "file": rel, "symbol": symbol, "source": source, "market": market_label,
        "quote": quote, "start": start_d.isoformat(), "end": end_d.isoformat(), "rows": len(rows),
    })
    index.sort(key=lambda x: x["start"])
    _write_json(sub_index, index)
    rebuild_index()
    return path


def kst_range(d0, d1):
    """KST 날짜 [d0, d1] → UTC [시작, 끝)"""
    s = datetime(d0.year, d0.month, d0.day, tzinfo=KST).astimezone(timezone.utc)
    e = (datetime(d1.year, d1.month, d1.day, tzinfo=KST) + timedelta(days=1)).astimezone(timezone.utc)
    return s, e


def month_chunks(start_d, end_d):
    """[start_d, end_d] 를 KST 달 단위로 자른다. 예: 02-24~02-29, 03-01~03-31, …"""
    out = []
    d = start_d
    while d <= end_d:
        last = date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
        out.append((d, min(last, end_d)))
        d = last + timedelta(days=1)
    return out


def binance_first_month(symbol):
    """아카이브 목록(공개 GET)에서 이 심볼의 첫 월별 파일 달. 없으면 None."""
    url = ("https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
           f"?delimiter=/&prefix=data/futures/um/monthly/klines/{symbol}/1m/")
    r = SESSION.get(url, timeout=30)
    r.raise_for_status()
    found = re.findall(rf"{re.escape(symbol)}-1m-(\d{{4}})-(\d{{2}})\.zip<", r.text)
    if not found:
        return None
    y, m = min((int(a), int(b)) for a, b in found)
    return date(y, m, 1)


def normalize_symbol(sym):
    s = sym.upper().strip()
    for suffix in (".P", ".PERP", "PERP"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    return s


def run_chunks(chunks, fetch_one, symbol, source, market_label, quote, skip_done):
    total = 0
    this_month = datetime.now(KST).date().replace(day=1)
    for c0, c1 in chunks:
        path = chunk_path(symbol, source, c0, c1)
        # 지난달까지의 조각은 한 번 받으면 바뀌지 않으므로 건너뛴다(중간에 끊겨도 이어 받기)
        if skip_done and path.exists() and c1 < this_month:
            continue
        if len(chunks) > 1:
            log(f"[{symbol} {c0} ~ {c1}]")
        s, e = kst_range(c0, c1)
        rows = fetch_one(s, e)
        if not rows:
            log("  이 구간은 데이터가 없어 건너뜀.")
            continue
        save(rows, symbol, source, market_label, quote, c0, c1)
        total += len(rows)
        log(f"  저장: {len(rows):,}개 1분봉 → {path.name}")
    return total


def main():
    ap = argparse.ArgumentParser(description="차트 리플레이용 1분봉 받기 (날짜는 KST)")
    ap.add_argument("symbol", help="예: SANDUSDT, PEPEUSDT.P(→1000PEPEUSDT), DOGEUSDT, SOLUSDT, ETHUSDT, BORA")
    ap.add_argument("start", nargs="?", help="시작 날짜 KST, 예: 2026-10-01 (--all 이면 생략)")
    ap.add_argument("end", nargs="?", help="끝 날짜 KST(그날 23:59까지 포함) (--all 이면 생략)")
    ap.add_argument("--source", choices=["auto", "binance", "upbit"], default="auto",
                    help="auto: 바이낸스 선물에 없으면 업비트 원화 현물")
    ap.add_argument("--monthly", action="store_true",
                    help="긴 기간을 달마다 따로 저장 (리플레이 화면이 가벼워짐)")
    ap.add_argument("--all", action="store_true",
                    help="상장부터 어제까지 전체를 달마다 받기. 이미 받은 지난달 파일은 건너뜀(다시 돌리면 새 달만 추가)")
    ap.add_argument("--force", action="store_true",
                    help="--all 과 함께: 이미 받은 달도 다시 받기 (예: 매수 체결량 칸 추가)")
    ap.add_argument("--seconds", action="store_true",
                    help="1초봉(1분봉이 만들어지는 과정 보기용). 바이낸스 선물 체결 내역을 하루씩 받아 줄임. 끝 날짜를 빼면 하루만")
    a = ap.parse_args()

    if a.seconds:
        if a.all:
            base = normalize_symbol(a.symbol)
            base = base if base.endswith("USDT") else base + "USDT"
            bsym = sd = None
            for c in ([base] if base.startswith("1000") else [base, "1000" + base]):
                first = binance_first_month(c)
                if first:
                    bsym, sd = c, first
                    break
            if not bsym:
                sys.exit("바이낸스 선물에 없는 종목이라 1초봉을 만들 수 없어요.")
            ed = datetime.now(KST).date() - timedelta(days=1)
            log(f"{bsym} 1초봉 전체 {sd} ~ {ed} (KST). 이미 받은 날은 건너뜀. 원본이 커서 오래 걸려요(중간에 끊겨도 다시 돌리면 이어서).")
            fetch_seconds(bsym, sd, ed)
            return
        if not a.start:
            sys.exit("1초봉은 날짜를 적어 주세요. 예: python3 fetch.py PEPEUSDT.P 2024-03-05 --seconds")
        try:
            sd = date.fromisoformat(a.start)
            ed = date.fromisoformat(a.end) if a.end else sd
        except ValueError:
            sys.exit("날짜는 2026-10-01 같은 모양으로 적어 주세요.")
        if (ed - sd).days > 31:
            sys.exit("1초봉은 원본이 커서 한 번에 31일까지만 받아요. 전체는 --seconds --all")
        bsym = resolve_binance_symbol(normalize_symbol(a.symbol), *kst_range(sd, ed))
        if not bsym:
            sys.exit("바이낸스 선물에 없는 종목이라 1초봉을 만들 수 없어요(업비트 종목은 지원 안 함).")
        log(f"{bsym} 1초봉 {sd} ~ {ed} (KST) 를 만듭니다. 하루 원본 15~100MB 를 받아서 줄여요.")
        fetch_seconds(bsym, sd, ed)
        return

    yesterday = datetime.now(KST).date() - timedelta(days=1)
    if a.all:
        start_d, end_d = None, yesterday
    else:
        if not (a.start and a.end):
            sys.exit("시작·끝 날짜를 적거나 --all 을 붙여 주세요.")
        try:
            start_d = date.fromisoformat(a.start)
            end_d = date.fromisoformat(a.end)
        except ValueError:
            sys.exit("날짜는 2026-10-01 같은 모양으로 적어 주세요.")
        if end_d < start_d:
            sys.exit("끝 날짜가 시작 날짜보다 앞이에요.")
    monthly = a.monthly or a.all

    sym = normalize_symbol(a.symbol)
    if a.source in ("auto", "binance") and not sym.startswith("KRW-"):
        log(f"바이낸스 USDT-M 무기한 선물에서 {sym} 을(를) 찾는 중…")
        bsym = None
        if a.all:
            base = sym if sym.endswith("USDT") else sym + "USDT"
            for c in ([base] if base.startswith("1000") else [base, "1000" + base]):
                first = binance_first_month(c)
                if first:
                    bsym, start_d = c, first
                    if c != base:
                        log(f"  {base} 는 없고 {c} (1000개 묶음, 가격 1000배)로 있어요.")
                    log(f"  {c}: {first:%Y-%m} 부터 있어요.")
                    break
        else:
            bsym = resolve_binance_symbol(sym, *kst_range(start_d, end_d))
        if bsym:
            chunks = month_chunks(start_d, end_d) if monthly else [(start_d, end_d)]
            total = run_chunks(chunks, lambda s, e: fetch_binance(bsym, s, e), bsym, "binance",
                               "바이낸스 USDT-M 무기한 선물", "USDT", skip_done=a.all and not a.force)
            log(f"완료: 새로 받은 1분봉 {total:,}개 ({DATA_DIR / bsym})")
            return
        log("바이낸스 선물 아카이브에 이 종목(또는 이 기간)이 없어요.")
        if a.source == "binance":
            sys.exit(1)

    base = sym[4:] if sym.startswith("KRW-") else sym
    if base.endswith("USDT"):
        base = base[:-4]
    if base.startswith("1000"):
        base = base[4:]
    market = f"KRW-{base}"
    log(f"업비트 원화 현물 {market} 을(를) 받는 중… (현물·원화 가격이에요)")
    if a.all:
        start_d = date(2017, 10, 1)  # 업비트 원화 마켓 시작. 상장 전 달은 빈 응답 한 번으로 넘어감
    chunks = month_chunks(start_d, end_d) if monthly else [(start_d, end_d)]
    total = run_chunks(chunks, lambda s, e: fetch_upbit(market, s, e), market, "upbit",
                       "업비트 원화 현물 (선물 아님)", "KRW", skip_done=a.all and not a.force)
    if not total and not a.all:
        sys.exit(f"업비트에서도 {market} 데이터를 찾지 못했어요.")
    log(f"완료: 새로 받은 1분봉 {total:,}개")
    log("참고: 업비트는 거래가 없던 분의 봉이 비어 있어요.")


if __name__ == "__main__":
    main()
