@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-setup.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
