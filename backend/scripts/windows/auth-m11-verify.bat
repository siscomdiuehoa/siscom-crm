@echo off
rem SISCOM CRM B1.3.2-B - kiem chung M1 + M1.1 (auth core + S4/S5) tren BAN SAO MOI. KHONG tu chay; can phe duyet rieng.
rem   auth-m11-verify.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -Step guard
if "%~1"=="" (
  echo Cach dung: auth-m11-verify.bat -DatabaseName ^<ban sao moi^> [-TemplateDb siscom_crm_restore_20261015_214948] -Step ^<guard^|apply^|constraints^|constraints11^|regress^|rollback^|drift^|concurrency^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auth-m11-verify.ps1" %*
echo.
pause
