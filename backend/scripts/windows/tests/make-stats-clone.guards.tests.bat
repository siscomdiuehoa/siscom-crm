@echo off
rem SISCOM CRM - kiem thu OFFLINE cac guard cua make-stats-clone (KHONG ket noi database, KHONG doc .env).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tests\make-stats-clone.guards.tests.ps1"
echo.
pause