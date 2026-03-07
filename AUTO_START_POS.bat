@echo off
:: ════════════════════════════════════════════════════════════
::  The Bap (더밥) — POS 자동 시작 스크립트
::  PC 부팅 시: GitHub 업데이트 → 서버 시작 → Chrome POS 실행
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

:: ═══ GitHub에서 최신 버전 자동 업데이트 ═══
where git >nul 2>&1
if %errorlevel% equ 0 (
    if exist ".git" (
        echo Checking for updates...
        git fetch origin 2>nul
        git pull origin main 2>nul || git pull origin master 2>nul
        echo Update check done.
    )
) else (
    echo Git not installed - skipping auto update
)

:: 패키지 자동 설치/업데이트
if not exist "node_modules" (
    npm install --production
) else (
    :: package.json이 바뀌었을 수 있으니 npm install 실행
    npm install --production 2>nul
)

:: 서버를 백그라운드에서 시작 (최소화 창)
start "TBOrder Server" /min cmd /c "node tb-server.js"

:: 서버가 뜰 때까지 3초 대기
timeout /t 3 /nobreak >nul

:: Chrome 키오스크 모드로 POS 실행
:: --kiosk = 전체화면 (F11 누른 것처럼)
:: --disable-session-crashed-bubble = 비정상 종료 알림 제거
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --disable-session-crashed-bubble --noerrdialogs --disable-infobars "http://localhost:8080/pos"

exit
