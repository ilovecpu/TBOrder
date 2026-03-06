@echo off
title TBOrder - The Bap Order Kiosk
echo.
echo   Starting The Bap Kiosk System...
echo.

:: 서버 시작 (백그라운드)
start /min "" cmd /c "cd /d "%~dp0" && if not exist node_modules (npm install) && node tb-server.js"

:: 3초 대기 (서버 시작 대기)
timeout /t 3 /nobreak >nul

:: Chrome 키오스크 모드로 주문 화면 열기
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --disable-pinch --overscroll-history-navigation=0 "http://localhost:8080/order"

echo.

:: IP 주소 표시
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP: =%
echo   ========================================
echo   서버 + 키오스크가 시작되었습니다.
echo   같은 WiFi에서 아래 URL 접속:
echo.
echo   주문: http://%IP%:8080/order
echo   주방: http://%IP%:8080/kitchen
echo   POS:  http://%IP%:8080/pos
echo   관리: http://%IP%:8080/admin
echo   ========================================
echo.
