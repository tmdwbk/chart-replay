@echo off
chcp 65001 >nul
title 차트게임
cd /d "%~dp0"

echo ================================================
echo   차트게임 시작
echo   이 창을 닫으면 게임이 꺼져요. 게임하는 동안 켜 두세요.
echo ================================================
echo.

rem ---- 1. 파이썬 찾기 (py 가 없으면 python)
set "PY="
where py >nul 2>nul
if %errorlevel%==0 set "PY=py"
if defined PY goto havepy
where python >nul 2>nul
if %errorlevel%==0 set "PY=python"
if defined PY goto havepy
echo [문제] 파이썬을 찾지 못했어요.
echo python.org 에서 파이썬을 설치하고, 설치 첫 화면에서
echo "Add python.exe to PATH" 를 체크한 뒤 다시 실행해 주세요.
pause
exit /b 1

:havepy
rem ---- 2. 준비물 requests (처음 한 번)
%PY% -c "import requests" >nul 2>nul
if %errorlevel%==0 goto haveneed
echo [1/3] 준비물 설치 중... 처음 한 번만 해요.
%PY% -m pip install --user requests
if not %errorlevel%==0 goto failpip
:haveneed

rem ---- 3. 차트 데이터 (처음 한 번, 약 40MB)
if exist "data\game\index.json" goto havedata
echo [2/3] 차트 데이터를 받는 중이에요. 처음 한 번, 몇 분 걸려요.
%PY% fetch_game.py
if not exist "data\game\index.json" goto faildata
:havedata

rem ---- 4. 게임 켜기: 2초 뒤 브라우저를 열고, 이 창에서 서버를 돌린다
echo [3/3] 게임을 켜요. 브라우저가 열리면 [게임 시작]을 누르세요.
echo 브라우저가 안 열리면 주소창에  http://127.0.0.1:8765/game.html  을 입력하세요.
echo.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8765/game.html"
%PY% -m http.server 8765 --bind 127.0.0.1
echo.
echo 서버가 멈췄어요. 이미 다른 창에서 켜져 있으면 그 창을 쓰면 돼요.
pause
exit /b 0

:failpip
echo [문제] 준비물 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.
pause
exit /b 1

:faildata
echo [문제] 차트 데이터를 다 받지 못했어요. 인터넷 연결을 확인하고 다시 실행하면 받은 데까지는 건너뛰고 이어 받아요.
pause
exit /b 1
