@echo off
REM ════════════════════════════════════════════════════════
REM  The Bap POS - Server + POS Launcher
REM  tb-server.js 실행 후 Chrome 전체화면으로 POS 열기
REM  Chrome 종료 시 서버도 자동 종료
REM ════════════════════════════════════════════════════════

title The Bap POS Server

cd /d "%~dp0"

REM ─── 서버 시작 (최소화 상태) ───
echo.
echo   Starting The Bap Server...
echo.
start /min "TBServer" cmd /c "node tb-server.js"

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

REM ─── /wait: Chrome이 닫힐 때까지 대기 ───
start /wait "" "%CHROME%" --kiosk --disable-infobars --disable-session-crashed-bubble --noerrdialogs http://localhost:8080/pos

REM ─── Chrome 종료 감지 → 서버 자동 종료 ───
echo.
echo   Chrome closed. Shutting down server...
taskkill /fi "WINDOWTITLE eq TBServer" /f >nul 2>&1
taskkill /fi "IMAGENAME eq node.exe" /fi "WINDOWTITLE eq TBServer" /f >nul 2>&1
echo   Server stopped. Goodbye!
exit
