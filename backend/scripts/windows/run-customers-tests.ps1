# SISCOM CRM B1.2.3-B2 - CHAY KIEM THU TICH HOP / HIEU NANG tren DATABASE THU (siscom_crm_restore_* hoac siscom_crm_test_*).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\run-customers-tests.ps1 (file moi)
# Tuyet doi khong ket noi siscom_crm_dev. Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC), chi dua cho tien trinh con qua bien moi truong
# TEST_DATABASE_URL (khong in ra, khong ghi log, xoa sau khi chay). Cac test GHI vao database thu (tao khach/lien he/danh muc/nhan vien thu); DB thu bo di sau khi xong.
# -Suite e2e : npm run test:e2e:customers (tich hop + dong thoi). -Suite perf : npm run test:perf (sinh 50.000 khach tong hop trong DB thu, do hieu nang).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [Parameter(Mandatory = $true)][ValidateSet('e2e', 'perf')][string]$Suite,
  [ValidateRange(1, 200)][int]$Rounds = 20,
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
  if ($user -cne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -cne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev (chi de doi chieu).') }
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
  if ($DatabaseName -cnotmatch '^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}\z') { Fail 'Ten database phai la siscom_crm_restore_YYYYMMDD_HHMMSS (hoac siscom_crm_test_...). siscom_crm_dev bi tu choi.' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:log = Join-Path $LogDir ('customers_' + $Suite + '_' + $DatabaseName + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('B1.2.3-B2 suite=' + $Suite + ' db=' + $DatabaseName + ' rounds=' + $Rounds + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Database thu: ' + $DatabaseName + ' | Suite: ' + $Suite + ' | GHI vao database thu (khong dung toi siscom_crm_dev)') 'Yellow'
  $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
  if ($c -cne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || (to_regclass('public.customer') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL)::text || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261012000000_b1_2_crm_core' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -cne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -cne 'siscom_app' -or $info[2] -cne 'siscom_app') { Fail 'Tai khoan hoac chu so huu database khong phai siscom_app.' }
  if ($info[3] -ne 'true') { Fail 'Database thu chua co schema B1.2. Chay: release-b122.bat -Target scratch -DatabaseName <DB> -Step deploy' }
  if ($info[4] -ne '1') { Fail 'Database thu chua ghi nhan migration 20261012000000_b1_2_crm_core (hoan tat) trong _prisma_migrations.' }
  Ok ('Dung database thu: ' + $info[0] + ', schema B1.2 co mat, lich su migration dung.')
  $enc = [uri]::EscapeDataString($script:pw)
  $env:TEST_DATABASE_URL = 'postgresql://siscom_app:' + $enc + '@127.0.0.1:5432/' + $DatabaseName
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue  # khong de URL cua siscom_crm_dev lot vao tien trinh con
  $env:CONCURRENCY_ROUNDS = [string]$Rounds
  $env:PERF_REPORT_DIR = $LogDir
  $script:pw = $null
  $cmd = if ($Suite -eq 'e2e') { 'test:e2e:customers' } else { 'test:perf' }
  Say ('Chay: npm run ' + $cmd + ' (cuc bo, chi voi database thu). Ket qua day du o ' + $script:log) 'Yellow'
  Push-Location $root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & npm.cmd run $cmd 2>&1 | ForEach-Object { $s = $_.ToString(); Say $s }; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Pop-Location }
  if ($code -ne 0) { Say ('[KHONG DAT] npm run ' + $cmd + ' thoat ma ' + $code) 'Red'; $script:fail = $true } else { Ok ('npm run ' + $cmd + ' thoat ma 0.') }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue; Remove-Item Env:CONCURRENCY_ROUNDS -ErrorAction SilentlyContinue; Remove-Item Env:PERF_REPORT_DIR -ErrorAction SilentlyContinue }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: suite nay DAT.' -ForegroundColor Green }
