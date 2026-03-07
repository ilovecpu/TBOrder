@echo off

cd /d "C:\TBOrder"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found
    start https://nodejs.org
    pause
    exit /b
)

echo [1] Stopping old server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [2] Checking GitHub updates...
where git >nul 2>&1
if %errorlevel% equ 0 (
    if exist ".git" (
        git fetch origin >nul 2>&1
        git reset --hard origin/main >nul 2>&1 || git reset --hard origin/master >nul 2>&1
    )
)

echo [3] Installing packages...
if not exist "node_modules" (
    call npm install --production
)

echo [4] Starting server...
start "TBServer" /min cmd /k "cd /d C:\TBOrder && node tb-server.js"

echo [5] Waiting 15 seconds for server...
ping 127.0.0.1 -n 16 >nul

echo [6] Opening Chrome POS...
set "CR="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CR=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%CR%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CR=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if "%CR%"=="" if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CR=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if "%CR%"=="" (
    start http://localhost:8080/pos
) else (
    start "" "%CR%" --start-fullscreen --disable-session-crashed-bubble --noerrdialogs --disable-infobars http://localhost:8080/pos
)

exit
