@echo off
rem Chart game launcher (Windows). Keep this file ASCII only: Korean text inside .bat files can break on some Windows setups.
rem All messages are printed by start_game.py.
cd /d "%~dp0"
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto run
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto run
echo.
echo [ERROR] Python is not installed (or not on PATH).
echo Install it from https://www.python.org/downloads/
echo On the first install screen, check "Add python.exe to PATH", then run this file again.
echo.
pause
exit /b 1
:run
rem One block on one line: cmd reads it whole before running, so an update that replaces this file is safe.
(%PY% start_game.py %* & echo. & pause & exit /b)
