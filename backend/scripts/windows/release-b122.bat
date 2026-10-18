@echo off
rem SISCOM CRM B1.2.2 - trien khai migration bang Prisma Migrate. Vi du (dien tap): release-b122.bat -Target scratch -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -Step preflight
if "%~1"=="" (
  echo Cach dung: release-b122.bat -Target ^<dev^|scratch^> -Step ^<preflight^|deploy^|verify^> [-DatabaseName ^<ten_db_thu^>]
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-b122.ps1" %*
echo.
pause
