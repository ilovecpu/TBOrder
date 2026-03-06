@echo off
title TBOrder - The Bap Order Kiosk
echo.
echo   Starting The Bap Order Kiosk...
echo.

:: 서버 시작 (백그라운드)
start /min "" cmd /c "cd /d "%~dp0" && node tb-server.js"

:: 2초 대기 (서버 시작 대기)
timeout /t 2 /nobreak >nul

:: Chrome 키오스크 모드로 주문 화면 열기
:: 세로 화면(1080x1920)에 최적화
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --disable-pinch --overscroll-history-navigation=0 "http://localhost:8080/order"

echo   서버 + 주문 키오스크가 시작되었습니다.
echo   주방 태블릿에서 아래 URL을 열어주세요:
echo.

:: IP 주소 표시
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP: =%
echo   주방: http://%IP%:8080/kitchen
echo   관리: http://%IP%:8080/admin
echo.
