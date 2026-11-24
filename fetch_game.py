#!/usr/bin/env python3
"""차트게임용 1분봉 받기 (2026-11-24 5분봉 → 1분봉).

사용 예:
    python3 fetch_game.py            # 30종목 정해진 기간을 모두 받기(이미 받은 달은 건너뜀)
    python3 fetch_game.py ETH SOL    # 몇 종목만
    python3 fetch_game.py --force    # 이미 받은 달도 다시 받기

- 차트게임은 '거래량이 많았던 때의 주요 알트코인' 차트를 랜덤으로 보여 준다. 종목·기간은 아래 GAME_COINS 에서만 고친다.
- 기간은 KST 달 단위(시작 달 1일 00:00 ~ 끝 달 말일 23:59 KST).
- 1순위: 바이낸스 USDT-M 무기한 선물 공개 아카이브(data.binance.vision) 5분봉.
  그 달 파일이 없으면 바이비트 공개 시세 API(linear, 5분봉)로 받는다. 둘 다 없으면 그 달은 빠진다.
- 공개 데이터 GET 요청만 쓴다. API 키·주문 기능은 없다.

저장: data/game/<심볼>/<심볼>_1m_<UTC 연-월>.csv.gz  +  data/game/index.json (게임 화면이 읽는 목록)
CSV 칸: ts_utc(초), open, high, low, close, volume, quote_volume, taker_buy_volume(바이낸스만)
"""

import calendar
import csv
import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fetch import BINANCE_ROOT, KST, SESSION, binance_get, log, parse_binance_zip

BASE_DIR = Path(__file__).resolve().parent
GAME_DIR = BASE_DIR / "data" / "game"
BYBIT_KLINE = "https://api.bybit.com/v5/market/kline"

# (짧은 이름, 한글 이름, 바이낸스·바이비트 심볼, [(시작 달, 끝 달), ...])  — 달은 KST
GAME_COINS = [
    ("ETH", "이더리움", "ETHUSDT", [("2021-01", "2021-11"), ("2025-07", "2025-08")]),
    ("XRP", "리플", "XRPUSDT", [("2021-03", "2021-04"), ("2024-11", "2025-07")]),
    ("BNB", "바이낸스코인", "BNBUSDT", [("2021-02", "2021-05"), ("2025-07", "2025-10")]),
    ("SOL", "솔라나", "SOLUSDT", [("2021-08", "2021-11"), ("2024-10", "2025-01")]),
    ("DOGE", "도지코인", "DOGEUSDT", [("2021-01", "2021-05"), ("2024-11", "2024-12")]),
    ("ADA", "카르다노", "ADAUSDT", [("2021-02", "2021-09"), ("2024-11", "2024-12")]),
    ("HYPE", "하이퍼리퀴드", "HYPEUSDT", [("2024-11", "2024-12"), ("2025-04", "2025-09"), ("2026-04", "2026-05")]),
    ("LINK", "체인링크", "LINKUSDT", [("2020-07", "2021-05"), ("2024-11", "2024-12")]),
    ("AVAX", "아발란체", "AVAXUSDT", [("2021-08", "2021-11")]),
    ("SUI", "수이", "SUIUSDT", [("2024-09", "2025-01")]),
    ("LTC", "라이트코인", "LTCUSDT", [("2021-04", "2021-05")]),
    ("DOT", "폴카닷", "DOTUSDT", [("2021-01", "2021-05"), ("2021-09", "2021-11")]),
    ("SHIB", "시바이누", "1000SHIBUSDT", [("2021-05", "2021-05"), ("2021-10", "2021-10")]),
    ("PEPE", "페페", "1000PEPEUSDT", [("2023-04", "2023-05"), ("2024-11", "2024-12")]),
    ("UNI", "유니스왑", "UNIUSDT", [("2021-02", "2021-05")]),
    ("AAVE", "에이브", "AAVEUSDT", [("2021-02", "2021-05"), ("2024-11", "2024-12")]),
    ("NEAR", "니어", "NEARUSDT", [("2021-10", "2022-01")]),
    ("WIF", "도그위프햇", "WIFUSDT", [("2024-02", "2024-03")]),
    ("APT", "앱토스", "APTUSDT", [("2023-01", "2023-01"), ("2024-02", "2024-03")]),
    ("ARB", "아비트럼", "ARBUSDT", [("2023-10", "2024-01")]),
    ("OP", "옵티미즘", "OPUSDT", [("2023-12", "2024-03")]),
    ("INJ", "인젝티브", "INJUSDT", [("2023-10", "2024-03")]),
    ("TIA", "셀레스티아", "TIAUSDT", [("2023-11", "2024-02")]),
    ("BONK", "봉크", "1000BONKUSDT", [("2023-11", "2023-12"), ("2024-11", "2024-11")]),
    ("SAND", "샌드박스", "SANDUSDT", [("2021-10", "2021-11")]),
    ("MANA", "디센트럴랜드", "MANAUSDT", [("2021-10", "2021-11")]),
    ("AXS", "엑시인피니티", "AXSUSDT", [("2021-07", "2021-11")]),
    ("ATOM", "코스모스", "ATOMUSDT", [("2021-07", "2021-09")]),
    ("FIL", "파일코인", "FILUSDT", [("2021-03", "2021-04")]),
    ("LUNA", "테라", "LUNAUSDT", [("2021-07", "2022-04")]),  # 2022-05 붕괴 구간 제외(상승장만)
]


def ym(s):
    y, m = s.split("-")
    return int(y), int(m)


def kst_period_utc(a, b):
    """KST 'YYYY-MM'~'YYYY-MM' → UTC 초 [시작, 끝)"""
    y0, m0 = ym(a)
    y1, m1 = ym(b)
    s = datetime(y0, m0, 1, tzinfo=KST)
    e = datetime(y1, m1, calendar.monthrange(y1, m1)[1], tzinfo=KST) + timedelta(days=1)
    return int(s.timestamp()), int(e.timestamp())


def utc_months(s, e):
    """UTC 초 [s, e) 에 걸치는 UTC 달 목록"""
    d0 = datetime.fromtimestamp(s, timezone.utc).date().replace(day=1)
    d1 = datetime.fromtimestamp(e - 1, timezone.utc).date()
    out = []
    y, m = d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def month_path(sym, y, m):
    return GAME_DIR / sym / f"{sym}_1m_{y}-{m:02d}.csv.gz"


def fetch_binance_month(sym, y, m, workdir):
    url = f"{BINANCE_ROOT}/monthly/klines/{sym}/1m/{sym}-1m-{y}-{m:02d}.zip"
    chk = binance_get(url + ".CHECKSUM")
    if chk is None:
        return None
    data = binance_get(url)
    if data is None:
        return None
    rows = parse_binance_zip(data, chk.decode().split()[0].strip().lower(), workdir)
    return [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in rows]   # 마지막 칸 = 시장가 매수 체결량


def fetch_bybit_month(sym, y, m):
    """바이비트 공개 시세(linear) 1분봉. 최신 → 과거 방향으로 1000개씩 (한 달 약 45쪽)."""
    s = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp())
    e = int((datetime(y, m, calendar.monthrange(y, m)[1], tzinfo=timezone.utc) + timedelta(days=1)).timestamp())
    rows = {}
    end_ms = e * 1000 - 1
    for _ in range(60):
        for attempt in range(4):
            try:
                r = SESSION.get(BYBIT_KLINE, params={"category": "linear", "symbol": sym, "interval": "1",
                                                     "start": s * 1000, "end": end_ms, "limit": 1000}, timeout=30)
                break
            except Exception as ex:  # 연결 오류만 다시 시도
                log(f"  연결 오류, 다시 시도 ({attempt + 1}/4): {ex.__class__.__name__}")
                time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError("바이비트 받기 실패")
        if r.status_code != 200:
            return None
        j = r.json()
        if j.get("retCode") != 0:
            return None
        lst = j.get("result", {}).get("list") or []
        if not lst:
            break
        oldest = None
        for c in lst:
            t = int(c[0]) // 1000
            oldest = t if oldest is None else min(oldest, t)
            if s <= t < e:
                rows[t] = (t, c[1], c[2], c[3], c[4], c[5], c[6], "")   # 바이비트 캔들엔 매수 체결량이 없음
        if oldest <= s:
            break
        end_ms = oldest * 1000 - 1
        time.sleep(0.2)
    if not rows:
        return None
    return [rows[k] for k in sorted(rows)]


# ---------------------------------------------------------------- 펀딩비 (실전 수수료 모드에서 씀)
BYBIT_FUNDING = "https://api.bybit.com/v5/market/funding/history"


def funding_path(sym, y, m):
    return GAME_DIR / sym / f"{sym}_funding_{y}-{m:02d}.csv.gz"


def fetch_binance_funding(sym, y, m):
    """바이낸스 공개 아카이브의 그 달 펀딩비. [(정산 시각 초, 펀딩비), ...]. 메모리에서만 읽는다."""
    url = f"{BINANCE_ROOT}/monthly/fundingRate/{sym}/{sym}-fundingRate-{y}-{m:02d}.zip"
    chk = binance_get(url + ".CHECKSUM")
    data = binance_get(url) if chk is not None else None
    if data is None:
        return None
    if hashlib.sha256(data).hexdigest() != chk.decode().split()[0].strip().lower():
        raise RuntimeError("펀딩비 파일 체크섬이 맞지 않습니다")
    rows = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            if not name.endswith(".csv"):
                continue
            for line in zf.read(name).decode("utf-8").splitlines():
                parts = line.split(",")
                if len(parts) < 3 or not parts[0].strip().isdigit():
                    continue                      # 머리줄
                rows.append((round(int(parts[0]) / 1000 / 60) * 60, parts[2].strip()))   # 정산 시각(분 단위로 맞춤)
    return rows or None


def fetch_bybit_funding(sym, y, m):
    s = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp()) * 1000
    e = int((datetime(y, m, calendar.monthrange(y, m)[1], tzinfo=timezone.utc) + timedelta(days=1)).timestamp()) * 1000
    rows, end = {}, e - 1
    for _ in range(20):
        try:
            r = SESSION.get(BYBIT_FUNDING, params={"category": "linear", "symbol": sym, "startTime": s, "endTime": end, "limit": 200}, timeout=30)
        except Exception:
            time.sleep(2)
            continue
        if r.status_code != 200 or r.json().get("retCode") != 0:
            return None
        lst = r.json().get("result", {}).get("list") or []
        if not lst:
            break
        oldest = min(int(c["fundingRateTimestamp"]) for c in lst)
        for c in lst:
            t = int(c["fundingRateTimestamp"])
            if s <= t < e:
                rows[t // 1000] = c["fundingRate"]
        if oldest <= s or len(lst) < 200:
            break
        end = oldest - 1
        time.sleep(0.2)
    return sorted(rows.items()) or None


def save_funding(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", newline="", compresslevel=9, encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ts_utc", "funding_rate"])
        for row in sorted(dict(rows).items()):
            w.writerow(row)
    os.replace(tmp, path)


def save_month(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", newline="", compresslevel=9, encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ts_utc", "open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume"])
        for row in sorted({r[0]: r for r in rows}.values()):
            w.writerow(row)
    os.replace(tmp, path)


def write_index():
    """받아 둔 달 파일로 data/game/index.json 을 다시 만든다. 기간마다 실제로 데이터가 있는 범위를 적는다."""
    coins = []
    missing = []
    for short, ko, sym, periods in GAME_COINS:
        src_path = GAME_DIR / sym / "sources.json"
        sources = json.loads(src_path.read_text(encoding="utf-8")) if src_path.exists() else {}
        files = {}
        for p in sorted((GAME_DIR / sym).glob(f"{sym}_1m_*.csv.gz")):
            files[p.name.split("_1m_")[1][:7]] = f"game/{sym}/{p.name}"
        funding = {}
        for p in sorted((GAME_DIR / sym).glob(f"{sym}_funding_*.csv.gz")):
            funding[p.name.split("_funding_")[1][:7]] = f"game/{sym}/{p.name}"
        out = []
        for a, b in periods:
            s, e = kst_period_utc(a, b)
            months = utc_months(s, e)
            have = [f"{y}-{m:02d}" for y, m in months if f"{y}-{m:02d}" in files]
            lack = [f"{y}-{m:02d}" for y, m in months if f"{y}-{m:02d}" not in files]
            if lack:
                missing.append(f"{short} {a}~{b}: UTC {', '.join(lack)} 없음")
            if have:
                out.append({"from": a, "to": b, "start": s, "end": e,
                            "files": {k: files[k] for k in have},
                            "funding": {k: funding[k] for k in have if k in funding},
                            "sources": sorted({sources.get(k, "binance") for k in have})})
        if out:
            coins.append({"short": short, "name": ko, "symbol": sym, "periods": out})
    GAME_DIR.mkdir(parents=True, exist_ok=True)
    tmp = GAME_DIR / ".index.json.tmp"
    tmp.write_text(json.dumps({"interval": "1m", "coins": coins, "missing": missing}, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, GAME_DIR / "index.json")
    return coins, missing


def main():
    force = '--force' in sys.argv
    want = {a.upper() for a in sys.argv[1:] if not a.startswith('--')}
    today = datetime.now(timezone.utc).date().replace(day=1)
    workdir = Path(tempfile.mkdtemp(prefix="chart-game-zip-"))
    try:
        for short, ko, sym, periods in GAME_COINS:
            if want and short not in want and sym not in want:
                continue
            src_path = GAME_DIR / sym / "sources.json"
            sources = json.loads(src_path.read_text(encoding="utf-8")) if src_path.exists() else {}
            months = sorted({ym_ for a, b in periods for ym_ in utc_months(*kst_period_utc(a, b))})
            log(f"[{short} {ko}] {sym} {len(months)}달")
            for y, m in months:                   # 펀딩비: 달마다 작은 파일 (없던 것만)
                fp = funding_path(sym, y, m)
                if (fp.exists() and not force) or date(y, m, 1) >= today:
                    continue
                fr = fetch_binance_funding(sym, y, m) or fetch_bybit_funding(sym, y, m)
                if fr:
                    save_funding(fp, fr)
                    log(f"  {y}-{m:02d} 펀딩비 {len(fr)}번")
            for y, m in months:
                path = month_path(sym, y, m)
                if path.exists() and not force:
                    continue
                if date(y, m, 1) >= today:
                    log(f"  {y}-{m:02d} 은 아직 끝나지 않은 달이라 건너뜀")
                    continue
                rows = fetch_binance_month(sym, y, m, workdir)
                src = "binance"
                if not rows:
                    rows = fetch_bybit_month(sym, y, m)
                    src = "bybit"
                if not rows:
                    log(f"  {y}-{m:02d} 바이낸스·바이비트 모두 없음 (상장 전일 수 있음)")
                    continue
                save_month(path, rows)
                sources[f"{y}-{m:02d}"] = src
                src_path.parent.mkdir(parents=True, exist_ok=True)
                src_path.write_text(json.dumps(sources, indent=1), encoding="utf-8")
                log(f"  {y}-{m:02d} {len(rows):,}개 ({'바이낸스 선물' if src == 'binance' else '바이비트 선물'})")
                time.sleep(0.2)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    coins, missing = write_index()
    log(f"완료: 게임 종목 {len(coins)}개 → {GAME_DIR / 'index.json'}")
    for x in missing:
        log("  빠진 구간: " + x)


if __name__ == "__main__":
    main()
