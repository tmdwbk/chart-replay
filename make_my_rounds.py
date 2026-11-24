#!/usr/bin/env python3
"""내 최근 매매로 차트게임 판 만들기 (내 컴퓨터에서만, 결과는 data/ 에 저장 = 커밋 안 됨).

사용:
    python3 make_my_rounds.py --db ~/scalp-journal/data/scalp.db          # 최근 30개
    python3 make_my_rounds.py --db 경로 --n 50

- 매매일지 DB(position_close 표)를 '읽기 전용'으로 열어, 최근에 끝난 포지션마다 한 판을 만든다.
- 판의 1턴 = 진입 10봉(50분) 전. 앞 200봉 + 50턴 = 249개 5분봉을 게이트 공개 시세 API(GET, 키 없음)로 받는다.
- 저장: data/game/mine/<계약>_<1턴 시각>.csv.gz + data/game/my_index.json (판 목록 + 그때 실제 내 매매)
- 차트게임은 my_index.json 이 있으면 새 종목 두 번에 한 번꼴로 여기서 뽑고, 다 하면 원래 30종목만 나온다.
"""

import argparse
import csv
import gzip
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "game" / "mine"
INDEX = HERE / "data" / "game" / "my_index.json"
GATE = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks"
PRE, TURNS, BAR = 200, 50, 300


def say(m):
    print(m, flush=True)


def gate_candles(contract, frm, to):
    r = requests.get(GATE, params={"contract": contract, "interval": "5m", "from": frm, "to": to},
                     headers={"User-Agent": "chart-game"}, timeout=30)
    if r.status_code != 200:
        return None
    rows = []
    for c in r.json():
        rows.append((int(c["t"]), c["o"], c["h"], c["l"], c["c"], c.get("v", ""), c.get("sum", ""), ""))
    return sorted({x[0]: x for x in rows}.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="매매일지 scalp.db 경로")
    ap.add_argument("--n", type=int, default=30, help="최근 몇 개")
    a = ap.parse_args()
    db = Path(os.path.expanduser(a.db))
    if not db.exists():
        sys.exit(f"[문제] DB 가 없어요: {db}")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)      # 읽기 전용
    rows = con.execute("select time, contract, side, pnl, first_open_time, raw from position_close order by time desc limit ?", (a.n,)).fetchall()
    con.close()
    OUT.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    out, skipped = [], 0
    for t_close, contract, side, pnl, t_open, raw in rows:
        t_open, t_close = int(t_open), int(t_close)
        r = json.loads(raw)
        entry = float(r.get("long_price") if side == "long" else r.get("short_price") or 0) or None
        exitp = float(r.get("short_price") if side == "long" else r.get("long_price") or 0) or None
        start = (t_open // BAR) * BAR - 10 * BAR                      # 1턴 봉
        if (t_close // BAR) * BAR > start + (TURNS - 1) * BAR:       # 오래 들고 있었으면 진입 5봉 전부터
            start = (t_open // BAR) * BAR - 5 * BAR
        frm, to = start - (PRE - 1) * BAR, start + (TURNS - 1) * BAR
        if to + BAR > now:
            skipped += 1
            continue                                                  # 아직 다 안 지난 구간
        path = OUT / f"{contract}_{start}.csv.gz"
        if not path.exists():
            cs = gate_candles(contract, frm, to)
            if not cs or len(cs) < PRE + TURNS - 5:
                say(f"  {contract} {start}: 봉이 모자라 건너뜀")
                skipped += 1
                continue
            tmp = path.with_name(path.name + ".tmp")
            with gzip.open(tmp, "wt", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["ts_utc", "open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume"])
                w.writerows(cs)
            os.replace(tmp, path)
            time.sleep(0.25)
        base = contract.replace("_USDT", "")
        out.append({"id": f"{contract}_{start}", "short": base, "name": base, "symbol": contract, "start": start,
                    "file": f"game/mine/{path.name}", "sources": ["gate"],
                    "trade": {"side": side, "open": t_open, "close": t_close, "entry": entry, "exit": exitp, "pnl": float(pnl)}})
    tmp = INDEX.with_name(".my_index.json.tmp")
    tmp.write_text(json.dumps({"rounds": out, "made": now}, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, INDEX)
    say(f"완료: 내 매매 {len(out)}판 → {INDEX}" + (f" (아직 4시간이 안 지났거나 봉이 모자란 {skipped}개는 빠짐)" if skipped else ""))


if __name__ == "__main__":
    main()
