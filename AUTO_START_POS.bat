@echo off
:: ════════════════════════════════════════════════════════════
::  The Bap (더밥) — POS 자동 시작 스크립트
::  PC 부팅 시 서버 시작 + Chrome 키오스크 모드로 POS 실행
:: ════════════════════════════════════════════════════════════

title The Bap POS Server

:: 서버 폴더로 이동
cd /d "%USERPROFILE%\TBOrder"

:: Node.js 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found! Please install from https://nodejs.org
    pause
    exit /b
)

:: 패키지 자동 설치
if not exist "node_modules" (
    npm install --production
)

:: 서버를 백그라운드에서 시작 (새 창)
start "TBOrder Server" /min cmd /c "node tb-server.js"

:: 서버가 뜰 때까지 3초 대기
timeout /t 3 /nobreak >nul

:: Chrome 키오스크 모드로 POS 실행
:: --kiosk = 전체화면 (F11 누른 것처럼)
:: --disable-session-crashed-bubble = 비정상 종료 알림 제거
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --disable-session-crashed-bubble --noerrdialogs --disable-infobars "http://localhost:8080/pos"

exit
