# SISCOM CRM B1.3.2-B - CHAY KIEM THU TICH HOP CACH LY QUYEN/DANH TINH (test\access-isolation.auth-int-spec.ts) tren DATABASE THU.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\run-auth-int-tests.ps1 (file moi). KHONG tu chay; can phe duyet rieng bang van ban.
# BAO VE CUNG: ten phai khop ^siscom_crm_(restore|test)_YYYYMMDD_HHMMSS$, khong nam trong danh sach cam, khong chua dev/prod/production/baseline/live,
#   database phai mang nhan SISCOM_STATS_CLONE_OF:<TemplateDb>, chu so huu siscom_app, da co schema B1.2 (+ M1..M1.3 neu -RequireAuthSchema), khong co phien khac.
# Test GHI vao database thu (khach/lien he/danh muc/nhan vien thu is_demo). DB thu bo di sau khi xong. Khong chay tren ban sao da dung cho concurrency/constraints neu khong can.
# Mat khau siscom_app doc tu DATABASE_URL trong .env luc chay (CHI DOC, khong in, khong ghi log) va chi dua cho tien trinh con qua TEST_DATABASE_URL (xoa sau khi chay).
# Lenh that su chay: npx jest --config test/jest-auth-int.json --runInBand  (khong them script vao package.json).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$TemplateDb = 'siscom_crm_restore_20261015_214948',
  [switch]$RequireAuthSchema,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b132b'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
$DB_ALLOW = '^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}\z'
$DB_DENY = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
$DB_DENY_WORDS = '(?i)(dev|prod|production|baseline|live)'
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
  $ui = $u.UserInfo; $ix = $ui.IndexOf(':')
  if ($ix -lt 1) { Fail 'DATABASE_URL khong co dang user:matkhau.' }
  $user = [uri]::UnescapeDataString($ui.Substring(0, $ix)); $pw = [uri]::UnescapeDataString($ui.Substring($ix + 1))
  $port = $u.Port; if ($port -lt 0) { $port = 5432 }
  $src = [uri]::UnescapeDataString($u.AbsolutePath.TrimStart('/'))
  if ($user -cne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -cne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -cne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi "' + $src + '", ky vong siscom_crm_dev (chi de lay mat khau, KHONG dung lam dich).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
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
  if ($DatabaseName -cnotmatch $DB_ALLOW) { Fail 'Ten database phai la siscom_crm_restore_YYYYMMDD_HHMMSS hoac siscom_crm_test_YYYYMMDD_HHMMSS.' }
  if ($DB_DENY -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich.') }
  if ($DatabaseName -match $DB_DENY_WORDS) { Fail ('CAM: ten "' + $DatabaseName + '" chua tu khoa dev/prod/production/baseline/live.') }
  if ($TemplateDb -cnotmatch '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z' -or $TemplateDb -eq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:log = Join-Path $LogDir ('auth_int_' + $DatabaseName + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('run-auth-int-tests db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Database thu: ' + $DatabaseName + ' | GHI vao database thu (khong dung toi siscom_crm_dev)') 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten database thu de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid, 'pg_database'), '') || '|' || (to_regclass('public.customer') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL)::text || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261012000000_b1_2_crm_core' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name LIKE '2026102%_b1_3_%' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid())::text FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -ne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -ne 'siscom_app' -or $info[2] -ne 'siscom_app') { Fail 'Tai khoan hoac chu so huu database khong phai siscom_app.' }
  if ($info[3] -cne ('SISCOM_STATS_CLONE_OF:' + $TemplateDb)) { Fail 'Database KHONG co nhan ban sao cua make-stats-clone khop -TemplateDb. TU CHOI.' }
  if ($info[4] -ne 'true' -or $info[5] -ne '1') { Fail 'Database thu chua co schema B1.2 / lich su migration b1_2_crm_core.' }
  if ($RequireAuthSchema -and $info[6] -ne '4') { Fail ('Co ' + $info[6] + '/4 migration auth (M1..M1.3) da ap; can du 4 khi dung -RequireAuthSchema.') }
  if ($info[7] -ne '0') { Fail ('Co ' + $info[7] + ' phien khac dang ket noi toi database thu. Dung.') }
  Ok ('Guard: ' + $info[0] + ' co nhan ban sao, khong nam trong danh sach cam, schema B1.2 co mat, migration auth da ap = ' + $info[6] + '.')
  $env:TEST_DATABASE_URL = 'postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $DatabaseName
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue  # khong de URL cua siscom_crm_dev lot vao tien trinh con
  $script:pw = $null
  Say ('Chay: npx jest --config test/jest-auth-int.json --runInBand (cuc bo, chi voi database thu). Log: ' + $script:log) 'Yellow'
  Push-Location $root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & npx.cmd jest --config test/jest-auth-int.json --runInBand 2>&1 | ForEach-Object { Say $_.ToString() }; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Pop-Location }
  if ($code -ne 0) { Say ('[KHONG DAT] jest thoat ma ' + $code) 'Red'; $script:fail = $true } else { Ok 'jest thoat ma 0.' }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; foreach ($n in 'PGPASSWORD', 'DATABASE_URL', 'TEST_DATABASE_URL') { Remove-Item ('Env:' + $n) -ErrorAction SilentlyContinue } }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: suite nay DAT.' -ForegroundColor Green }
