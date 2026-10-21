@echo off
rem SISCOM CRM B1.3.2-B - kiem chung M1 + M1.1 + M1.2 + M1.3 tren BAN SAO THU MOI. KHONG tu chay; can phe duyet rieng bang van ban.
rem   auth-m13-verify.bat -DatabaseName siscom_crm_restore_YYYYMMDD_HHMMSS -Step static
if "%~1"=="" (
  echo Cach dung: auth-m13-verify.bat -DatabaseName ^<ban sao moi^> [-TemplateDb siscom_crm_restore_20261015_214948] -Step ^<static^|guard^|apply^|constraints^|constraints11^|constraints12^|structure13^|functional13^|regress^|drift^|rollback^|concurrency^>
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auth-m13-verify.ps1" %*
echo.
pause
