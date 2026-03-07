@echo off

set "BAT_PATH=C:\TBOrder\START_POS.bat"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\TheBap_POS.lnk"

if not exist "%BAT_PATH%" (
    echo [ERROR] C:\TBOrder\START_POS.bat not found
    pause
    exit /b
)

echo Setting up auto-start...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath = 'cmd.exe'; $s.Arguments = '/c \"%BAT_PATH%\"'; $s.WorkingDirectory = 'C:\TBOrder'; $s.WindowStyle = 7; $s.Save()"

if exist "%LNK%" (
    echo [OK] Auto-start registered
    echo.
    echo When PC starts:
    echo   1. GitHub update
    echo   2. TBOrder server start
    echo   3. Chrome POS fullscreen
    echo.
    echo To disable: Win+R - shell:startup - delete TheBap_POS.lnk
) else (
    echo [FAIL] Auto registration failed
    echo Manual: Win+R - shell:startup - copy START_POS.bat shortcut there
)

echo.
pause
