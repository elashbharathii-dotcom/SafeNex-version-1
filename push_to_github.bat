@echo off
title Push Safenex to GitHub
echo ===================================================
echo 🚀 Pushing SafeNex to GitHub...
echo Repository: https://github.com/elashbharathii-dotcom/SafeNex-version-1.git
echo ===================================================
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
git push -u origin main
echo ===================================================
pause
