@echo off
REM ════════════════════════════════════════════════════════
REM  The Bap POS - Server + POS Launcher
REM  tb-server.js 실행 후 Chrome 전체화면으로 POS 열기
REM ════════════════════════════════════════════════════════

title The Bap POS Server

cd /d "%~dp0"

REM ─── 서버 시작 ───
echo.
echo   Starting The Bap Server...
echo.
start "TBServer" cmd /c "node tb-server.js"

REM ─── 서버 준비 대기 (3초) ───
echo   Waiting for server to start...
timeout /t 3 /nobreak >nul

REM ─── Chrome 전체화면(kiosk)으로 POS 실행 ───
echo   Opening POS in Chrome (fullscreen)...

REM Chrome 경로 탐색
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else (
    REM 기본 등록된 Chrome 사용
    set "CHROME=chrome"
)

start "" "%CHROME%" --kiosk --disable-infobars --disable-session-crashed-bubble --noerrdialogs http://localhost:8080/pos

echo.
echo   ✅ POS is running!
echo   Close this window to keep the server running.
echo   Press Ctrl+C to stop the server.
echo.
