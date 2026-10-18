@echo off
rem SISCOM CRM B1.2.3-B2 - kiem thu tich hop/hieu nang tren DATABASE THU. Vi du:
rem   run-customers-tests.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -Suite e2e
if "%~1"=="" (
  echo Cach dung: run-customers-tests.bat -DatabaseName ^<siscom_crm_restore_YYYYMMDD_HHMMSS^> -Suite ^<e2e^|perf^> [-Rounds 20]
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-customers-tests.ps1" %*
echo.
pause
