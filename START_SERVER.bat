@echo off
title TBOrder Server - The Bap
color 0D
echo.
echo   ========================================
echo     TBOrder Server Starting...
echo     The Bap Kiosk + POS System
echo   ========================================
echo.

:: Node.js 설치 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js가 설치되어 있지 않습니다!
    echo.
    echo   https://nodejs.org 에서 Node.js를 설치해주세요.
    echo.
    pause
    exit /b
)

:: npm 패키지 자동 설치 (node_modules 없으면)
cd /d "%~dp0"
if not exist "node_modules" (
    echo   패키지 설치 중...
    npm install
    echo.
)

:: 서버 실행
echo   Node.js version:
node --version
echo.
echo   서버를 시작합니다...
echo   종료하려면 Ctrl+C를 누르세요.
echo.
node tb-server.js
pause
