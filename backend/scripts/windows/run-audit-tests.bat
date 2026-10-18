@echo off
rem SISCOM CRM B1.3.2a - chay rieng test audit tren DATABASE THU. Khong chay benchmark.
rem   run-audit-tests.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS
if "%~1"=="" (
  echo Cach dung: run-audit-tests.bat -DatabaseName ^<database thu^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-audit-tests.ps1" %*
echo.
pause
