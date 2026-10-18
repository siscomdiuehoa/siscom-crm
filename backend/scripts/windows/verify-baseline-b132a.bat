@echo off
rem SISCOM CRM B1.3.2a - doi chieu sau khi ap dung goi (chi doc). Chay: scripts\windows\verify-baseline-b132a.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-baseline-b132a.ps1" %*
echo.
pause
