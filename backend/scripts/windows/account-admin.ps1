# SISCOM CRM FV-5 - QUAN LY TAI KHOAN NHAN VIEN (them / dat lai mat khau / khoa / liet ke) SAU khi bootstrap da dong.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\account-admin.ps1 (file moi). Huong dan: docs\FV5_ACCOUNT_ADMIN.md.
# Goi CLI node dist\cli\account-admin.js (can "npm run build" truoc) bang chu so huu DB (siscom_migrator) qua MIGRATE_DATABASE_URL.
# AN TOAN:
#   - Mac dinh CHI database thu (siscom_crm_test_* / siscom_crm_restore_*) tren cum demo (cong 55433 hoac -PgPort). CLI tu kiem lai ten DB
#     (current_database()), tu choi siscom_crm_dev / baseline khoa / bootstrap con mo / khong phai chu so huu.
#   - Database THAT: chi khi Owner DUYET RIENG -> -AllowDb <ten database> (phai khop dung ten). Cong 5432 can them -AllowMainCluster.
#   - Mat khau siscom_migrator: lay tu bien moi truong MIGRATE_DATABASE_URL neu da dat; neu khong, doc MIGRATOR_PW trong
#     D:\SISCOM-CRM-demo-pg\private\roles-<cong>.secrets (do demo-split.ps1 sinh, ACL chi Owner). KHONG in, chi truyen cho tien trinh con.
#   - Mat khau nhan vien do CLI sinh ngau nhien, KHONG in; ghi vao file -Out MOI (khong ghi de), quyen chi nguoi chay.
#   - Moi thao tac ghi: CLI hoi go lai ten database de xac nhan (khong co -Yes).
# Rollback: tai khoan tao nham => "-Command disable" (khoa dang nhap, thu hoi moi phien). Khong xoa nhan vien (DB chan DELETE employee).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'reset-password', 'disable', 'list')][string]$Command,
  [string]$DatabaseName,
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [string]$Requester, [string]$Approver, [string]$Employee,
  [string]$Email, [string]$FullName, [string]$Department,
  [ValidateSet('', 'sales', 'technician', 'accountant')][string]$Role = '', # crm_admin: tam cam (Owner 08/11/2026)
  [string]$Phone, [string]$Title, [string]$Reason, [string]$Out,
  [string]$AllowDb,
  [switch]$AllowMainCluster,
  [switch]$Demo
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }

$backend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cli = Join-Path $backend 'dist\cli\account-admin.js'
if (-not (Test-Path -LiteralPath $cli)) { Fail ('Chua build: khong thay ' + $cli + '. Chay "npm run build" trong backend truoc.') }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Khong tim thay node (can Node.js 24).' }
$ver = (& $node.Source -v)
if ($ver -notmatch '^v24\.') { Fail ('Can Node.js 24 (dang ' + $ver + ').') }

$url = $env:MIGRATE_DATABASE_URL
if (-not $url) {
  if (-not $DatabaseName) { Fail 'Thieu -DatabaseName (hoac dat san MIGRATE_DATABASE_URL).' }
  if ($PgPort -eq 5432 -and -not $AllowMainCluster) { Fail 'Cong 5432 (cum chinh) can -AllowMainCluster va -AllowDb <ten database> (Owner duyet rieng).' }
  if (-not $AllowDb -and $DatabaseName -notmatch '^siscom_crm_(test|restore)_\d{8}_\d{6}$') { Fail ('"' + $DatabaseName + '" khong phai database thu. Database that: Owner duyet rieng roi them -AllowDb ' + $DatabaseName + '.') }
  $sf = Join-Path 'D:\SISCOM-CRM-demo-pg\private' ('roles-' + $PgPort + '.secrets')
  if (-not (Test-Path -LiteralPath $sf)) { Fail ('Khong co ' + $sf + ' (chay demo-split.bat -Step split truoc) va chua dat MIGRATE_DATABASE_URL.') }
  $pw = $null
  foreach ($l in Get-Content -LiteralPath $sf) { if ($l -match '^MIGRATOR_PW=([0-9a-f]{64})$') { $pw = $Matches[1] } }
  if (-not $pw) { Fail ('File ' + $sf + ' khong co MIGRATOR_PW hop le.') }
  $url = 'postgresql://siscom_migrator:' + $pw + '@127.0.0.1:' + $PgPort + '/' + $DatabaseName
} else {
  if ($url -match ':5432/' -and -not $AllowMainCluster) { Fail 'MIGRATE_DATABASE_URL tro cong 5432: can -AllowMainCluster va -AllowDb (Owner duyet rieng).' }
}

$a = @($Command)
$map = [ordered]@{ '--requester' = $Requester; '--approver' = $Approver; '--employee' = $Employee; '--email' = $Email; '--full-name' = $FullName;
  '--department' = $Department; '--role' = $Role; '--phone' = $Phone; '--title' = $Title; '--reason' = $Reason; '--out' = $Out; '--allow-db' = $AllowDb }
foreach ($k in $map.Keys) { if ($map[$k]) { $a += $k; $a += [string]$map[$k] } }
if ($Demo) { $a += '--demo' }

$prev = $env:MIGRATE_DATABASE_URL
try {
  $env:MIGRATE_DATABASE_URL = $url
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  & $node.Source $cli @a
  $rc = $LASTEXITCODE
} finally {
  if ($null -eq $prev) { Remove-Item Env:MIGRATE_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:MIGRATE_DATABASE_URL = $prev }
  $url = $null; $pw = $null
}
exit $rc
