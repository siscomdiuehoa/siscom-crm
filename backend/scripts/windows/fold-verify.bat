@echo off
rem SISCOM CRM B1.2.3-B2 P2-3c - kiem chung contact.full_name_fold STORED tren BAN SAO MOI. KHONG tu chay.
rem   fold-verify.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -TemplateDb siscom_crm_restore_20261015_214948 -Step guard
if "%~1"=="" (
  echo Cach dung: fold-verify.bat -DatabaseName ^<ban sao moi^> -TemplateDb ^<nguon cua ban sao^> -Step ^<guard^|apply^|sync^|rollback^|drift^|probe^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fold-verify.ps1" %*
echo.
pause
