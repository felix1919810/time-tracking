@echo off
title Time Tracking Launcher

echo ====================================
echo  Time Tracking - Start All
echo ====================================
echo.

REM Kill any old instances
taskkill /F /IM ngrok.exe >nul 2>&1

REM 1. Start backend on port 8011
echo [1/3] Starting backend on port 8011...
cd /d "D:\time tracking\backend"
start "Backend-8011" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8011"

REM 2. Start ngrok tunnel on port 8011
echo [2/3] Starting ngrok tunnel on port 8011...
set "NGROK_DIR=%USERPROFILE%\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe"
cd /d "%NGROK_DIR%"
start "Ngrok-Tunnel" cmd /k "ngrok http 8011"

REM 3. Start frontend on port 5173
echo [3/3] Starting frontend on port 5173...
cd /d "D:\time tracking\frontend"
start "Frontend-5173" cmd /k "npm run dev"

echo.
echo ====================================
echo  All 3 services started (separate windows)
echo ====================================
echo.
echo  Backend:  http://localhost:8011
echo  Frontend: http://localhost:5173
echo  Ngrok:    http://localhost:4040
echo.
echo  Next steps:
echo  1. Open http://localhost:4040 to get ngrok public URL
echo  2. Put https://YOUR-NGROK-URL.ngrok-free.dev/api/lark/webhook
echo     into Feishu Event Callback config
echo  3. In Feishu, @bot and send: start test
echo.
pause
