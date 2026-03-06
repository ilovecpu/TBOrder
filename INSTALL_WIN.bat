@echo off
chcp 65001 >nul 2>&1
title The Bap (더밥) — TBOrder Installer
color 0B

echo.
echo   ╔════════════════════════════════════════════╗
echo   ║  🍚 The Bap (더밥) — TBOrder Installer    ║
echo   ║  Windows Edition v1.1                      ║
echo   ╚════════════════════════════════════════════╝
echo.

:: ─── 1) Node.js 확인 ───
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ⚠️  Node.js가 설치되어 있지 않습니다.
    echo.
    echo   자동으로 Node.js 설치 페이지를 엽니다...
    start https://nodejs.org
    echo.
    echo   Node.js 설치 후 이 파일을 다시 실행하세요.
    echo.
    pause
    exit /b
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   ✅ Node.js %NODE_VER% 확인됨
echo.

:: ─── 2) Git 확인 ───
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   ⚠️  Git이 설치되어 있지 않습니다.
    echo.
    echo   자동으로 Git 설치 페이지를 엽니다...
    start https://git-scm.com/download/win
    echo.
    echo   Git 설치 후 이 파일을 다시 실행하세요.
    echo.
    pause
    exit /b
)

echo   ✅ Git 확인됨
echo.

:: ─── 3) 설치 경로 ───
set INSTALL_DIR=%USERPROFILE%\TBOrder

:: ─── 4) 다운로드 또는 업데이트 ───
if exist "%INSTALL_DIR%\.git" (
    echo   🔄 기존 설치 발견 — 최신 코드로 업데이트 중...
    cd /d "%INSTALL_DIR%"
    git pull origin main 2>nul || git pull origin master 2>nul
    echo   ✅ 업데이트 완료!
) else (
    echo   📥 GitHub에서 다운로드 중...
    git clone https://github.com/ilovecpu/TBOrder.git "%INSTALL_DIR%"
    echo   ✅ 다운로드 완료!
)

echo.
cd /d "%INSTALL_DIR%"

:: ─── 5) 패키지 설치 ───
if not exist "node_modules" (
    echo   📦 패키지 설치 중...
    npm install --production
    echo.
)

echo   ✅ 패키지 준비 완료!
echo.

:: ─── 6) 로컬 IP 찾기 ───
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%

echo   ════════════════════════════════════════════
echo   🚀 서버를 시작합니다!
echo.
echo   📱 접속 주소:
echo      POS:      http://%LOCAL_IP%:8080/pos
echo      Admin:    http://%LOCAL_IP%:8080/admin
echo      주문:     http://%LOCAL_IP%:8080/order
echo      주방:     http://%LOCAL_IP%:8080/kitchen
echo.
echo   💡 iPad/Android에서 위 주소로 접속하세요!
echo      (같은 Wi-Fi에 연결되어 있어야 합니다)
echo.
echo   종료: Ctrl+C
echo   ════════════════════════════════════════════
echo.

node tb-server.js
pause
