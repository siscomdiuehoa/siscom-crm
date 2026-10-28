# SISCOM CRM B1.3 - TAO DATABASE THU RONG (siscom_crm_test_YYYYMMDD_HHMMSS) de dien tap dang nhap phien cookie / demo 4 vai tro.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\create-test-db.ps1 (file moi). Can mat khau postgres (hoi an, CHI de CREATE DATABASE, khong luu).
# KHONG dung vao siscom_crm_dev hay bat ky database co san (tu choi neu ten da ton tai). Khong DROP/TRUNCATE/DELETE.
# Buoc sau: auth-demo-stack.bat -Step migrate|bootstrap|start -DatabaseName <ten in ra cuoi script>.
# -GrantSetParameter: GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id TO siscom_app (PostgreSQL >= 15; pham vi TOAN CLUSTER,
#   chi can cho cac ham fn_auth_api_* cua M1.2 - dieu kien trien khai ghi o PR #166). Dang nhap/dang xuat/khach hang KHONG can quyen nay.
[CmdletBinding()]
param(
  [ValidateSet('test', 'restore')][string]$Kind = 'test',
  [string]$DatabaseName,
  [switch]$GrantSetParameter
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
function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Run-Psql([string]$psql, [string]$user, [string]$pw, [string]$db, [string]$sql) {
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = $sql | & $psql -X -q -t -A -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U $user -d $db -f - 2>$null
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
  $adminPw = Read-Secret 'Mat khau tai khoan postgres (chi de TAO database thu; khong luu)'
  $ver = Run-Psql $psql 'postgres' $adminPw 'postgres' 'SHOW server_version_num;'
  if ((Run-Psql $psql 'postgres' $adminPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname='" + $DatabaseName + "';")) -eq '1') { Fail ('Database ' + $DatabaseName + ' da ton tai (khong ghi de).') }
  if ((Run-Psql $psql 'postgres' $adminPw 'postgres' "SELECT 1 FROM pg_roles WHERE rolname='siscom_app';") -ne '1') { Fail 'Chua co tai khoan siscom_app (chay setup-db.bat truoc).' }
  Run-Psql $psql 'postgres' $adminPw 'postgres' ('CREATE DATABASE ' + $DatabaseName + " OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0;") | Out-Null
  Run-Psql $psql 'postgres' $adminPw 'postgres' ('REVOKE ALL ON DATABASE ' + $DatabaseName + ' FROM PUBLIC; GRANT CONNECT ON DATABASE ' + $DatabaseName + ' TO siscom_app;') | Out-Null
  Ok ('Da tao database ' + $DatabaseName + ' (chu so huu siscom_app)')
  if ($GrantSetParameter) {
    if ([int]$ver -lt 150000) { Write-Host '[BO QUA] GRANT SET ON PARAMETER chi co tu PostgreSQL 15.' -ForegroundColor Yellow }
    else {
      Run-Psql $psql 'postgres' $adminPw 'postgres' 'GRANT SET ON PARAMETER app.actor_employee_id TO siscom_app; GRANT SET ON PARAMETER app.priv_request_id TO siscom_app;' | Out-Null
      Ok 'Da GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id cho siscom_app (toan cluster).'
    }
  }
  $chk = (Run-Psql $psql 'postgres' $adminPw 'postgres' ("SELECT datname || '|' || pg_get_userbyid(datdba) || '|' || pg_encoding_to_char(encoding) FROM pg_database WHERE datname='" + $DatabaseName + "';")).Split('|')
  $adminPw = $null
  if ($chk[0] -ne $DatabaseName -or $chk[1] -ne 'siscom_app' -or $chk[2] -ne 'UTF8') { Fail ('Kiem tra lai that bai: ' + ($chk -join '|')) }
  Ok ('Xac minh: ten=' + $chk[0] + ' owner=' + $chk[1] + ' encoding=' + $chk[2] + ' server=' + $ver)
  Write-Host ''
  Write-Host ('TEN DATABASE THU: ' + $DatabaseName) -ForegroundColor Cyan
  Write-Host 'Buoc tiep (cung thu muc):'
  Write-Host ('  auth-demo-stack.bat -Step migrate   -DatabaseName ' + $DatabaseName)
  Write-Host ('  auth-demo-stack.bat -Step bootstrap -DatabaseName ' + $DatabaseName)
  Write-Host ('  auth-demo-stack.bat -Step start     -DatabaseName ' + $DatabaseName)
  Write-Host ('Xoa khi khong can (ban tu chay, can mat khau postgres): DROP DATABASE ' + $DatabaseName + ';') -ForegroundColor DarkGray
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally { $adminPw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
