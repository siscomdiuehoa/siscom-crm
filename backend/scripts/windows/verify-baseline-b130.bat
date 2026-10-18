@echo off
rem SISCOM CRM B1.3 - doi chieu ma nguon (chi doc). Chay: scripts\windows\verify-baseline-b130.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-baseline-b130.ps1" %*
echo.
pause
