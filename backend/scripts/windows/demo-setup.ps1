# SISCOM CRM B1.4 - DUNG BAN DEMO MOT CHAM tren CUM PostgreSQL DEMO RIENG (khong dung PostgreSQL hien tai cong 5432).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-setup.ps1 (file moi). Runbook: docs\B1.4_DEMO_WINDOWS_RUNBOOK.md.
# Lam lan luot (dung ngay khi mot buoc loi):
#   1. Cum demo: chua co => demo-pg init (cong -PgPort, mac dinh 55433, cluster_name siscom_demo); co roi => demo-pg start.
#   2. Build backend + frontend neu chua co dist (hoac -Build): npm run build (backend, DATABASE_URL gia chi de prisma generate) va
#      vite build voi VITE_CRM_AUTH_ENABLED/VITE_CRM_API_ENABLED=true, VITE_CRM_API_BASE=/api/v1. Can npm ci truoc (runbook muc 1).
#   3. create-test-db -> auth-demo-stack migrate / seed / bootstrap -> demo-split split (tat ca -NonInteractive, chi cum demo).
#      Mat khau 5 tai khoan demo (sysadmin/admin/sale/kythuat/ketoan@siscom.local) SINH NGAU NHIEN, luu TRUOC khi bootstrap vao
#      %LOCALAPPDATA%\SISCOM-CRM\demo\accounts-<db>.txt (ACL chi tai khoan hien tai) - anh mo file nay de lay mat khau dang nhap.
#   4. Ghi ten DB demo hien hanh vao %LOCALAPPDATA%\SISCOM-CRM\demo\current-<port>.txt (demo-run.ps1 doc).
# Moi lan chay tao MOT database demo moi (siscom_crm_test_<thoi diem>); DB cu giu nguyen tren cum demo.
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [string]$DataDir = 'D:\SISCOM-CRM-demo-pg\data',
  [switch]$Build,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Protect-File([string]$file) {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & icacls.exe $file /inheritance:r /grant:r ('*' + $sid + ':(R,W)') 2>&1 | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($code -ne 0) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; Fail ('Khong dat duoc quyen rieng cho ' + $file + ' (icacls ma ' + $code + ').') }
}
function New-AccountPassword() {
  # 20 ky tu tu bang chu/so de doc (khong 0/O/1/l/I) + hau to dam bao chinh sach (>= 12, co chu hoa/thuong/so/ky hieu)
  $alphabet = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $bytes = New-Object byte[] 20
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ((($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }) -join '') + '#Sc9')
}
function Run-Step([string]$title, [string]$script, [string[]]$scriptArgs) {
  Say ''; Say ('=== ' + $title + ' ===') 'Cyan'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $script) @scriptArgs | Out-Host; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($code -ne 0) { Fail ($title + ' that bai (ma ' + $code + '). Dung lai; xem thong bao o tren.') }
}
$keys = @('SYSADMIN', 'ADMIN', 'SALE', 'TECHNICIAN', 'ACCOUNTANT')
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai: ban demo chi dung cum demo rieng (mac dinh 55433).' }
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $fe = (Resolve-Path (Join-Path $root '..\frontend\siscom-crm-web')).Path
  $dir = Join-Path $env:LOCALAPPDATA 'SISCOM-CRM\demo'
  Say ('Dung ban demo SISCOM CRM tren cum PostgreSQL DEMO 127.0.0.1:' + $PgPort + ' (' + $DataDir + '). KHONG dung PostgreSQL cong 5432.') 'Yellow'
  if (-not $Yes) { $c = Read-Host 'Go TAO-DEMO de bat dau'; if ($c -ne 'TAO-DEMO') { Fail 'Khong xac nhan. Dung lai.' } }

  if (Test-Path -LiteralPath (Join-Path $DataDir 'PG_VERSION')) { Run-Step '1. Khoi dong cum demo' 'demo-pg.ps1' @('-Step', 'start', '-PgPort', [string]$PgPort, '-DataDir', $DataDir) }
  else { Run-Step '1. Tao cum PostgreSQL demo moi' 'demo-pg.ps1' @('-Step', 'init', '-PgPort', [string]$PgPort, '-DataDir', $DataDir) }

  Say ''; Say '=== 2. Build backend + frontend (neu can) ===' 'Cyan'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($Build -or -not (Test-Path -LiteralPath (Join-Path $root 'dist\main.js'))) {
      if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) { Fail 'backend chua co node_modules: chay "npm ci" trong backend truoc (runbook muc 1).' }
      Push-Location $root; $env:DATABASE_URL = 'postgresql://build:build@127.0.0.1:1/siscom_crm_test_20000101_000000'
      try { & npm.cmd run build | Out-Host; $c1 = $LASTEXITCODE } finally { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; Pop-Location }
      if ($c1 -ne 0) { Fail 'Build backend that bai.' }
    }
    if ($Build -or -not (Test-Path -LiteralPath (Join-Path $fe 'dist\index.html'))) {
      if (-not (Test-Path -LiteralPath (Join-Path $fe 'node_modules'))) { Fail 'frontend chua co node_modules: chay "npm ci" trong frontend\siscom-crm-web truoc (runbook muc 1).' }
      Push-Location $fe; $env:VITE_CRM_AUTH_ENABLED = 'true'; $env:VITE_CRM_API_ENABLED = 'true'; $env:VITE_CRM_API_BASE = '/api/v1'
      try { & npm.cmd run build | Out-Host; $c2 = $LASTEXITCODE } finally { Remove-Item Env:VITE_CRM_AUTH_ENABLED, Env:VITE_CRM_API_ENABLED, Env:VITE_CRM_API_BASE -ErrorAction SilentlyContinue; Pop-Location }
      if ($c2 -ne 0) { Fail 'Build frontend that bai.' }
    }
  } finally { $ErrorActionPreference = $prev }
  Ok 'Backend dist + frontend dist san sang.'

  $db = 'siscom_crm_test_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
  $common = @('-DatabaseName', $db, '-PgPort', [string]$PgPort, '-NonInteractive')
  Run-Step ('3. Tao database demo ' + $db) 'create-test-db.ps1' $common
  Run-Step '4. Migrate' 'auth-demo-stack.ps1' (@('-Step', 'migrate') + $common)
  Run-Step '5. Danh muc chuan (seed)' 'auth-demo-stack.ps1' (@('-Step', 'seed') + $common)

  # Mat khau tai khoan demo: sinh + LUU TRUOC bootstrap (bootstrap chi chay duoc 1 lan/DB).
  $acc = Join-Path $dir ('accounts-' + $db + '.txt')
  $mails = @{ SYSADMIN = 'sysadmin'; ADMIN = 'admin'; SALE = 'sale'; TECHNICIAN = 'kythuat'; ACCOUNTANT = 'ketoan' }
  $roles = @{ SYSADMIN = 'quan tri ky thuat'; ADMIN = 'crm_admin (toan quyen CRM)'; SALE = 'sales (khach cua minh)'; TECHNICIAN = 'technician (doc theo phong)'; ACCOUNTANT = 'accountant (doc tat ca)' }
  $lines = @(('# Tai khoan demo SISCOM CRM - database ' + $db + ' (cum demo cong ' + $PgPort + '). Mat khau ngau nhien, chi tren may nay.'), '# Dang nhap: http://127.0.0.1:4173 (sau demo-run.bat). Doi mat khau ngay sau lan dang nhap dau neu muon.', '')
  foreach ($k in $keys) { $pw = New-AccountPassword; Set-Item -Path ('Env:BOOTSTRAP_PASSWORD_' + $k) -Value $pw; $lines += ('{0,-28} {1,-22} {2}' -f ($mails[$k] + '@siscom.local'), $pw, $roles[$k]) }
  Set-Content -LiteralPath $acc -Encoding ASCII -Value $lines; Protect-File $acc; $lines = $null
  Ok ('Mat khau 5 tai khoan demo da luu: ' + $acc + ' (chi tai khoan Windows hien tai).')
  Run-Step '6. Tao tai khoan demo (bootstrap)' 'auth-demo-stack.ps1' (@('-Step', 'bootstrap') + $common)
  Run-Step '7. Tach role (3 role, 2 pool) + kiem quyen' 'demo-split.ps1' (@('-Step', 'split') + $common)

  $cur = Join-Path $dir ('current-' + $PgPort + '.txt')
  Set-Content -LiteralPath $cur -Encoding ASCII -Value $db
  Say ''
  Say ('BAN DEMO DA SAN SANG: database ' + $db + ' tren cum demo cong ' + $PgPort + '.') 'Cyan'
  Say ('Chay: demo-run.bat   (mo backend + giao dien + trinh duyet). Tai khoan: ' + $acc)
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  foreach ($k in $keys) { Remove-Item -Path ('Env:BOOTSTRAP_PASSWORD_' + $k) -ErrorAction SilentlyContinue }
}
