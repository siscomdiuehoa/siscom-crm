@echo off
rem SISCOM CRM B1.2.3-B2 P1 - benchmark tim kiem tren DATABASE THU. Vi du:
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105 -ProofOnly
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105 -ScenariosOnly
rem   r5-C: run-search-bench.bat -DatabaseName siscom_crm_restore_20261015_214948 -ScenariosOnly -CloneOf siscom_crm_restore_20261014_214105
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105 -FailedOnly
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105 -TimeoutProbe
rem   P2-3: run-search-bench.bat -DatabaseName siscom_crm_restore_20261015_214948 -ApiPerf -CloneOf siscom_crm_restore_20261014_214105
rem   P2-3a buoc A: run-search-bench.bat -DatabaseName siscom_crm_restore_20261015_214948 -P23aDiag -CloneOf siscom_crm_restore_20261014_214105
rem   P2-3b-0 trang 100: run-search-bench.bat -DatabaseName siscom_crm_restore_20261015_214948 -ApiPerf -CloneOf siscom_crm_restore_20261014_214105 -Cases ^^list/all/p(1^|100)$$
rem   run-search-bench.bat -DatabaseName <ban sao> -StatsClone -CloneOf siscom_crm_restore_20261014_214105 [-ApproveAnalyze]
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105
rem   run-search-bench.bat -DatabaseName siscom_crm_restore_20261014_214105 -Terms "nguyen van,mi" -Variants "V1_or_two_orig,V5_union_window_orig"
if "%~1"=="" (
  echo Cach dung: run-search-bench.bat -DatabaseName ^<siscom_crm_restore_YYYYMMDD_HHMMSS^> [-ProofOnly | -ScenariosOnly | -FailedOnly | -TimeoutProbe | -StatsClone -CloneOf <nguon> [-ApproveAnalyze]] [-AnalyzeInTx] [-Rounds 3] [-Samples 15] [-Warmup 3] [-Variants ...] [-Terms ...] [-NoHttp] [-TraceDeprecation]
  echo   -ProofOnly: chi doi chieu tong/ID/thu tu/phan trang voi V1; khong EXPLAIN, p95, HTTP, UPDATE, VACUUM.
  echo   -ScenariosOnly: chi bai 6 (moi kich ban 1 transaction nho, ROLLBACK doc lap) + kiem tra du lieu cuoi.
  echo   -FailedOnly: chi chay lai 5 nhom (S0b,02,14,15,18); nhom con lai NOT_RUN; KHONG phai nghiem thu 23 nhom.
  echo   -TimeoutProbe: chi kiem chung timeout giao dich Prisma (T1 ghi 100 dong PERF roi rollback; T2 chi doc).
  echo   -StatsClone: CHI tren ban sao tao boi make-stats-clone; ANALYZE chi khi co -ApproveAnalyze.
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-search-bench.ps1" %*
echo.
pause
