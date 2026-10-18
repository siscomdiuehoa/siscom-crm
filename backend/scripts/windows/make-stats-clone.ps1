# SISCOM CRM B1.2.3-B2 P1 r5-B - TAO BAN SAO huy bo duoc cua database thu de kiem chung V3 voi thong ke moi.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\make-stats-clone.ps1 (file moi). KHONG tu chay: chi chay khi ban duyet.
# Lam: (1) kiem tra ten + database nguon ton tai, ban sao chua ton tai; (2) XAC MINH KHONG CO KET NOI NAO toi database nguon (khong ngat ket noi cua ai);
# (3) CREATE DATABASE <ban sao> TEMPLATE <nguon> OWNER siscom_app (can mat khau postgres, hoi luc chay, khong luu); (4) gan nhan 'SISCOM_STATS_CLONE_OF:<nguon>' (run-search-bench.ps1 -StatsClone chi chap nhan database co nhan nay);
# (5) doi chieu so dong + thong ke planner (pg_stats, reltuples) giua nguon va ban sao CHI DOC bang siscom_app.
# Khong sua database nguon, khong DROP/TRUNCATE/DELETE, khong dung toi siscom_crm_dev.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceDatabase,
  [string]$CloneDatabase = '',
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b123'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:log = $null
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
function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
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
  $ui = $u.UserInfo; $ix = $ui.IndexOf(':')
  if ($ix -lt 1) { Fail 'DATABASE_URL khong co dang user:matkhau.' }
  $user = [uri]::UnescapeDataString($ui.Substring(0, $ix)); $pw = [uri]::UnescapeDataString($ui.Substring($ix + 1))
  if ($user -ne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
function Run-Psql([string]$user, [string]$pw, [string]$db, [string]$sql) {
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = $sql | & $script:psql -X -q -t -A -w -h 127.0.0.1 -p 5432 -U $user -d $db -v ON_ERROR_STOP=1 -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql bao loi (tai khoan ' + $user + ', db ' + $db + '): ' + (($out | ForEach-Object { $_.ToString() }) -join ' ')) }
  return (($out | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}
$adminPw = $null; $appPw = $null
try {
  $pat = '^siscom_crm_restore_\d{8}_\d{6}$'
  if ($CloneDatabase -eq '') { $CloneDatabase = 'siscom_crm_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss') }
  if ($SourceDatabase -notmatch $pat) { Fail 'Database nguon phai la siscom_crm_restore_YYYYMMDD_HHMMSS. siscom_crm_dev bi tu choi.' }
  if ($CloneDatabase -notmatch $pat) { Fail 'Ten ban sao phai la siscom_crm_restore_YYYYMMDD_HHMMSS.' }
  if ($SourceDatabase -eq $CloneDatabase) { Fail 'Ten ban sao trung database nguon.' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:log = Join-Path $LogDir ('make_stats_clone_' + $CloneDatabase + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('make-stats-clone source=' + $SourceDatabase + ' clone=' + $CloneDatabase + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Se TAO ban sao ' + $CloneDatabase + ' tu ' + $SourceDatabase + ' (CREATE DATABASE ... TEMPLATE). Khong sua database nguon.') 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten database NGUON') -ne $SourceDatabase) { Fail 'Ten nguon khong khop.' }
  if ((Read-Host 'Go lai CHINH XAC ten BAN SAO se tao') -ne $CloneDatabase) { Fail 'Ten ban sao khong khop.' }
  if ((Read-Host 'Go TAO-BAN-SAO de xac nhan') -ne 'TAO-BAN-SAO') { Fail 'Khong xac nhan. Dung lai.' }
  $adminPw = Read-Secret 'Mat khau tai khoan postgres (chi de TAO ban sao; khong luu)'
  $chk = (Run-Psql 'postgres' $adminPw 'postgres' ("SELECT (SELECT count(*) FROM pg_database WHERE datname='" + $SourceDatabase + "') || '|' || (SELECT count(*) FROM pg_database WHERE datname='" + $CloneDatabase + "') || '|' || (SELECT count(*) FROM pg_stat_activity WHERE datname='" + $SourceDatabase + "');")).Split('|')
  if ($chk[0] -ne '1') { Fail 'Database nguon khong ton tai.' }
  if ($chk[1] -ne '0') { Fail 'Ban sao da ton tai (khong ghi de).' }
  if ($chk[2] -ne '0') { Fail ('Database nguon dang co ' + $chk[2] + ' ket noi. KHONG ngat ket noi cua ai: dong cac ung dung dang noi roi chay lai.') }
  Ok 'Database nguon khong co ket noi nao. Ban sao chua ton tai.'
  Run-Psql 'postgres' $adminPw 'postgres' ('CREATE DATABASE ' + $CloneDatabase + ' TEMPLATE ' + $SourceDatabase + ' OWNER siscom_app;') | Out-Null
  Run-Psql 'postgres' $adminPw 'postgres' ("COMMENT ON DATABASE " + $CloneDatabase + " IS 'SISCOM_STATS_CLONE_OF:" + $SourceDatabase + "';") | Out-Null
  $adminPw = $null
  Ok ('Da tao ban sao ' + $CloneDatabase + ' va gan nhan.')
  $appPw = Get-AppPasswordFromEnv (Join-Path $root '.env')
  $q = "SELECT (SELECT count(*) FROM customer) || '|' || (SELECT count(*) FROM contact) || '|' || (SELECT count(*) FROM customer WHERE legacy_id LIKE 'PERF-%') || '|' || (SELECT count(*) FROM pg_stats WHERE schemaname='public' AND tablename IN ('customer','contact')) || '|' || coalesce((SELECT round(null_frac::numeric,4)::text FROM pg_stats WHERE schemaname='public' AND tablename='customer' AND attname='owner_id'),'-') || '|' || (SELECT reltuples::bigint FROM pg_class WHERE oid='public.customer'::regclass) || '|' || (SELECT count(*) FROM customer WHERE owner_id IS NOT NULL);"
  $s = Run-Psql 'siscom_app' $appPw $SourceDatabase $q
  $c = Run-Psql 'siscom_app' $appPw $CloneDatabase $q
  Say ('Nguon  (customer|contact|PERF|so dong pg_stats|null_frac owner_id|reltuples|owner not null): ' + $s)
  Say ('Ban sao (cung chi tieu)                                                                   : ' + $c)
  if ($s -ne $c) { Fail 'Thong ke/so dong cua ban sao KHAC nguon. Khong dung ban sao nay; xoa thu cong va tao lai.' }
  Ok 'So dong va thong ke planner cua ban sao khop nguon.'
  $ct = Run-Psql 'siscom_app' $appPw $CloneDatabase "SELECT coalesce(last_analyze::text,'-') || '|' || coalesce(last_autoanalyze::text,'-') || '|' || n_mod_since_analyze FROM pg_stat_user_tables WHERE relname='customer';"
  Say ('Ban sao: bo dem pg_stat_user_tables (last_analyze|last_autoanalyze|n_mod_since_analyze) = ' + $ct + ' (bo dem hoat dong KHONG duoc sao chep; chi de tham khao).')
  Write-Host ''
  Write-Host 'BUOC TIEP THEO (chi khi ban duyet):' -ForegroundColor Green
  Write-Host ('  scripts\windows\run-search-bench.bat -DatabaseName ' + $CloneDatabase + ' -StatsClone -CloneOf ' + $SourceDatabase + '   (giai doan thong ke CU, KHONG ANALYZE)')
  Write-Host ('  scripts\windows\run-search-bench.bat -DatabaseName ' + $CloneDatabase + ' -StatsClone -CloneOf ' + $SourceDatabase + ' -ApproveAnalyze   (them ANALYZE tren ban sao)')
  Write-Host 'Xoa ban sao khi xong (can quyen postgres, THU CONG, chi ban sao nay):'
  Write-Host ('  psql -U postgres -h 127.0.0.1 -c "DROP DATABASE ' + $CloneDatabase + ';"')
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $adminPw = $null; $appPw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: KHONG DAT / LOI.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: tao ban sao DAT.' -ForegroundColor Green }
