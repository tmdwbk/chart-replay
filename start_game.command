#!/bin/bash
# 맥: 더블클릭하면 차트게임을 켠다 (처음엔 터미널에서 chmod +x start_game.command 가 필요할 수 있음)
cd "$(dirname "$0")"
python3 start_game.py "$@"
