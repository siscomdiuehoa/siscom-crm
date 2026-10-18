@echo off
rem SISCOM CRM B1.2.3-B2 P1 - khoa baseline (doi chieu scen_*.json + sao chep bang chung + SHA256). KHONG ket noi database.
rem   lock-p1-baseline.bat -ScenFile D:\SISCOM-CRM\backups\b123\scen_2026-10-15T15-34-54-530Z.json
if "%~1"=="" (
  echo Cach dung: lock-p1-baseline.bat -ScenFile ^<duong dan scen_*.json cua r5-C^> [-SourceDir ...] [-EvidenceDir ...]
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lock-p1-baseline.ps1" %*
echo.
pause
