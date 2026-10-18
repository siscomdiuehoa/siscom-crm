@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Truyen them tham so: setup-db.bat -Check   hoac   setup-db.bat -ResetAppPassword
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-db.ps1" %*
pause
