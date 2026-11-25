# SafeNex Localhost PowerShell Launcher
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       SAFENEX - AI-Powered Personal Safety Platform    " -ForegroundColor Green
Write-Host "            Starting Local Development Servers          " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js was not found in PATH. Please install Node.js (v20+)." -ForegroundColor Red
    exit 1
}

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

Write-Host "[1/3] Starting SafeNex AI Core Microservice on http://localhost:5001 ..." -ForegroundColor Yellow
Start-Process cmd.exe -ArgumentList "/k cd /d `"$root\safenex-backend`" && node src/server.ts" -WindowStyle Normal

Write-Host "[2/3] Starting SafeNex Web Application on http://localhost:5173 ..." -ForegroundColor Yellow
Start-Process cmd.exe -ArgumentList "/k cd /d `"$root\safenex-web`" && npm.cmd run dev" -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Services are running on Localhost:" -ForegroundColor White
Write-Host "  - Web Application:  http://localhost:5173" -ForegroundColor Cyan
Write-Host "  - AI Core Backend:  http://localhost:5001/api/ai/health" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Launching default web browser to http://localhost:5173 ..." -ForegroundColor Gray
Start-Process "http://localhost:5173"
