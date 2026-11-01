# SISCOM CRM B1.4 - TACH ROLE cho DATABASE THU de demo/nghiem thu dung kien truc bao mat (S1 + P3b/P3c + Remember Me):
#   siscom_migrator = chu so huu (DDL, migrate), siscom_app = pool nghiep vu (DML toi thieu), siscom_auth = pool xac thuc (phien, ghi nho).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-split.ps1 (file moi). Runbook: docs\B1.4_DEMO_WINDOWS_RUNBOOK.md.
# CHI database thu (siscom_crm_test_* / siscom_crm_restore_*). TU CHOI siscom_crm_dev va 2 baseline da khoa. Khong DROP/TRUNCATE/DELETE.
#   -Step split  : (superuser postgres) B1.3_S1_ROLE_SPLIT -> B1.3_S1_AUTH_ROLE -> (siscom_migrator) B1.3_S1_APP_GRANTS_V3 x2
#                  -> VERIFY (siscom_app) + VERIFY_AUTH (superuser). Chay SAU auth-demo-stack migrate/seed/bootstrap (DB con thuoc siscom_app).
#   -Step migrate: DB DA tach: prisma migrate deploy bang siscom_migrator, roi CHAY LAI V3 + VERIFY/VERIFY_AUTH (bang moi nhan SELECT mac dinh
#                  cho siscom_app - VERIFY B1f bat neu quen; xem B1.4_REMEMBER_ME_90D_DESIGN.md §2).
#   -Step verify : CHI DOC: VERIFY (siscom_app) + VERIFY_AUTH (superuser).
# Mat khau:
#   - postgres: hoi an moi lan (khong luu). -NonInteractive: lay tu bien SISCOM_PG_ADMIN_PASSWORD (chi danh cho dien tap tu dong).
#   - siscom_app: doc tu DATABASE_URL trong backend\.env (nhu auth-demo-stack), khong in.
#   - siscom_migrator / siscom_auth (role CAP CLUSTER): neu chua co thi SINH NGAU NHIEN 64 ky tu hex; luu vao
#     %LOCALAPPDATA%\SISCOM-CRM\demo\roles-<port>.secrets (NGOAI repo; quyen file chi tai khoan Windows hien tai). Role da co ma file chua
#     co mat khau => hoi an (khong doi mat khau role). Truyen cho psql qua stdin (\set), KHONG qua dong lenh, khong in.
# Luu y cap cluster: ROLE_SPLIT dung REASSIGN OWNED co snapshot/khoi phuc chu so huu DB khac (C1) va AUTH_ROLE cap CONNECT/SET (xem
#   backend\docs\DB_SECURITY.md). Rollback: B1.3_S1_AUTH_ROLE_ROLLBACK -> B1.3_S1_ROLE_SPLIT_ROLLBACK (superuser, xem runbook).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('split', 'migrate', 'verify')][string]$Step,
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$EnvPath,
  [ValidateRange(1024, 65535)][int]$PgPort = 5432,
  [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
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
function New-RandomSecret() {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Get-AppPasswordFromEnv([string]$envPath, [int]$port) {
  if (-not (Test-Path -LiteralPath $envPath)) { Fail ('Khong thay file .env: ' + $envPath + ' (dung -EnvPath D:\SISCOM-CRM\backend\.env).') }
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
  $p = $u.Port; if ($p -lt 0) { $p = 5432 }
  if ($user -ne 'siscom_app' -or $u.Host -ne '127.0.0.1' -or $p -ne $port) { Fail ('DATABASE_URL trong .env phai la siscom_app@127.0.0.1:' + $port + ' (chi doi chieu tai khoan; khong ket noi DB trong .env).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  return $pw
}
# Chay psql; $vars => \set <ten> '<gia tri>' qua STDIN (gia tri chi gom ky tu an toan); $file => \i <file>; $sql => cau lenh.
function Invoke-Psql([string]$user, [string]$pw, [string]$db, [hashtable]$vars, [string]$file, [string]$sql, [switch]$Raw) {
  $lines = @()
  if ($vars) { foreach ($k in $vars.Keys) { $v = [string]$vars[$k]; if ($v -notmatch '^[A-Za-z0-9_]*$') { Fail ('Gia tri bien psql ' + $k + ' co ky tu khong cho phep.') }; $lines += ('\set ' + $k + " '" + $v + "'") } }
  if ($file) { $lines += ("\i '" + ($file -replace '\\', '/') + "'") }
  if ($sql) { $lines += $sql }
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = ($lines -join "`n") | & $script:psql -X -q -w -h 127.0.0.1 -p $PgPort -U $user -d $db -v ON_ERROR_STOP=1 -t -A -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; $lines = $null }
  $text = (($out | ForEach-Object { $_.ToString() }) -join "`n")
  if ($code -ne 0) { Fail ('psql (' + $user + ' @ ' + $db + ') ma thoat ' + $code + ': ' + (($text -split "`n" | Select-Object -Last 6) -join ' | ')) }
  if ($Raw) { return $text } else { return $text.Trim() }
}
function Assert-Pass([string]$label, [string]$out) {
  $fails = @($out -split "`n" | Where-Object { $_ -match '=> KHONG DAT' })
  $pass = @($out -split "`n" | Where-Object { $_ -match '^PASS\|\d+$' })
  $failSum = @($out -split "`n" | Where-Object { $_ -match '^FAIL\|\d+$' })
  if ($fails.Count -gt 0 -or $failSum.Count -gt 0 -or $pass.Count -eq 0) {
    $fails | ForEach-Object { Say ('  ' + $_) 'Red' }
    Fail ($label + ' KHONG DAT. Khong ghi them gi; gui anh chup man hinh nay.')
  }
  Ok ($label + ' ' + $pass[-1])
}
$secretsFile = $null; $adminPw = $null; $appPw = $null; $migPw = $null; $authPw = $null
try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $docs = Join-Path $root 'docs'
  if (-not $EnvPath) { $EnvPath = Join-Path $root '.env'; if (-not (Test-Path -LiteralPath $EnvPath) -and (Test-Path -LiteralPath 'D:\SISCOM-CRM\backend\.env')) { $EnvPath = 'D:\SISCOM-CRM\backend\.env' } }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  if ($DatabaseName -notmatch '^siscom_crm_(restore|test)_\d{8}_\d{6}$') { Fail 'Ten database phai la siscom_crm_test_YYYYMMDD_HHMMSS (hoac siscom_crm_restore_...). siscom_crm_dev bi tu choi.' }
  if (@('siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948') -contains $DatabaseName) { Fail ($DatabaseName + ' la baseline da khoa, khong duoc thay doi.') }
  $ghi = ' (GHI: role/quyen cap cluster va database thu)'; if ($Step -eq 'verify') { $ghi = ' (CHI DOC)' }
  Say ('Database thu: ' + $DatabaseName + ' | cong ' + $PgPort + ' | Buoc: ' + $Step + $ghi) 'Yellow'
  if (-not $NonInteractive -and $Step -ne 'verify') {
    $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
    if ($c -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  }
  if ($NonInteractive) { $adminPw = $env:SISCOM_PG_ADMIN_PASSWORD; if (-not $adminPw) { Fail 'Che do khong tuong tac can bien SISCOM_PG_ADMIN_PASSWORD.' } }
  else { $adminPw = Read-Secret 'Mat khau tai khoan postgres (khong luu)' }
  $appPw = Get-AppPasswordFromEnv $EnvPath $PgPort
  Say 'Mat khau siscom_app lay tu .env (khong in).'

  $info = (Invoke-Psql 'postgres' $adminPw 'postgres' $null $null ("SELECT coalesce((SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '" + $DatabaseName + "'), '<khong co>') || '|' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text || '|' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_migrator')::text || '|' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_auth')::text;")).Split('|')
  $owner = $info[0]; if ($owner -eq '<khong co>') { Fail ('Chua co database ' + $DatabaseName + ' (tao bang create-test-db.bat).') }
  if ($info[1] -ne 'true') { Fail 'Tai khoan postgres phai la superuser.' }
  $hasMig = $info[2] -eq 'true'; $hasAuth = $info[3] -eq 'true'
  Say ('Chu so huu hien tai: ' + $owner + ' | role siscom_migrator: ' + $hasMig + ' | role siscom_auth: ' + $hasAuth)

  # Mat khau role cap cluster: file ngoai repo, chi tai khoan hien tai doc duoc.
  $dir = Join-Path $env:LOCALAPPDATA 'SISCOM-CRM\demo'
  $secretsFile = Join-Path $dir ('roles-' + $PgPort + '.secrets')
  $sec = @{}
  if (Test-Path -LiteralPath $secretsFile) { foreach ($l in Get-Content -LiteralPath $secretsFile) { if ($l -match '^(MIGRATOR_PW|AUTH_PW)=([0-9a-f]{64})$') { $sec[$Matches[1]] = $Matches[2] } } }
  $changed = $false
  foreach ($pair in @(@('MIGRATOR_PW', $hasMig, 'siscom_migrator'), @('AUTH_PW', $hasAuth, 'siscom_auth'))) {
    $k = $pair[0]; $exists = $pair[1]; $role = $pair[2]
    if ($sec.ContainsKey($k)) { continue }
    if (-not $exists) { $sec[$k] = New-RandomSecret; $changed = $true; Say ('Sinh mat khau ngau nhien cho role moi ' + $role + ' (luu ngoai repo, khong in).') }
    elseif ($Step -ne 'verify') {
      if ($NonInteractive) { Fail ('Role ' + $role + ' da ton tai nhung file mat khau chua co: chay khong kem -NonInteractive de nhap.') }
      $v = Read-Secret ('Role ' + $role + ' da ton tai. Nhap mat khau HIEN TAI cua no (64 ky tu hex do script sinh truoc day; khong doi mat khau role)')
      if ($v -notmatch '^[0-9a-f]{64}$') { Fail 'Mat khau phai la 64 ky tu hex (dinh dang do script sinh). Role tao bang cach khac: dat lai mat khau theo runbook.' }
      $sec[$k] = $v; $changed = $true; $v = $null
    }
  }
  if ($changed) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Set-Content -LiteralPath $secretsFile -Encoding ASCII -Value @(('MIGRATOR_PW=' + $sec['MIGRATOR_PW']), ('AUTH_PW=' + $sec['AUTH_PW']))
    & icacls.exe $secretsFile /inheritance:r /grant:r ($env:USERNAME + ':(R,W)') | Out-Null
    Ok ('Da luu mat khau role vao ' + $secretsFile + ' (chi tai khoan ' + $env:USERNAME + ').')
  }
  $migPw = $sec['MIGRATOR_PW']; $authPw = $sec['AUTH_PW']

  switch ($Step) {
    'split' {
      if ($owner -eq 'siscom_app') {
        $boot = Invoke-Psql 'postgres' $adminPw $DatabaseName $null $null "SELECT coalesce((SELECT NOT public.fn_auth_bootstrap_open())::text, 'chua migrate');"
        if ($boot -eq 'chua migrate') { Fail 'DB chua migrate. Chay auth-demo-stack migrate / seed / bootstrap TRUOC khi tach role.' }
        if ($boot -ne 'true') { Say 'CANH BAO: DB chua bootstrap tai khoan. Sau khi tach role, bootstrap phai chay bang siscom_migrator (xem runbook).' 'Yellow' }
        Say '--- 1/5 ROLE_SPLIT (superuser): siscom_migrator thanh chu so huu ---' 'Cyan'
        Invoke-Psql 'postgres' $adminPw $DatabaseName @{ target_db = $DatabaseName; migrator_pw = $migPw } (Join-Path $docs 'B1.3_S1_ROLE_SPLIT.sql.txt') $null | Out-Null
        Ok 'ROLE_SPLIT xong.'
      } elseif ($owner -eq 'siscom_migrator') { Say 'DB da thuoc siscom_migrator: bo qua ROLE_SPLIT (chay lai cac buoc idempotent).' 'Yellow' }
      else { Fail ('Chu so huu DB la "' + $owner + '" (khong phai siscom_app/siscom_migrator). Dung lai.') }
      Say '--- 2/5 AUTH_ROLE (superuser): role siscom_auth + CONNECT/SET ---' 'Cyan'
      Invoke-Psql 'postgres' $adminPw $DatabaseName @{ target_db = $DatabaseName; auth_pw = $authPw } (Join-Path $docs 'B1.3_S1_AUTH_ROLE.sql.txt') $null | Out-Null
      Ok 'AUTH_ROLE xong.'
      foreach ($n in 1, 2) {
        Say ('--- ' + (2 + $n) + '/5 APP_GRANTS_V3 lan ' + $n + ' (siscom_migrator, idempotent) ---') 'Cyan'
        Invoke-Psql 'siscom_migrator' $migPw $DatabaseName @{ target_db = $DatabaseName } (Join-Path $docs 'B1.3_S1_APP_GRANTS_V3.sql.txt') $null | Out-Null
      }
      Ok 'APP_GRANTS_V3 x2 xong.'
    }
    'migrate' {
      if ($owner -ne 'siscom_migrator') { Fail 'Buoc migrate nay chi cho DB DA tach role. DB chua tach: dung auth-demo-stack -Step migrate.' }
      Say '--- prisma migrate deploy bang siscom_migrator ---' 'Cyan'
      $migUrl = 'postgresql://siscom_migrator:' + $migPw + '@127.0.0.1:' + $PgPort + '/' + $DatabaseName
      $appUrl = 'postgresql://siscom_app:' + [uri]::EscapeDataString($appPw) + '@127.0.0.1:' + $PgPort + '/' + $DatabaseName
      Push-Location $root
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { $env:DATABASE_URL = $appUrl; $env:MIGRATE_DATABASE_URL = $migUrl; & npx.cmd prisma migrate deploy | Out-Host; $c1 = $LASTEXITCODE; & npx.cmd prisma migrate status | Out-Host; $c2 = $LASTEXITCODE }
      finally { $ErrorActionPreference = $prev; Remove-Item Env:DATABASE_URL, Env:MIGRATE_DATABASE_URL -ErrorAction SilentlyContinue; Pop-Location; $migUrl = $null; $appUrl = $null }
      if ($c1 -ne 0 -or $c2 -ne 0) { Fail 'migrate deploy/status that bai. KHONG chay lai; gui log.' }
      Ok 'migrate deploy xong. BAT BUOC chay lai V3 (bang moi nhan SELECT mac dinh cho siscom_app).'
      Invoke-Psql 'siscom_migrator' $migPw $DatabaseName @{ target_db = $DatabaseName } (Join-Path $docs 'B1.3_S1_APP_GRANTS_V3.sql.txt') $null | Out-Null
      Ok 'APP_GRANTS_V3 chay lai xong.'
    }
  }
  Say '--- Kiem tra quyen: VERIFY (siscom_app) + VERIFY_AUTH (superuser -> SET ROLE siscom_auth) ---' 'Cyan'
  Assert-Pass 'VERIFY (pool nghiep vu siscom_app)' (Invoke-Psql 'siscom_app' $appPw $DatabaseName $null (Join-Path $docs 'B1.3_S1_VERIFY.sql.txt') $null -Raw)
  Assert-Pass 'VERIFY_AUTH (pool xac thuc siscom_auth)' (Invoke-Psql 'postgres' $adminPw $DatabaseName $null (Join-Path $docs 'B1.3_S1_VERIFY_AUTH.sql.txt') $null -Raw)
  Write-Host ''
  Say ('DATABASE THU DA TACH ROLE: ' + $DatabaseName) 'Cyan'
  Say ('Buoc tiep: auth-demo-stack.bat -Step start -DatabaseName ' + $DatabaseName + '   (tu dat AUTH_DATABASE_URL = siscom_auth)')
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  $adminPw = $null; $appPw = $null; $migPw = $null; $authPw = $null; $sec = $null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
