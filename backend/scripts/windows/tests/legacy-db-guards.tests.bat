@echo off
rem SISCOM CRM - kiem thu OFFLINE hang rao DB cua 4 script legacy (KHONG ket noi database, KHONG doc .env that).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0legacy-db-guards.tests.ps1"
echo.
pause
