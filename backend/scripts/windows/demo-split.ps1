# SISCOM CRM B1.4 - TACH ROLE cho DATABASE THU de demo/nghiem thu dung kien truc bao mat (S1 + P3b/P3c + Remember Me):
#   siscom_migrator = chu so huu (DDL, migrate), siscom_app = pool nghiep vu (DML toi thieu), siscom_auth = pool xac thuc (phien, ghi nho).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-split.ps1 (file moi). Runbook: docs\B1.4_DEMO_WINDOWS_RUNBOOK.md.
# CHI database thu (siscom_crm_test_* / siscom_crm_restore_*). TU CHOI siscom_crm_dev va 2 baseline da khoa. Khong DROP/TRUNCATE/DELETE.
#   -Step split  : kiem dieu kien (CHI DOC: da migrate du, da seed, da bootstrap, mat khau role dung, log server khong ghi lenh) roi
#                  (superuser) B1.3_S1_ROLE_SPLIT -> B1.3_S1_AUTH_ROLE -> (siscom_migrator) B1.3_S1_APP_GRANTS_V3 x2 -> VERIFY + VERIFY_AUTH.
#   -Step migrate: DB DA tach: prisma migrate deploy bang siscom_migrator, roi CHAY LAI V3 + VERIFY/VERIFY_AUTH (bang moi nhan SELECT mac dinh
#                  cho siscom_app - VERIFY B1f bat neu quen; xem B1.4_REMEMBER_ME_90D_DESIGN.md muc 2).
#   -Step verify : KHONG doi quyen/du lieu: VERIFY (siscom_app) + VERIFY_AUTH (superuser). Luu y: VERIFY goi nextval(customer_code_seq) trong
#                  transaction da ROLLBACK => sequence ma khach van tang 1 moi lan chay (sequence khong rollback; vo hai).
#   -Step resetpw: (superuser) DAT LAI mat khau siscom_migrator / siscom_auth (sinh ngau nhien moi, luu file) khi file mat khau mat/khong khop.
# Mat khau:
#   - postgres: cum demo => doc tu %LOCALAPPDATA%\SISCOM-CRM\demo\pg-<port>.secrets (bat buoc). Chi khi -AllowMainCluster (owner duyet) moi hoi an / SISCOM_PG_ADMIN_PASSWORD.
#   - siscom_app: doc tu DATABASE_URL trong backend\.env (nhu auth-demo-stack), khong in.
#   - siscom_migrator / siscom_auth (role CAP CLUSTER): role chua co => SINH NGAU NHIEN 64 ky tu hex; luu vao
#     %LOCALAPPDATA%\SISCOM-CRM\demo\roles-<port>.secrets (NGOAI repo; ACL chi SID tai khoan Windows hien tai). Role da co ma file chua co mat
#     khau => hoi an; MOI mat khau role da co deu duoc DANG NHAP THU truoc khi luu file / ghi DB. Truyen cho psql qua stdin (\set), khong qua
#     dong lenh, khong in. Tao/doi mat khau role chi khi server KHONG ghi/luu cau lenh trong DB se chay lenh (Assert-LogSafe: log_statement =
#     none, log_min_duration_statement = -1, khong lay mau log, pg_stat_statements khong theo doi utility) - neu khong, mat khau co the vao log.
# Luu y cap cluster (xem runbook muc 0): ROLE_SPLIT tam doi chu so huu MOI database thuoc siscom_app sang siscom_migrator roi tra lai trong CUNG
#   transaction (C1, tu kiem chu so huu + ACL; sai => huy toan bo). Khong chay song song voi create-test-db / thao tac DB khac.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('split', 'migrate', 'verify', 'resetpw')][string]$Step,
  [string]$DatabaseName,
  [string]$EnvPath,
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [switch]$NonInteractive,
  [switch]$AllowMainCluster
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
# B1.4 demo cach ly: chi chay tren CUM DEMO (demo-pg.ps1: cluster_name = 'siscom_demo', cong rieng). Cong 5432 (PostgreSQL hien tai) va moi cum
# khong mang nhan bi TU CHOI, tru khi co -AllowMainCluster (CHI khi owner phe duyet rieng bang van ban). Mat khau postgres / siscom_app cua cum
# demo lay tu %LOCALAPPDATA%\SISCOM-CRM\demo\pg-<port>.secrets va demo-<port>.env (do demo-pg.ps1 sinh).
function Get-DemoSecret([int]$port, [string]$key) {
  $f = Join-Path $env:LOCALAPPDATA ('SISCOM-CRM\demo\pg-' + $port + '.secrets')
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
# Chay psql; $vars => \set <ten> '<gia tri>' qua STDIN (gia tri chi gom [A-Za-z0-9_]); $file => \i <file>; $sql => cau lenh.
# Ket qua: stdout (+stderr khi loi). -Data: chi lay dong ket qua cuoi (bo WARNING/NOTICE/psql: cua stderr, QA M-3).
function Invoke-Psql([string]$user, [string]$pw, [string]$db, [hashtable]$vars, [string]$file, [string]$sql, [switch]$Raw, [switch]$Data, [switch]$NoThrow) {
  $lines = @()
  if ($vars) { foreach ($k in $vars.Keys) { $v = [string]$vars[$k]; if ($v -notmatch '^[A-Za-z0-9_]*$') { Fail ('Gia tri bien psql ' + $k + ' co ky tu khong cho phep.') }; $lines += ('\set ' + $k + " '" + $v + "'") } }
  if ($file) {
    $fp = $file -replace '\\', '/'
    if ($fp -match "[^\x20-\x7E]|'") { Fail ('Duong dan repo co ky tu khong phai ASCII hoac dau nhay (' + $fp + '): chuyen repo sang thu muc ASCII, vd D:\SISCOM-CRM.') }
    $lines += ("\i '" + $fp + "'")
  }
  if ($sql) { $lines += $sql }
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = ($lines -join "`n") | & $script:psql -X -q -w -h 127.0.0.1 -p $PgPort -U $user -d $db -v ON_ERROR_STOP=1 -t -A -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; $lines = $null }
  $all = @($out | ForEach-Object { $_.ToString() })
  $text = $all -join "`n"
  if ($code -ne 0) {
    if ($NoThrow) { return ('<ERR>' + $text) }
    Fail ('psql (' + $user + ' @ ' + $db + ') ma thoat ' + $code + ': ' + (($all | Select-Object -Last 6) -join ' | '))
  }
  if ($Data) { $d = @($all | Where-Object { $_ -ne '' -and $_ -notmatch '^(WARNING|NOTICE|DETAIL|HINT|psql:)' }); if ($d.Count -eq 0) { return '' }; return $d[-1].Trim() }
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
# QA I-1: dang nhap thu bang role + mat khau (DB postgres). 'ok' | 'badpw' | 'other:<loi>'.
function Test-RoleLogin([string]$role, [string]$pw) {
  $r = Invoke-Psql $role $pw 'postgres' $null $null 'SELECT 1;' -NoThrow
  if (-not $r.StartsWith('<ERR>')) { return 'ok' }
  # Thong bao loi ket noi theo ngon ngu server (lc_messages): chi nhan dien tieng Anh; ngon ngu khac => 'other' (dung an toan, goi y resetpw).
  if ($r -match 'password authentication failed') { return 'badpw' }
  if ($r -match 'permission denied for database') { return 'ok' } # da qua buoc xac thuc mat khau; chi thieu CONNECT vao DB postgres
  # QA lan 3 m-2: resetpw doi mat khau CAP CLUSTER => chi goi y khi thong bao that su la loi xac thuc mat khau (vd server khong dung tieng Anh).
  return ('other: ' + (($r -split "`n" | Select-Object -Last 1) -replace '^<ERR>', '') + ' (chi khi day la loi xac thuc mat khau - vd server bao loi bang tieng Viet - moi chay -Step resetpw; loi ket noi/het thoi gian: kiem dich vu PostgreSQL)')
}
# QA I-5 / lan 2 I-B: CREATE/ALTER ROLE ... PASSWORD khong duoc vao log server hay pg_stat_statements. Kiem TRONG DB se chay lenh (thiet lap
# theo DB/role co hieu luc). Yeu cau: log_statement = none; log_min_duration_statement = -1; khong lay mau cau lenh (log_min_duration_sample = -1
# hoac log_statement_sample_rate = 0) va log_transaction_sample_rate = 0; khong co pg_stat_statements theo doi lenh utility.
# Con lai (ghi chu): log_min_error_statement ghi cau lenh LOI vao log (vd tao role trung) - xac suat thap, khong chan.
function Assert-LogSafe([string]$adminPw, [string]$db) {
  $q = @"
SELECT concat_ws('|', current_setting('log_statement'),
  (SELECT setting FROM pg_settings WHERE name = 'log_min_duration_statement'),
  coalesce((SELECT setting FROM pg_settings WHERE name = 'log_min_duration_sample'), '-1'),
  coalesce((SELECT setting FROM pg_settings WHERE name = 'log_statement_sample_rate'), '0'),
  coalesce((SELECT setting FROM pg_settings WHERE name = 'log_transaction_sample_rate'), '0'),
  (current_setting('shared_preload_libraries') ~ 'pg_stat_statements' AND coalesce(current_setting('pg_stat_statements.track_utility', true), 'on') = 'on')::text,
  (current_setting('shared_preload_libraries') ~ 'pgaudit')::text);
"@
  $p = (Invoke-Psql 'postgres' $adminPw $db $null $null $q -Data).Split('|')
  $bad = @()
  if ($p[0] -ne 'none') { $bad += ('log_statement=' + $p[0]) }
  if ($p[1] -ne '-1') { $bad += ('log_min_duration_statement=' + $p[1]) }
  if ($p[2] -ne '-1' -and [double]$p[3] -gt 0) { $bad += ('log_min_duration_sample=' + $p[2] + '/log_statement_sample_rate=' + $p[3]) }
  if ([double]$p[4] -gt 0) { $bad += ('log_transaction_sample_rate=' + $p[4]) }
  if ($p[5] -eq 'true') { $bad += 'pg_stat_statements.track_utility=on' }
  if ($p[6] -eq 'true') { $bad += 'pgaudit trong shared_preload_libraries (co the ghi CREATE/ALTER ROLE)' }   # QA lan 3 m-1
  if ($bad.Count -gt 0) {
    Fail ('Server dang ghi/luu cau lenh (' + ($bad -join ', ') + ' tai DB ' + $db + '): tao/doi mat khau role se lo mat khau. Dat log_statement = none, log_min_duration_statement = -1, tat lay mau log, pg_stat_statements.track_utility = off (postgresql.conf hoac ALTER SYSTEM; kiem ca ALTER DATABASE/ROLE ... SET), reload, chay lai. Chua ghi gi.')
  }
  Ok ('Server khong ghi/luu cau lenh tai DB ' + $db + ' (log_statement=none, log_min_duration_statement=-1, khong lay mau).')
}
function Save-Secrets([string]$dir, [string]$file, [string]$mig, [string]$auth) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Set-Content -LiteralPath $file -Encoding ASCII -Value @(('MIGRATOR_PW=' + $mig), ('AUTH_PW=' + $auth))
  # QA M-1: ACL theo SID (khong nham tai khoan mien/cuc bo trung ten), kiem ma thoat; that bai => xoa file, dung.
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & icacls.exe $file /inheritance:r /grant:r ('*' + $sid + ':(R,W)') 2>&1 | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($code -ne 0) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; Fail ('Khong dat duoc quyen rieng cho file mat khau (icacls ma ' + $code + '); da xoa file. Dung lai.') }
  Ok ('Da luu mat khau role vao ' + $file + ' (chi tai khoan Windows hien tai).')
}
$secretsFile = $null; $adminPw = $null; $appPw = $null; $migPw = $null; $authPw = $null; $sec = $null
$savedDb = $env:DATABASE_URL; $savedMig = $env:MIGRATE_DATABASE_URL
try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $docs = Join-Path $root 'docs'
  Assert-DemoPort $PgPort ([bool]$AllowMainCluster)
  if (-not $EnvPath) { $de = Join-Path $env:LOCALAPPDATA ('SISCOM-CRM\demo\demo-' + $PgPort + '.env'); if (Test-Path -LiteralPath $de) { $EnvPath = $de } }
  if (-not $EnvPath) { $EnvPath = Join-Path $root '.env'; if (-not (Test-Path -LiteralPath $EnvPath) -and (Test-Path -LiteralPath 'D:\SISCOM-CRM\backend\.env')) { $EnvPath = 'D:\SISCOM-CRM\backend\.env' } }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  if ($Step -ne 'resetpw') {
    if (-not $DatabaseName) { Fail ('Buoc ' + $Step + ' can -DatabaseName <siscom_crm_test_YYYYMMDD_HHMMSS>.') }
    if ($DatabaseName -notmatch '^siscom_crm_(restore|test)_\d{8}_\d{6}$') { Fail 'Ten database phai la siscom_crm_test_YYYYMMDD_HHMMSS (hoac siscom_crm_restore_...). siscom_crm_dev bi tu choi.' }
    if (@('siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948') -contains $DatabaseName) { Fail ($DatabaseName + ' la baseline da khoa, khong duoc thay doi.') }
  }
  $ghi = ' (GHI: role/quyen cap cluster va database thu)'; if ($Step -eq 'verify') { $ghi = ' (khong doi quyen/du lieu)' }; if ($Step -eq 'resetpw') { $ghi = ' (GHI: doi mat khau 2 role cap cluster)' }
  if ($Step -eq 'resetpw') { Say ('Cluster cong ' + $PgPort + ' | Buoc: resetpw' + $ghi) 'Yellow' }
  else { Say ('Database thu: ' + $DatabaseName + ' | cong ' + $PgPort + ' | Buoc: ' + $Step + $ghi) 'Yellow' }
  if (-not $NonInteractive -and ($Step -eq 'split' -or $Step -eq 'migrate')) {
    $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
    if ($c -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  }
  if (-not $NonInteractive -and $Step -eq 'resetpw') {
    $c = Read-Host 'Go DOI-MAT-KHAU de xac nhan dat lai mat khau siscom_migrator va siscom_auth'
    if ($c -ne 'DOI-MAT-KHAU') { Fail 'Khong xac nhan. Dung lai.' }
  }
  # QA I-2: tren cum demo CHI dung mat khau trong file cua cum demo (khong hoi tay, khong bien moi truong - tranh gui mat khau superuser cum chinh
  # toi mot tien trinh la tren cong demo); moi lan psql bat buoc SCRAM (PGREQUIREAUTH), khong gui mat khau dang ro.
  if (-not $AllowMainCluster) { $env:PGREQUIREAUTH = 'scram-sha-256' }
  $adminPw = Get-DemoSecret $PgPort 'POSTGRES_PW'
  if (-not $adminPw -and -not $AllowMainCluster) { Fail ('Khong co file mat khau cum demo (%LOCALAPPDATA%\SISCOM-CRM\demo\pg-' + $PgPort + '.secrets). Chay demo-pg.bat -Step init (hoac demo-setup.bat) truoc.') }
  if ($adminPw) { Say ('Mat khau postgres cua cum demo cong ' + $PgPort + ' lay tu file (khong in).') }
  elseif ($NonInteractive) { $adminPw = $env:SISCOM_PG_ADMIN_PASSWORD; if (-not $adminPw) { Fail 'Che do khong tuong tac can file mat khau cum demo hoac bien SISCOM_PG_ADMIN_PASSWORD.' } }
  else { $adminPw = Read-Secret 'Mat khau tai khoan postgres (khong luu)' }
  Assert-DemoClusterName (Invoke-Psql 'postgres' $adminPw 'postgres' $null $null "SELECT current_setting('cluster_name');" -Data) ([bool]$AllowMainCluster)
  $isSu = Invoke-Psql 'postgres' $adminPw 'postgres' $null $null 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user;' -Data
  if ($isSu -ne 't') { Fail 'Tai khoan postgres phai la superuser.' }
  $roles = Invoke-Psql 'postgres' $adminPw 'postgres' $null $null "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_migrator')::text || '|' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_auth')::text;" -Data
  $hasMig = $roles.Split('|')[0] -eq 'true'; $hasAuth = $roles.Split('|')[1] -eq 'true'
  $dir = Join-Path $env:LOCALAPPDATA 'SISCOM-CRM\demo'
  $secretsFile = Join-Path $dir ('roles-' + $PgPort + '.secrets')

  if ($Step -eq 'resetpw') {
    if (-not $hasMig -and -not $hasAuth) { Fail 'Chua co role siscom_migrator / siscom_auth: khong co gi de dat lai (chay -Step split).' }
    Assert-LogSafe $adminPw 'postgres'   # ALTER ROLE chay trong DB postgres
    $newMig = New-RandomSecret; $newAuth = New-RandomSecret
    if ($hasMig) { Invoke-Psql 'postgres' $adminPw 'postgres' @{ pw = $newMig } $null "SELECT format('ALTER ROLE siscom_migrator PASSWORD %L', :'pw') \gexec" | Out-Null }
    if ($hasAuth) { Invoke-Psql 'postgres' $adminPw 'postgres' @{ pw = $newAuth } $null "SELECT format('ALTER ROLE siscom_auth PASSWORD %L', :'pw') \gexec" | Out-Null }
    Save-Secrets $dir $secretsFile $newMig $newAuth
    foreach ($pair in @(@('siscom_migrator', $hasMig, $newMig), @('siscom_auth', $hasAuth, $newAuth))) {
      if ($pair[1]) { $t = Test-RoleLogin $pair[0] $pair[2]; if ($t -ne 'ok') { Fail ('Dang nhap thu ' + $pair[0] + ' sau khi dat lai: ' + $t) } }
    }
    $newMig = $null; $newAuth = $null
    Ok 'Da dat lai mat khau role va dang nhap thu thanh cong.'
    exit 0
  }

  $owner = Invoke-Psql 'postgres' $adminPw 'postgres' $null $null ("SELECT coalesce((SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '" + $DatabaseName + "'), '<khong co>');") -Data
  if ($owner -eq '<khong co>') { Fail ('Chua co database ' + $DatabaseName + ' (tao bang create-test-db.bat).') }
  # QA lan 3 m-3: chu so huu la ai khac => dung NGAY (truoc moi xu ly mat khau / ghi file).
  if ($owner -ne 'siscom_app' -and $owner -ne 'siscom_migrator') { Fail ('Chu so huu DB la "' + $owner + '" (khong phai siscom_app/siscom_migrator). Dung lai.') }
  Say ('Chu so huu hien tai: ' + $owner + ' | role siscom_migrator: ' + $hasMig + ' | role siscom_auth: ' + $hasAuth)
  $appPw = Get-AppPasswordFromEnv $EnvPath $PgPort
  Say 'Mat khau siscom_app lay tu .env (khong in).'

  if ($Step -eq 'split' -and $owner -eq 'siscom_app') {
    # QA I-2: kiem dieu kien (CHI DOC) TRUOC moi buoc ghi (ke ca file mat khau - QA lan 2 m-2). Hai pha (lan 2 m-1): PostgreSQL phan giai ten
    # bang/ham luc parse ca o nhanh CASE khong chay => kiem TON TAI truoc, roi moi truy van du lieu.
    $ex = (Invoke-Psql 'postgres' $adminPw $DatabaseName $null $null "SELECT concat_ws('|', (to_regclass('public._prisma_migrations') IS NOT NULL)::text, (to_regclass('public.remember_device') IS NOT NULL AND to_regprocedure('public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regprocedure('public.fn_auth_bootstrap_open()') IS NOT NULL)::text);" -Data).Split('|')
    if ($ex[0] -ne 'true' -or $ex[1] -ne 'true') { Fail 'DB chua migrate du (thieu bang/ham B1.4). Chay auth-demo-stack.bat -Step migrate truoc. Chua ghi gi.' }
    $p = (Invoke-Psql 'postgres' $adminPw $DatabaseName $null $null "SELECT concat_ws('|', (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text, (SELECT count(*) FROM public.lookup_item)::text, (NOT public.fn_auth_bootstrap_open())::text);" -Data).Split('|')
    if ($p[0] -ne '0') { Fail 'DB co migration loi do dang. Bo DB nay, tao DB moi. Chua ghi gi.' }
    if ([int]$p[1] -le 0) { Fail 'Chua seed danh muc (lookup_item rong). Chay auth-demo-stack.bat -Step seed truoc (sau khi tach role siscom_app khong con seed duoc). Chua ghi gi.' }
    if ($p[2] -ne 'true') { Fail 'Chua bootstrap tai khoan. Chay auth-demo-stack.bat -Step bootstrap truoc (sau khi tach role khong con bootstrap duoc). Chua ghi gi.' }
    Ok 'Dieu kien truoc tach role: da migrate du, da seed, da bootstrap.'
  }

  if ($Step -ne 'verify') {
    # Mat khau role cap cluster: file ngoai repo. QA I-1: moi mat khau cho role DA CO deu dang nhap thu truoc khi luu / ghi DB.
    $sec = @{}
    if (Test-Path -LiteralPath $secretsFile) { foreach ($l in Get-Content -LiteralPath $secretsFile) { if ($l -match '^(MIGRATOR_PW|AUTH_PW)=([0-9a-f]{64})$') { $sec[$Matches[1]] = $Matches[2] } } }
    $changed = $false; $creating = $false
    foreach ($pair in @(@('MIGRATOR_PW', $hasMig, 'siscom_migrator'), @('AUTH_PW', $hasAuth, 'siscom_auth'))) {
      $k = $pair[0]; $exists = $pair[1]; $role = $pair[2]
      if (-not $exists) {
        if (-not $sec.ContainsKey($k)) { $sec[$k] = New-RandomSecret; $changed = $true }
        $creating = $true; Say ('Role ' + $role + ' chua co: se tao voi mat khau ngau nhien (luu ngoai repo, khong in).')
        continue
      }
      if (-not $sec.ContainsKey($k)) {
        if ($NonInteractive) { Fail ('Role ' + $role + ' da ton tai nhung file mat khau chua co: chay khong kem -NonInteractive de nhap, hoac -Step resetpw.') }
        $v = Read-Secret ('Role ' + $role + ' da ton tai. Nhap mat khau HIEN TAI cua no (64 ky tu hex do script sinh truoc day)')
        if ($v -notmatch '^[0-9a-f]{64}$') { Fail 'Mat khau phai la 64 ky tu hex (dinh dang do script sinh). Khong nho: chay demo-split.bat -Step resetpw.' }
        $sec[$k] = $v; $changed = $true; $v = $null
      }
      $t = Test-RoleLogin $role $sec[$k]
      if ($t -eq 'badpw') { Fail ('Mat khau cua ' + $role + ' (trong file/nhap tay) KHONG dung. Chua ghi gi. Chay demo-split.bat -Step resetpw roi chay lai.') }
      if ($t -ne 'ok') { Fail ('Khong dang nhap thu duoc ' + $role + ': ' + $t + '. Chua ghi gi.') }
      Ok ('Mat khau ' + $role + ' dung (dang nhap thu).')
    }
    if ($creating) { Assert-LogSafe $adminPw $DatabaseName }   # CREATE ROLE ... PASSWORD chay trong DB thu (ROLE_SPLIT / AUTH_ROLE)
    if ($changed) { Save-Secrets $dir $secretsFile $sec['MIGRATOR_PW'] $sec['AUTH_PW'] }
    $migPw = $sec['MIGRATOR_PW']; $authPw = $sec['AUTH_PW']
  }

  switch ($Step) {
    'split' {
      if ($owner -eq 'siscom_app') {
        # Dieu kien (migrate du / seed / bootstrap) da kiem o tren, truoc moi buoc ghi.
        Say '--- 1/5 ROLE_SPLIT (superuser): siscom_migrator thanh chu so huu ---' 'Cyan'
        Invoke-Psql 'postgres' $adminPw $DatabaseName @{ target_db = $DatabaseName; migrator_pw = $migPw } (Join-Path $docs 'B1.3_S1_ROLE_SPLIT.sql.txt') $null | Out-Null
        Ok 'ROLE_SPLIT xong.'
      } elseif ($owner -eq 'siscom_migrator') { Say 'DB da thuoc siscom_migrator: bo qua ROLE_SPLIT (tiep tuc cac buoc idempotent - cung la cach go "nua chung").' 'Yellow' }
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
      $nf = Invoke-Psql 'siscom_migrator' $migPw $DatabaseName $null $null 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;' -Data
      if ($nf -ne '0') { Fail 'DB co migration loi do dang (P3018). KHONG sua tay / migrate resolve: bo DB nay, tao DB moi. Chua ghi gi.' }
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
    'verify' { if ($owner -ne 'siscom_migrator') { Say 'Luu y: DB CHUA tach role => VERIFY se KHONG DAT (dung mong doi). Chay -Step split.' 'Yellow' } }
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
  # QA M-6: khoi phuc bien cua phien goi (khi chay truc tiep .ps1).
  if ($null -ne $savedDb) { $env:DATABASE_URL = $savedDb }; if ($null -ne $savedMig) { $env:MIGRATE_DATABASE_URL = $savedMig }
}
