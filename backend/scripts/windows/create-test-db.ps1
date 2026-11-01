# SISCOM CRM B1.3 - TAO DATABASE THU RONG (siscom_crm_test_YYYYMMDD_HHMMSS) de dien tap dang nhap phien cookie / demo 4 vai tro.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\create-test-db.ps1 (file moi). Can mat khau postgres (hoi an, CHI de CREATE DATABASE, khong luu).
# KHONG dung vao siscom_crm_dev hay bat ky database co san (tu choi neu ten da ton tai). Khong DROP/TRUNCATE/DELETE.
# Buoc sau: auth-demo-stack.bat -Step migrate|bootstrap|start -DatabaseName <ten in ra cuoi script>.
# MAC DINH: GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id TO siscom_app (PostgreSQL >= 15; pham vi TOAN CLUSTER,
#   dieu kien trien khai M1.2 ghi o PR #166). BAT BUOC de "prisma migrate deploy" ap duoc migration M1.2 bang siscom_app (khong phai
#   superuser): cac ham fn_auth_api_* co menh de SET app.* => thieu quyen se loi P3018 / 42501 "permission denied to set parameter".
#   -SkipGrantSetParameter: bo qua (chi khi quyen da cap tu truoc). GRANT lap lai khong gay hai.
[CmdletBinding()]
param(
  [ValidateSet('test', 'restore')][string]$Kind = 'test',
  [string]$DatabaseName,
  [switch]$SkipGrantSetParameter,
  # B1.4: mac dinh cum demo 55433 (mat khau postgres doc tu pg-<port>.secrets cua demo-pg). 5432 bi tu choi tru -AllowMainCluster (owner duyet).
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [switch]$NonInteractive,
  [switch]$AllowMainCluster
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Ok([string]$m) { Write-Host ('[OK] ' + $m) -ForegroundColor Green }
function Find-Tool([string]$name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $dirs = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
  foreach ($d in $dirs) { $p = Join-Path $d.FullName ('bin\' + $name); if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}
# B1.4 demo cach ly: chi chay tren CUM DEMO (demo-pg.ps1: cluster_name = 'siscom_demo', cong rieng). Cong 5432 (PostgreSQL hien tai) va moi cum
# khong mang nhan bi TU CHOI, tru khi co -AllowMainCluster (CHI khi owner phe duyet rieng bang van ban). Mat khau postgres / siscom_app cua cum
# demo lay tu D:\SISCOM-CRM-demo-pg\private\pg-<port>.secrets va demo-<port>.env (do demo-pg.ps1 sinh).
function Get-DemoSecret([int]$port, [string]$key) {
  $f = Join-Path 'D:\SISCOM-CRM-demo-pg\private' ('pg-' + $port + '.secrets')
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  foreach ($l in Get-Content -LiteralPath $f) { if ($l -match ('^' + $key + '=([0-9a-f]{64})$')) { return $Matches[1] } }
  return $null
}
function Assert-DemoPort([int]$port, [bool]$allowMain) {
  if ($allowMain) { Write-Host 'CANH BAO: -AllowMainCluster - KHONG kiem nhan cum demo. Chi dung khi owner phe duyet rieng bang van ban.' -ForegroundColor Yellow; return }
  if ($port -eq 5432) { throw (New-Object System.ApplicationException -ArgumentList 'Cong 5432 la PostgreSQL hien tai cua may: script demo chi chay tren cum demo rieng (demo-pg.bat, mac dinh -PgPort 55433).') }
}
function Assert-DemoClusterName([string]$name, [bool]$allowMain) {
  if ($allowMain) { return }
  if ($name -ne 'siscom_demo') { throw (New-Object System.ApplicationException -ArgumentList ('Cum PostgreSQL dang ket noi co cluster_name = "' + $name + '", khong phai cum demo (siscom_demo). Dung lai, khong ghi gi.')) }
}
function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Run-Psql([string]$psql, [string]$user, [string]$pw, [string]$db, [string]$sql) {
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = $sql | & $psql -X -q -t -A -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PgPort -U $user -d $db -f - 2>$null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql bao loi (ma ' + $code + ') voi tai khoan "' + $user + '" tren "' + $db + '". Sai mat khau postgres hoac dich vu PostgreSQL chua chay?') }
  return (($out | Out-String).Trim())
}
$adminPw = $null
try {
  $psql = Find-Tool 'psql.exe'; if (-not $psql) { Fail 'Khong tim thay psql.exe (PostgreSQL chua cai?).' }
  if (-not $DatabaseName) { $DatabaseName = 'siscom_crm_' + $Kind + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') }
  if ($DatabaseName -notmatch '^siscom_crm_(restore|test)_\d{8}_\d{6}$') { Fail 'Ten database phai la siscom_crm_test_YYYYMMDD_HHMMSS hoac siscom_crm_restore_YYYYMMDD_HHMMSS. siscom_crm_dev bi tu choi.' }
  Write-Host ('Se TAO database RONG: ' + $DatabaseName + ' (OWNER siscom_app, UTF8, TEMPLATE template0). Khong dung toi siscom_crm_dev.') -ForegroundColor Yellow
  Assert-DemoPort $PgPort ([bool]$AllowMainCluster)
  # QA I-2: tren cum demo CHI dung mat khau trong file cua cum demo (khong hoi tay, khong bien moi truong - tranh gui mat khau superuser cum chinh
  # toi mot tien trinh la tren cong demo); moi lan psql bat buoc SCRAM (PGREQUIREAUTH), khong gui mat khau dang ro.
  if (-not $AllowMainCluster) { $env:PGREQUIREAUTH = 'scram-sha-256' }
  $adminPw = Get-DemoSecret $PgPort 'POSTGRES_PW'
  if (-not $adminPw -and -not $AllowMainCluster) { Fail ('Khong co file mat khau cum demo (D:\SISCOM-CRM-demo-pg\private\pg-' + $PgPort + '.secrets). Chay demo-pg.bat -Step init (hoac demo-setup.bat) truoc.') }
  if ($adminPw) { Write-Host ('Mat khau postgres cua cum demo cong ' + $PgPort + ' lay tu file (khong in).') }
  elseif ($NonInteractive) { $adminPw = $env:SISCOM_PG_ADMIN_PASSWORD; if (-not $adminPw) { Fail 'Che do khong tuong tac can file mat khau cum demo hoac bien SISCOM_PG_ADMIN_PASSWORD.' } }
  else { $adminPw = Read-Secret 'Mat khau tai khoan postgres (chi de TAO database thu; khong luu)' }
  Assert-DemoClusterName (Run-Psql $psql 'postgres' $adminPw 'postgres' "SELECT current_setting('cluster_name');") ([bool]$AllowMainCluster)
  $ver = Run-Psql $psql 'postgres' $adminPw 'postgres' 'SHOW server_version_num;'
  if ((Run-Psql $psql 'postgres' $adminPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname='" + $DatabaseName + "';")) -eq '1') { Fail ('Database ' + $DatabaseName + ' da ton tai (khong ghi de).') }
  if ((Run-Psql $psql 'postgres' $adminPw 'postgres' "SELECT 1 FROM pg_roles WHERE rolname='siscom_app';") -ne '1') { Fail 'Chua co tai khoan siscom_app (cum demo: chay demo-pg.bat -Step init; KHONG dung setup-db.bat - script do danh cho cong 5432).' }
  Run-Psql $psql 'postgres' $adminPw 'postgres' ('CREATE DATABASE ' + $DatabaseName + " OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0;") | Out-Null
  Run-Psql $psql 'postgres' $adminPw 'postgres' ('REVOKE ALL ON DATABASE ' + $DatabaseName + ' FROM PUBLIC; GRANT CONNECT ON DATABASE ' + $DatabaseName + ' TO siscom_app;') | Out-Null
  Ok ('Da tao database ' + $DatabaseName + ' (chu so huu siscom_app)')
  if ([int]$ver -lt 150000) { Write-Host '[BO QUA] GRANT SET ON PARAMETER chi co tu PostgreSQL 15.' -ForegroundColor Yellow }
  else {
    if (-not $SkipGrantSetParameter) {
      Write-Host 'Cap quyen (toan cluster) GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id TO siscom_app - can cho migration M1.2.' -ForegroundColor Yellow
      Run-Psql $psql 'postgres' $adminPw 'postgres' 'GRANT SET ON PARAMETER app.actor_employee_id TO siscom_app; GRANT SET ON PARAMETER app.priv_request_id TO siscom_app;' | Out-Null
    }
    $gp = Run-Psql $psql 'postgres' $adminPw 'postgres' "SELECT has_parameter_privilege('siscom_app', 'app.actor_employee_id', 'SET') AND has_parameter_privilege('siscom_app', 'app.priv_request_id', 'SET');"
    if ($gp -ne 't') { Fail 'siscom_app chua co quyen SET app.actor_employee_id / app.priv_request_id: migrate M1.2 se loi 42501. Chay lai KHONG kem -SkipGrantSetParameter.' }
    Ok 'siscom_app co quyen SET app.actor_employee_id, app.priv_request_id (toan cluster).'
  }
  $chk = (Run-Psql $psql 'postgres' $adminPw 'postgres' ("SELECT datname || '|' || pg_get_userbyid(datdba) || '|' || pg_encoding_to_char(encoding) FROM pg_database WHERE datname='" + $DatabaseName + "';")).Split('|')
  $adminPw = $null
  if ($chk[0] -ne $DatabaseName -or $chk[1] -ne 'siscom_app' -or $chk[2] -ne 'UTF8') { Fail ('Kiem tra lai that bai: ' + ($chk -join '|')) }
  Ok ('Xac minh: ten=' + $chk[0] + ' owner=' + $chk[1] + ' encoding=' + $chk[2] + ' server=' + $ver)
  Write-Host ''
  Write-Host ('TEN DATABASE THU: ' + $DatabaseName) -ForegroundColor Cyan
  Write-Host 'Buoc tiep (cung thu muc):'
  Write-Host ('  auth-demo-stack.bat -Step migrate   -DatabaseName ' + $DatabaseName)
  Write-Host ('  auth-demo-stack.bat -Step seed      -DatabaseName ' + $DatabaseName)
  Write-Host ('  auth-demo-stack.bat -Step bootstrap -DatabaseName ' + $DatabaseName)
  Write-Host ('  demo-split.bat      -Step split     -DatabaseName ' + $DatabaseName + '   (B1.4: tach role, khuyen nghi cho nghiem thu)')
  Write-Host ('  auth-demo-stack.bat -Step start     -DatabaseName ' + $DatabaseName)
  Write-Host ('Xoa khi khong can (ban tu chay, can mat khau postgres): DROP DATABASE ' + $DatabaseName + ';') -ForegroundColor DarkGray
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally { $adminPw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
