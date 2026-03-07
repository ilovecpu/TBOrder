@echo off
chcp 65001 >nul 2>&1
title The Bap — 자동시작 설정
color 0B

echo.
echo   ╔════════════════════════════════════════════╗
echo   ║  The Bap — PC 자동시작 설정               ║
echo   ╚════════════════════════════════════════════╝
echo.

:: Windows 시작프로그램 폴더에 바로가기 생성
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set BAT_PATH=%USERPROFILE%\TBOrder\AUTO_START_POS.bat
set SHORTCUT_PATH=%STARTUP_FOLDER%\TheBap_POS.lnk

echo   시작프로그램에 자동실행 등록 중...
echo.

:: PowerShell로 바로가기(.lnk) 생성
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SHORTCUT_PATH%'); $sc.TargetPath = '%BAT_PATH%'; $sc.WorkingDirectory = '%USERPROFILE%\TBOrder'; $sc.Description = 'The Bap POS Auto Start'; $sc.Save()"

if exist "%SHORTCUT_PATH%" (
    echo   ✅ 자동시작 등록 완료!
    echo.
    echo   PC를 켜면 자동으로:
    echo     1. TBOrder 서버가 시작됩니다
    echo     2. Chrome에서 POS가 전체화면으로 열립니다
    echo.
    echo   자동시작을 해제하려면:
    echo     시작프로그램 폴더에서 TheBap_POS.lnk를 삭제하세요
    echo     폴더: %STARTUP_FOLDER%
) else (
    echo   ❌ 등록 실패. 수동으로 설정하세요:
    echo     1. Win+R → shell:startup 입력
    echo     2. AUTO_START_POS.bat의 바로가기를 해당 폴더에 복사
)

echo.
pause
