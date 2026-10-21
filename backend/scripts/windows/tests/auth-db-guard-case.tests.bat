@echo off
rem SISCOM CRM - kiem thu OFFLINE hang rao ten database phan biet hoa/thuong (KHONG ket noi database, KHONG doc .env that).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auth-db-guard-case.tests.ps1"
echo.
pause
