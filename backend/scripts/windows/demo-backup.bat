@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Sao luu DB tren CUM DEMO (mac dinh cong 55433, thu muc D:\SISCOM-CRM-demo-pg\backups). KHONG dung cho cong 5432.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-backup.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
