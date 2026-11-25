@echo off
title SafeNex Localhost Launcher
echo ========================================================
echo        SAFENEX - AI-Powered Personal Safety Platform
echo             Starting Local Development Servers
echo ========================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found in PATH. Please install Node.js (v20+) from https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Starting SafeNex AI Core Microservice (Port 5001)...
start "SafeNex AI Core [Port 5001]" cmd /k "cd safenex-backend && node src/server.ts"

echo [2/3] Starting SafeNex Web Client (Port 5173)...
start "SafeNex Web App [Port 5173]" cmd /k "cd safenex-web && npm.cmd run dev"

echo.
echo [3/3] Waiting for dev servers to initialize...
timeout /t 3 /nobreak >nul

echo.
echo ========================================================
echo   Services are now running on Localhost:
echo   - Web Application:  http://localhost:5173
echo   - AI Core Backend:  http://localhost:5001/api/ai/health
echo ========================================================
echo.
echo Launching browser to http://localhost:5173 ...
start http://localhost:5173
