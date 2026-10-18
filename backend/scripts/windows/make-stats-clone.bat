@echo off
rem SISCOM CRM B1.2.3-B2 P1 r5-B - tao BAN SAO huy bo duoc cua database thu. KHONG tu chay.
rem   make-stats-clone.bat -SourceDatabase siscom_crm_restore_20261014_214105 [-CloneDatabase siscom_crm_restore_YYYYMMDD_HHMMSS]
if "%~1"=="" (
  echo Cach dung: make-stats-clone.bat -SourceDatabase ^<siscom_crm_restore_YYYYMMDD_HHMMSS^> [-CloneDatabase ^<ten moi^>]
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-stats-clone.ps1" %*
echo.
pause
