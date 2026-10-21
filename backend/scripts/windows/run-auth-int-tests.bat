@echo off
rem SISCOM CRM B1.3.2-B - kiem thu tich hop cach ly quyen/danh tinh tren DATABASE THU. KHONG tu chay; can phe duyet rieng bang van ban.
rem   run-auth-int-tests.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS [-RequireAuthSchema]
if "%~1"=="" (
  echo Cach dung: run-auth-int-tests.bat -DatabaseName ^<siscom_crm_restore_YYYYMMDD_HHMMSS^> [-TemplateDb ...] [-RequireAuthSchema]
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-auth-int-tests.ps1" %*
echo.
pause
