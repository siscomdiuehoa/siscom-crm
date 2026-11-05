@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Thu khoi phuc ban sao luu cum demo vao DB MOI tren cum demo (mac dinh cong 55433). KHONG dung cho cong 5432.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-restore-test.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
