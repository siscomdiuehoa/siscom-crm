@echo off
rem SISCOM CRM B1.2.2 - dien tap migration tren DATABASE THU.
rem Vi du: rehearse-b122.bat -DatabaseName siscom_crm_restore_20261011_223434 -Step guard
if "%~1"=="" (
  echo Cach dung: rehearse-b122.bat -DatabaseName ^<siscom_crm_restore_YYYYMMDD_HHMMSS^> -Step ^<guard^|fail^|apply^|verify^|tests^|probe^|drift^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rehearse-b122.ps1" %*
echo.
pause
