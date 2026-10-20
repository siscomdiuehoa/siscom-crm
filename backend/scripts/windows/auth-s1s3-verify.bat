@echo off
rem SISCOM CRM B1.3.2-B - kiem chung S1-S3 (M1.2 + tach role siscom_migrator/siscom_app) tren BAN SAO MOI. KHONG tu chay; can phe duyet rieng.
rem   auth-s1s3-verify.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -Step guard
if "%~1"=="" (
  echo Cach dung: auth-s1s3-verify.bat -DatabaseName ^<ban sao moi^> [-TemplateDb siscom_crm_restore_20261015_214948] -Step ^<guard^|apply^|constraints^|constraints11^|constraints12^|regress^|drift^|rollback^|split^|privs^|deploy-owner^|unsplit^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auth-s1s3-verify.ps1" %*
echo.
pause
