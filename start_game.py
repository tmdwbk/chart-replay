#!/usr/bin/env python3
"""차트게임 켜기 (윈도우·맥 공통). START-CHART-GAME.bat / start_game.command 가 이 파일을 실행한다.

하는 일 (처음 한 번만 오래 걸림):
  1. 새 버전 확인: GitHub 의 최신 코드와 다르면 물어보고 코드 파일만 바꾼다 (data 폴더·차트 데이터는 그대로).
  2. 준비물(requests) 이 없으면 설치한다.
  3. 차트 데이터(data/game, 1분봉 약 200MB) 가 없거나 예전 5분봉이면 받는다. 새 버전에서 종목이 바뀌었으면 빠진 것만 더 받는다.
  4. 이 컴퓨터 안에서만 보이는 작은 웹 서버를 켜고 브라우저로 차트게임을 연다.

옵션:  --no-update  새 버전 확인 건너뛰기 · --no-browser  브라우저 안 열기 · --port 8765 · --lan  같은 와이파이의 휴대폰에서도 열기

공개 데이터 GET 요청만 쓴다. API 키·주문 기능은 없다.
"""

import http.server
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

REPO = "tmdwbk/chart-replay"
BRANCH = "main"
HERE = Path(__file__).resolve().parent
VERSION_FILE = HERE / ".chart-game-version"        # 마지막으로 받은 코드의 커밋 번호
KEEP = {"data", "samples", ".git", ".chart-game-version", "__pycache__"}   # 업데이트 때 건드리지 않는 것

try:                                                # 윈도우 콘솔에서도 한글이 깨지지 않게
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def say(msg=""):
    print(msg, flush=True)


def ask_yes(question, default=True):
    try:
        a = input(f"{question} {'[Y/n]' if default else '[y/N]'} ").strip().lower()
    except EOFError:
        return default
    return default if not a else a in ("y", "yes", "ㅛ", "네", "예", "응")


def http_get(url, timeout=20):
    # requests(+certifi) 가 있으면 그걸 쓴다: 맥 python.org 파이썬은 urllib 로 https 인증서 확인에 실패할 때가 있음
    try:
        import requests
        r = requests.get(url, headers={"User-Agent": "chart-game-launcher"}, timeout=timeout)
        r.raise_for_status()
        return r.content
    except ImportError:
        pass
    req = urllib.request.Request(url, headers={"User-Agent": "chart-game-launcher"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- 1. 새 버전
def latest_sha():
    data = json.loads(http_get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}", timeout=10))
    return data["sha"], data["commit"]["message"].splitlines()[0], data["commit"]["committer"]["date"]


def update_code(sha):
    say("  최신 코드를 받는 중...")
    blob = http_get(f"https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}", timeout=60)
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(tmp)
        roots = [p for p in Path(tmp).iterdir() if p.is_dir()]
        if len(roots) != 1:
            raise RuntimeError("받은 파일 구조가 예상과 달라요")
        src = roots[0]
        n = 0
        for p in src.rglob("*"):
            rel = p.relative_to(src)
            if rel.parts[0] in KEEP or p.is_dir():
                continue
            dst = HERE / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dst)
            n += 1
    VERSION_FILE.write_text(sha, encoding="utf-8")
    say(f"  코드 파일 {n}개를 새 버전으로 바꿨어요. (차트 데이터는 그대로)")


def check_update():
    try:
        sha, msg, when = latest_sha()
    except Exception:
        say("  (인터넷이 안 되거나 GitHub 에 닿지 않아 새 버전 확인은 건너뛰어요)")
        return False
    have = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else ""
    if have == sha:
        say("  이미 최신 버전이에요.")
        return False
    say(f"  새 버전이 있어요: {msg}  ({when[:10]})" if have else "  이 폴더의 버전을 알 수 없어요. 최신 코드로 맞추는 게 좋아요.")
    if not ask_yes("  지금 업데이트할까요?"):
        return False
    try:
        update_code(sha)
        return True
    except Exception as e:
        say(f"  [문제] 업데이트 실패: {e}. 지금 버전으로 계속해요.")
        return False


# ---------------------------------------------------------------- 2. 준비물
def ensure_requests():
    try:
        import requests  # noqa: F401
        return
    except ImportError:
        pass
    say("  준비물(requests)을 설치해요. 처음 한 번만 해요.")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--user", "requests"])
    if r.returncode != 0:
        raise SystemExit("[문제] 준비물 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.")
    import site, importlib
    try:
        sys.path.append(site.getusersitepackages())
    except Exception:
        pass
    importlib.invalidate_caches()


# ---------------------------------------------------------------- 3. 차트 데이터
def ensure_data(force_check):
    idx = HERE / "data" / "game" / "index.json"
    try:                                           # 2026-11-24 5분봉 → 1분봉: 예전 데이터면 1분봉을 새로 받는다
        if idx.exists() and json.loads(idx.read_text(encoding="utf-8")).get("interval") != "1m":
            say("  차트가 1분봉으로 바뀌어서 데이터를 새로 받아요 (처음 한 번, 약 200MB·몇 분~십여 분).")
            force_check = True
    except Exception:
        force_check = True
    if idx.exists() and not force_check:
        say("  차트 데이터가 이미 있어요.")
        return
    say("  차트 데이터를 받아요. 처음엔 몇 분~십여 분 걸려요 (1분봉 약 200MB). 이미 받은 달은 건너뛰어요.")
    r = subprocess.run([sys.executable, str(HERE / "fetch_game.py")], cwd=str(HERE))
    if not idx.exists():
        raise SystemExit("[문제] 차트 데이터를 다 받지 못했어요. 인터넷 연결을 확인하고 다시 실행하면 받은 데까지는 건너뛰고 이어 받아요.")
    if r.returncode != 0:
        say("  (몇 달은 못 받았지만 받은 데이터로 게임할 수 있어요)")


# ---------------------------------------------------------------- 4. 서버
class Handler(http.server.SimpleHTTPRequestHandler):
    # 윈도우는 레지스트리 설정에 따라 .js 를 text/plain 으로 보낼 수 있어서 직접 정한다
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json",
                      ".gz": "application/octet-stream", ".svg": "image/svg+xml"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")      # 업데이트 뒤 옛 파일이 남지 않게
        super().end_headers()

    def log_message(self, *a):                           # 요청마다 줄이 쌓이지 않게
        pass


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def served_by_this_folder(port):                   # 그 포트의 서버가 '이 폴더'의 지금 파일을 내주고 있나 (예전 폴더·예전 버전이면 False)
    try:
        got = urllib.request.urlopen(f"http://127.0.0.1:{port}/game.js", timeout=3).read()
        return got == (HERE / "game.js").read_bytes()
    except Exception:
        return False


def stale_server(port):                            # 그 포트에서 다른 차트게임(예전 버전)이 돌고 있나
    try:
        return "replay.html?game" in urllib.request.urlopen(f"http://127.0.0.1:{port}/game.html", timeout=3).read().decode("utf-8", "replace")
    except Exception:
        return False


def lan_ip():                                       # 같은 와이파이의 휴대폰이 들어올 이 컴퓨터 주소 (패킷은 안 보냄)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except Exception:
        return None


def serve(port, open_browser, lan=False):
    url = f"http://127.0.0.1:{port}/game.html"
    # 같은 주소(포트)를 써야 브라우저에 저장된 게임 기록(잔고·티어)이 이어진다. 그래서 예전 창이 켜져 있으면 닫게 한다
    while not port_free(port) and not served_by_this_folder(port) and stale_server(port):
        say("")
        say("  [!] 예전 버전(또는 다른 폴더)의 차트게임 까만 창이 아직 켜져 있어요.")
        say("      그 창이 켜져 있으면 브라우저에 예전 화면이 떠요.")
        say("      작업 표시줄에서 까만 창(명령 프롬프트·python)을 모두 닫고, 이 창으로 돌아와 Enter 를 누르세요.")
        try:
            input("      (닫았으면 Enter) ")
        except EOFError:
            break
    if not port_free(port):
        if served_by_this_folder(port):
            say(f"  이미 다른 창에서 켜져 있어요. 브라우저만 열게요: {url}")
            if open_browser:
                webbrowser.open(url + "?v=" + str(int(time.time())))
            return
        say(f"  [!] {port} 포트를 다른 프로그램이 쓰고 있어서 다른 포트로 켜요. 이 주소에서는 예전 게임 기록이 안 보일 수 있어요.")
        for p in range(port + 1, port + 20):
            if port_free(p):
                port, url = p, f"http://127.0.0.1:{p}/game.html"
                break
        else:
            raise SystemExit(f"[문제] {port}~{port + 19} 포트가 모두 사용 중이에요. 컴퓨터를 다시 켠 뒤 실행해 주세요.")
    srv = http.server.ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), Handler)
    say("")
    say("=" * 56)
    say("  차트게임이 켜졌어요.")
    say(f"  주소: {url}")
    if lan:
        ip = lan_ip()
        say(f"  📱 휴대폰(같은 와이파이): http://{ip}:{port}/game.html" if ip else "  📱 이 컴퓨터의 와이파이 주소를 찾지 못했어요")
        say("     같은 와이파이에 있는 기기는 누구나 이 주소로 게임 파일을 볼 수 있어요. 집 와이파이에서만 쓰세요.")
    say("  브라우저가 안 열리면 위 주소를 주소창에 붙여 넣으세요.")
    say("  이 창을 닫으면 게임이 꺼져요. 게임하는 동안 켜 두세요.")
    say("=" * 56)
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url + "?v=" + str(int(time.time())))).start()   # 새 주소로 열어 예전 화면이 남지 않게
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        say("  게임 서버를 껐어요.")


def main():
    args = sys.argv[1:]
    port = 8765
    if "--port" in args:
        port = int(args[args.index("--port") + 1])
    os.chdir(HERE)
    say("=" * 56)
    say("  차트게임 시작")
    say("=" * 56)
    if sys.version_info < (3, 8):
        raise SystemExit("[문제] 파이썬 3.8 이상이 필요해요. python.org 에서 새로 설치해 주세요.")
    say("[1/4] 준비물 확인")
    ensure_requests()
    updated = "--fetch" in args                   # 업데이트 직후 다시 켜진 경우: 새 종목·펀딩비 데이터를 마저 받는다
    if "--no-update" not in args:
        say("[2/4] 새 버전 확인")
        if check_update():
            # 지금 돌고 있는 건 예전 코드라서, 새로 받은 start_game.py 로 다시 켠다 (같은 창에서)
            say("  새 버전으로 다시 켤게요...")
            rest = [a for a in args if a not in ("--no-update", "--fetch")]
            r = subprocess.run([sys.executable, str(HERE / "start_game.py"), "--no-update", "--fetch"] + rest, cwd=str(HERE))
            raise SystemExit(r.returncode)
    say("[3/4] 차트 데이터 확인")
    ensure_data(force_check=updated)
    say("[4/4] 게임 켜기")
    serve(port, "--no-browser" not in args, lan="--lan" in args)


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code not in (None, 0):
            say(str(e.code))
        raise
