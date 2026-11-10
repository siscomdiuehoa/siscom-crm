# SISCOM CRM FV-5 - QUAN LY TAI KHOAN NHAN VIEN (them / dat lai mat khau / khoa / liet ke) SAU khi bootstrap da dong.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\account-admin.ps1 (file moi). Huong dan: docs\FV5_ACCOUNT_ADMIN.md.
# Goi CLI node dist\cli\account-admin.js (can "npm run build" truoc) bang chu so huu DB (siscom_migrator) qua MIGRATE_DATABASE_URL.
# AN TOAN (FV5-DB-GUARD, Owner 10/11/2026):
#   - CHI PostgreSQL THU cach ly: 127.0.0.1 / localhost, cong 55470, database siscom_crm_test_* / siscom_crm_restore_*.
#     KHONG co tham so nao de tro sang database khac (da bo -AllowDb, -AllowMainCluster, -DatabaseName, -PgPort). Cum demo 55433 va
#     cum chinh 5432 bi tu choi o day VA trong CLI (truoc khi mo ket noi; CLI con doi chieu cong that cua may chu sau khi ket noi).
#   - BAT BUOC dat san bien moi truong MIGRATE_DATABASE_URL cho DATABASE THU (siscom_migrator). Script KHONG doc file bi mat nao,
#     KHONG in URL/mat khau, chi truyen bien cho tien trinh con.
#   - Mat khau nhan vien do CLI sinh ngau nhien, KHONG in; ghi vao file -Out MOI (khong ghi de), quyen chi nguoi chay.
#   - Moi thao tac ghi: CLI hoi go lai ten database de xac nhan (khong co -Yes).
# Rollback: tai khoan tao nham => "-Command disable" (khoa dang nhap, thu hoi moi phien). Khong xoa nhan vien (DB chan DELETE employee).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'reset-password', 'disable', 'unlock', 'list')][string]$Command,
  [string]$Requester, [string]$Approver, [string]$Employee,
  [string]$Email, [string]$FullName, [string]$Department,
  [ValidateSet('', 'sales', 'technician', 'accountant')][string]$Role = '', # crm_admin: tam cam (Owner 08/11/2026)
  [string]$Phone, [string]$Title, [string]$Reason, [string]$Out,
  [string]$ConfirmUnlock, # chi cho -Command unlock: go lai DUNG ma nhan vien can mo khoa (F225-C)
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
if (-not $url) { Fail 'Thieu bien moi truong MIGRATE_DATABASE_URL (chi database THU tai 127.0.0.1:55470). Script khong tu doc mat khau tu file nao.' }
# Kiem som (CLI kiem lai day du): dung may cuc bo, dung cong 55470, dung mau ten database thu, khong kem tham so. Khong in URL.
if ($url -notmatch '^postgres(ql)?://[^@/?#]+@(127\.0\.0\.1|localhost):55470/siscom_crm_(test|restore)_\d{8}_\d{6}$') {
  Fail 'MIGRATE_DATABASE_URL khong tro vao PostgreSQL THU (127.0.0.1 hoac localhost, cong 55470, database siscom_crm_test_*/siscom_crm_restore_*). Tu choi.'
}

$a = @($Command)
$map = [ordered]@{ '--requester' = $Requester; '--approver' = $Approver; '--employee' = $Employee; '--email' = $Email; '--full-name' = $FullName;
  '--department' = $Department; '--role' = $Role; '--phone' = $Phone; '--title' = $Title; '--reason' = $Reason; '--out' = $Out; '--confirm-unlock' = $ConfirmUnlock }
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
  $url = $null
}
exit $rc
