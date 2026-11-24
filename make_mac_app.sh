#!/bin/bash
# 맥: 아이콘 하나로 켜지는 '차트게임.app' 만들기 (이 폴더 안에 생김. 원하면 응용 프로그램 폴더로 끌어다 놓기)
# - 누르면: 게임 서버가 안 켜져 있으면 뒤에서 켜고(포트 8766), 크롬이 있으면 주소창 없는 앱 창으로, 없으면 기본 브라우저로 연다.
# - 서버는 뒤에서 계속 돌고, 맥을 끄면 같이 꺼진다. 직접 끄려면: pkill -f "start_game.py --no-update --no-browser --port 8766"
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-8766}"
APP="$DIR/차트게임.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>차트게임</string>
  <key>CFBundleDisplayName</key><string>차트게임</string>
  <key>CFBundleIdentifier</key><string>local.chart-game</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/bash
cd "$DIR"
URL="http://127.0.0.1:$PORT/game.html"
if ! curl -fs -o /dev/null --max-time 2 "\$URL"; then
  nohup /usr/bin/env python3 start_game.py --no-update --no-browser --port $PORT > "\$TMPDIR/chart-game-server.log" 2>&1 < /dev/null &
  for i in \$(seq 1 40); do curl -fs -o /dev/null --max-time 1 "\$URL" && break; sleep 0.25; done
fi
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="\$URL?v=\$(date +%s)" --window-size=1440,900
else
  open "\$URL?v=\$(date +%s)"
fi
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"
echo "만들었어요: $APP"
echo "더블클릭하면 차트게임이 열려요. 독(Dock)이나 응용 프로그램 폴더로 끌어다 놓고 써도 돼요."
