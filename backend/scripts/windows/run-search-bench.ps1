# SISCOM CRM B1.2.3-B2 P1 - BENCHMARK tim kiem (so sanh OR / UNION / UNION ALL) tren DATABASE THU. KHONG phai test nghiem thu.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\run-search-bench.ps1 (file moi). Ban sao co chu dich cac buoc an toan cua run-customers-tests.ps1 (file do KHONG sua).
# -ProofOnly: CHI chay bai 1 (doi chieu tong/ID/thu tu/phan trang giua cac bien the va V1) + doi chieu du lieu truoc/sau. KHONG EXPLAIN/p95/HTTP/UPDATE, KHONG VACUUM.
# -ScenariosOnly: CHI chay bai 6 (moi kich ban mot transaction nho, ROLLBACK doc lap, kiem tra du lieu sau tung nhom) + bai kiem tra du lieu cuoi. KHONG bai 1/EXPLAIN/p95/HTTP. Co VACUUM (ANALYZE) customer sau cac nhom UPDATE owner.
# -FailedOnly: CHI chay lai 5 nhom (S0b, 02, 14, 15, 18) cua bai 6. Cac nhom con lai = NOT_RUN (khong phai PASS). KHONG phai nghiem thu 23 nhom.
# -AnalyzeInTx: (tuy chon, mac dinh TAT) chay ANALYZE customer trong transaction sau UPDATE owner; thong ke cung bi ROLLBACK.
# -TimeoutProbe (r5-A): CHI kiem chung timeout giao dich Prisma (T1 ghi 100 dong PERF roi rollback, T2 chi doc). KHONG chay benchmark/p95/EXPLAIN/HTTP/bai 6. Chi tren DB thu.
# -StatsClone -CloneOf <nguon> [-ApproveAnalyze] (r5-B): CHI tren BAN SAO tao boi make-stats-clone (co nhan). Ghi (commit) tren ban sao: setup + ALTER TABLE autovacuum_enabled=false. ANALYZE chi khi co -ApproveAnalyze. Khong chay benchmark khac.
# -ScenariosOnly|-FailedOnly -CloneOf <nguon> (r5-C): chay bai 6 (S0a + 21 kich ban; S0b da bo) tren BAN SAO co nhan make-stats-clone va thong ke da ANALYZE (script dung neu thong ke cu). KHONG ket noi toi database goc. Chi UPDATE trong transaction roi ROLLBACK.
# -ApiPerf ... -Cases <regex ten ca> (vi du '^list/all/p(1|100)$'): chi do cac ca khop. Chi chu cai/so/^$|()/._- hop le.
# -P23aDiag -CloneOf <nguon> (P2-3a buoc A): CHAN DOAN CHI DOC tren ban sao PERF da ANALYZE (EXPLAIN + do SQL A1/A2 + trang 100). Khong sua du lieu/src.
# -ApiPerf -CloneOf <nguon> (P2-3): do p95 Customer API (V5) tren BAN SAO PERF da ANALYZE; CHI DOC (HTTP GET + EXPLAIN). Khong chay lai V1-V8, bai 6, ghi du lieu.
# Benchmark chi DOC du lieu tong hop co san (khong seed, khong tao index). Kich ban pham vi/xoa mem chay trong transaction roi ROLLBACK.
# Tuyet doi khong ket noi siscom_crm_dev. Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC), chi dua cho tien trinh con qua bien moi truong
# TEST_DATABASE_URL (khong in ra, khong ghi log, xoa sau khi chay). Cac test GHI vao database thu (tao khach/lien he/danh muc/nhan vien thu); DB thu bo di sau khi xong.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [ValidateRange(3, 20)][int]$Rounds = 3,
  [ValidateRange(15, 200)][int]$Samples = 15,
  [ValidateRange(1, 20)][int]$Warmup = 3,
  [string]$Variants = '',
  [string]$Terms = '',
  [switch]$NoHttp,
  [switch]$ProofOnly,
  [switch]$ScenariosOnly,
  [switch]$FailedOnly,
  [switch]$TimeoutProbe,
  [switch]$ApiPerf,
  [switch]$P23aDiag,
  [string]$Cases = '',
  [switch]$StatsClone,
  [string]$CloneOf = '',
  [switch]$ApproveAnalyze,
  [switch]$AnalyzeInTx,
  [switch]$TraceDeprecation,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b123'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c; if ($script:log) { Add-Content -LiteralPath $script:log -Value $m -Encoding UTF8 } }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Find-Tool([string]$name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $dirs = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
  foreach ($d in $dirs) { $p = Join-Path $d.FullName ('bin\' + $name); if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}
function Get-AppPasswordFromEnv([string]$envPath) {
  if (-not (Test-Path -LiteralPath $envPath)) { Fail ('Khong thay file .env: ' + $envPath) }
  $line = $null
  foreach ($l in (Get-Content -LiteralPath $envPath)) { if ($l -match '^\s*DATABASE_URL\s*=') { $line = $l; break } }
  if (-not $line) { Fail 'Khong co dong DATABASE_URL trong .env.' }
  $val = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim()
  if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) { $val = $val.Substring(1, $val.Length - 2) }
  $u = $null
  try { $u = New-Object System.Uri -ArgumentList $val } catch { Fail 'DATABASE_URL trong .env khong phai URL hop le (noi dung bi an).' }
  if (@('postgresql', 'postgres') -notcontains $u.Scheme) { Fail 'DATABASE_URL khong dung giao thuc postgresql://.' }
  $ui = $u.UserInfo; $ix = $ui.IndexOf(':')
  if ($ix -lt 1) { Fail 'DATABASE_URL khong co dang user:matkhau.' }
  $user = [uri]::UnescapeDataString($ui.Substring(0, $ix)); $pw = [uri]::UnescapeDataString($ui.Substring($ix + 1))
  $port = $u.Port; if ($port -lt 0) { $port = 5432 }
  $src = [uri]::UnescapeDataString($u.AbsolutePath.TrimStart('/'))
  if ($user -ne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -ne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev (chi de doi chieu).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  Say 'DATABASE_URL hop le (user/host/port/nguon da kiem tra). Mat khau lay tu .env, khong in.'
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
function Psql([string]$sql) {
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = $sql | & $script:psql -X -w -h 127.0.0.1 -p 5432 -U siscom_app -d $DatabaseName -t -A -v ON_ERROR_STOP=1 -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql bao loi: ' + (($out | ForEach-Object { $_.ToString() }) -join ' ')) }
  return (($out | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}
try {
  if ($DatabaseName -notmatch '^siscom_crm_(restore|test)_\d{8}_\d{6}$') { Fail 'Ten database phai la siscom_crm_restore_YYYYMMDD_HHMMSS (hoac siscom_crm_test_...). siscom_crm_dev bi tu choi.' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  if (@($ProofOnly, $ScenariosOnly, $FailedOnly, $TimeoutProbe, $StatsClone, $ApiPerf, $P23aDiag).Where({ $_ }).Count -gt 1) { Write-Host 'Chi chon mot trong -ProofOnly, -ScenariosOnly, -FailedOnly, -TimeoutProbe, -StatsClone.' -ForegroundColor Red; exit 2 }
$script:log = Join-Path $LogDir ($(if ($P23aDiag) { 'p23a_diag_' } elseif ($ApiPerf) { 'api_perf_' } elseif ($StatsClone) { 'stats_clone_' } elseif ($TimeoutProbe) { 'timeout_probe_' } elseif ($ProofOnly) { 'search_proof_' } elseif ($FailedOnly) { 'search_failed_' } elseif ($ScenariosOnly) { 'search_scen_' } else { 'search_bench_' }) + $DatabaseName + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('B1.2.3-B2 P1 bench db=' + $DatabaseName + ' rounds=' + $Rounds + ' samples=' + $Samples + ' variants=' + $Variants + ' terms=' + $Terms + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Database thu: ' + $DatabaseName + $(if ($P23aDiag) { ' | P2-3a buoc A | CHAN DOAN CHI DOC tren ban sao PERF (khong ghi, khong dung toi DB goc/siscom_crm_dev)' } elseif ($ApiPerf) { ' | P2-3 ApiPerf | CHI DOC tren ban sao PERF (khong ghi, khong dung toi DB goc/siscom_crm_dev)' } elseif ($StatsClone) { ' | P1 r5-B StatsClone | GHI (commit) tren BAN SAO huy bo duoc; ANALYZE chi khi co -ApproveAnalyze (khong dung toi DB goc/siscom_crm_dev)' } elseif ($TimeoutProbe) { ' | P1 r5-A TimeoutProbe | T1 ghi 100 dong PERF roi ROLLBACK (timeout Prisma 2 s), T2 chi doc (khong dung toi siscom_crm_dev)' } elseif ($ProofOnly) { ' | P1 ProofOnly | CHI DOC, khong UPDATE/VACUUM (khong dung toi siscom_crm_dev)' } elseif ($FailedOnly) { ' | P1 FailedOnly | CHI 5 nhom (S0b,02,14,15,18), moi nhom 1 transaction + ROLLBACK (khong dung toi siscom_crm_dev)' } elseif ($ScenariosOnly) { ' | P1 ScenariosOnly | moi kich ban 1 transaction nho + ROLLBACK, VACUUM ANALYZE customer (khong dung toi siscom_crm_dev)' } else { ' | P1 benchmark | chi doc + transaction ROLLBACK (khong dung toi siscom_crm_dev)' })) 'Yellow'
  $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
  if ($c -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  if ($StatsClone) {
    if ($CloneOf -notmatch '^siscom_crm_restore_\d{8}_\d{6}$' -or $CloneOf -eq $DatabaseName) { Fail 'Can -CloneOf <database nguon> hop le va khac ban sao.' }
    if ((Read-Host 'Day la BAN SAO se bi GHI (commit). Go CLONE-HUY-BO-DUOC de xac nhan') -ne 'CLONE-HUY-BO-DUOC') { Fail 'Khong xac nhan. Dung lai.' }
  }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || (to_regclass('public.customer') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL)::text || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261012000000_b1_2_crm_core' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -ne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -ne 'siscom_app' -or $info[2] -ne 'siscom_app') { Fail 'Tai khoan hoac chu so huu database khong phai siscom_app.' }
  if ($info[3] -ne 'true') { Fail 'Database thu chua co schema B1.2. Chay: release-b122.bat -Target scratch -DatabaseName <DB> -Step deploy' }
  if ($info[4] -ne '1') { Fail 'Database thu chua ghi nhan migration 20261012000000_b1_2_crm_core (hoan tat) trong _prisma_migrations.' }
  Ok ('Dung database thu: ' + $info[0] + ', schema B1.2 co mat, lich su migration dung.')
  if ($StatsClone) {
    $mk = Psql "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database();"
    if ($mk -ne ('SISCOM_STATS_CLONE_OF:' + $CloneOf)) { Fail 'Database nay KHONG co nhan ban sao cua make-stats-clone (nhan khop -CloneOf). TU CHOI vi se GHI du lieu vao no.' }
    Ok ('Database la ban sao co nhan hop le cua ' + $CloneOf + '. Script KHONG ket noi toi database goc.')
  }
  if ($CloneOf -and -not $StatsClone) {
    if (-not ($ScenariosOnly -or $FailedOnly -or $ApiPerf -or $P23aDiag)) { Fail '-CloneOf chi dung voi -StatsClone, -ScenariosOnly, -FailedOnly hoac -ApiPerf.' }
    if ($CloneOf -notmatch '^siscom_crm_restore_\d{8}_\d{6}$' -or $CloneOf -eq $DatabaseName) { Fail 'Can -CloneOf <database nguon> hop le va khac ban sao.' }
    $mk2 = Psql "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database();"
    if ($mk2 -ne ('SISCOM_STATS_CLONE_OF:' + $CloneOf)) { Fail 'Database nay KHONG co nhan ban sao cua make-stats-clone khop -CloneOf. TU CHOI chay r5-C.' }
    Ok ('r5-C: database la ban sao co nhan hop le cua ' + $CloneOf + '. Script KHONG ket noi toi database goc.')
  }
  $enc = [uri]::EscapeDataString($script:pw)
  $env:TEST_DATABASE_URL = 'postgresql://siscom_app:' + $enc + '@127.0.0.1:5432/' + $DatabaseName
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue  # khong de URL cua siscom_crm_dev lot vao tien trinh con
  $env:BENCH_EXPECT_DB = $DatabaseName
  $env:BENCH_ROUNDS = [string]$Rounds; $env:BENCH_SAMPLES = [string]$Samples; $env:BENCH_WARMUP = [string]$Warmup
  if ($Variants) { $env:BENCH_VARIANTS = $Variants }; if ($Terms) { $env:BENCH_TERMS = $Terms }
  if ($NoHttp) { $env:BENCH_HTTP = '0' }
  if ($ProofOnly) { $env:BENCH_PROOF_ONLY = '1' }
  if ($ScenariosOnly) { $env:BENCH_SCENARIOS_ONLY = '1' }
  if ($FailedOnly) { $env:BENCH_FAILED_ONLY = '1'; $env:BENCH_SCENARIOS_ONLY = '1' }
  if ($AnalyzeInTx) { $env:BENCH_ANALYZE_IN_TX = '1' }
  if ($TimeoutProbe) { $env:BENCH_TIMEOUT_PROBE = '1' }
  if ($P23aDiag) { if (-not $CloneOf) { Fail '-P23aDiag can -CloneOf <nguon>.' }; $env:BENCH_P23A_DIAG = '1' }
  if ($Cases) {
    if (-not $ApiPerf) { Fail '-Cases chi dung voi -ApiPerf.' }
    # Accept the exact two-case shorthand; pass a safe anchored regex to the existing Jest filter.
    if ($Cases -ceq 'list/all/p1,list/all/p100') { $Cases = '^list/all/p(1|100)$' }
    if ($Cases -notmatch '^[A-Za-z0-9^$|()/._ =-]+$') { Fail '-Cases chua ky tu khong hop le.' }
    $env:BENCH_CASES = $Cases
  }
  if ($ApiPerf) { if (-not $CloneOf) { Fail '-ApiPerf can -CloneOf <nguon> (ban sao PERF da ANALYZE).' }; $env:BENCH_API_PERF = '1' }
  if ($CloneOf -and -not $StatsClone) { $env:BENCH_REQUIRE_FRESH_STATS = '1' }
  if ($StatsClone) { $env:BENCH_STATS_CLONE = '1'; $env:BENCH_CLONE_OF = $CloneOf; if ($ApproveAnalyze) { $env:BENCH_APPROVE_ANALYZE = '1' } }
  if ($TraceDeprecation) { $env:NODE_OPTIONS = '--trace-deprecation --trace-warnings' }  # chi de lay call site canh bao adapter-pg; khong sua gi
  $env:PERF_REPORT_DIR = $LogDir
  $script:pw = $null
  $jest = Join-Path $root 'node_modules\jest\bin\jest.js'
  if (-not (Test-Path -LiteralPath $jest)) { Fail 'Khong thay node_modules\jest\bin\jest.js (khong tu cai dat goi nao).' }
  Say ('Chay: node jest --config ./test/jest-bench.json --runInBand (jest cuc bo, khong them dependency). Log: ' + $script:log) 'Yellow'
  $jestArgs = @('--config', './test/jest-bench.json', '--runInBand')
  if ($P23aDiag) { $jestArgs += @('--runTestsByPath', 'test/perf/bench/p23a-diag.bench-spec.ts') } elseif ($ApiPerf) { $jestArgs += @('--runTestsByPath', 'test/perf/bench/api-perf.bench-spec.ts') } elseif ($StatsClone) { $jestArgs += @('--runTestsByPath', 'test/perf/bench/stats-clone.bench-spec.ts') } elseif ($TimeoutProbe) { $jestArgs += @('--runTestsByPath', 'test/perf/bench/tx-timeout.bench-spec.ts') }
  Push-Location $root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & node.exe $jest @jestArgs 2>&1 | ForEach-Object { $s = $_.ToString(); Say $s }; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Pop-Location }
  if ($code -ne 0) { Say ('[CO SAI KHAC / LOI] benchmark thoat ma ' + $code + ' (xem muc failures trong bench_*.json)') 'Red'; $script:fail = $true } else { if ($P23aDiag) { Ok 'P23aDiag thoat ma 0: A1/A2 khop S0 tuyet doi (xem p23a_diag_*.json, muc gateVerdict).' } elseif ($ApiPerf) { Ok 'ApiPerf thoat ma 0: moi ca dat nguong (xem api_perf_*.json).' } elseif ($StatsClone) { Ok 'StatsClone thoat ma 0: phep do hop le. Doc KET LUAN trong log/stats_clone_*.json (ket luan V3 KHONG tu dong la DAT).' } elseif ($TimeoutProbe) { Ok 'TimeoutProbe thoat ma 0: T1 PASS (xem timeout_probe_*.json). T2 chi la quan sat.' } elseif ($ProofOnly) { Ok 'ProofOnly thoat ma 0 (moi bien the khop V1; du lieu truoc/sau khong doi).' } elseif ($FailedOnly) { Ok 'FailedOnly thoat ma 0 (5 nhom). 18 nhom con lai NOT_RUN - KHONG phai nghiem thu 23 nhom.' } elseif ($ScenariosOnly) { Ok 'ScenariosOnly thoat ma 0 (moi nhom ROLLBACK sach; moi bien the khop V1).' } else { Ok 'benchmark thoat ma 0 (moi bien the khop V1).' } }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue; foreach ($n in 'BENCH_EXPECT_DB','BENCH_ROUNDS','BENCH_SAMPLES','BENCH_WARMUP','BENCH_VARIANTS','BENCH_TERMS','BENCH_HTTP','BENCH_PROOF_ONLY','BENCH_SCENARIOS_ONLY','BENCH_FAILED_ONLY','BENCH_ANALYZE_IN_TX','BENCH_TIMEOUT_PROBE','BENCH_API_PERF','BENCH_P23A_DIAG','BENCH_CASES','BENCH_STATS_CLONE','BENCH_CLONE_OF','BENCH_REQUIRE_FRESH_STATS','BENCH_APPROVE_ANALYZE','NODE_OPTIONS') { Remove-Item ('Env:' + $n) -ErrorAction SilentlyContinue }; Remove-Item Env:PERF_REPORT_DIR -ErrorAction SilentlyContinue }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host $(if ($P23aDiag) { 'KET QUA: P23aDiag: khong co sai khac. Gui p23a_diag_*.json.' } elseif ($ApiPerf) { 'KET QUA: ApiPerf: moi ca dat nguong. Gui api_perf_*.json.' } elseif ($StatsClone) { 'KET QUA: StatsClone: phep do hop le. Gui stats_clone_*.json + log; KET LUAN ve V3 nam trong file.' } elseif ($TimeoutProbe) { 'KET QUA: TimeoutProbe T1 DAT. Gui timeout_probe_*.json + log.' } elseif ($ProofOnly) { 'KET QUA: ProofOnly DAT. Gui proof_*.json + log.' } elseif ($FailedOnly) { 'KET QUA: FailedOnly (5 nhom) DAT - KHONG phai nghiem thu 23 nhom. Gui scen_*.json + log.' } elseif ($ScenariosOnly) { 'KET QUA: ScenariosOnly DAT. Gui scen_*.json + log.' } else { 'KET QUA: benchmark chay xong, cac bien the khop V1. Gui bench_*.json + bench_plans_*.json + log.' }) -ForegroundColor Green }
