# SISCOM CRM B1.3 MVP - DUNG BACKEND THAT tren DATABASE THU (siscom_crm_test_* / siscom_crm_restore_*) de dien tap dang nhap phien cookie
# va demo 4 vai tro (PR 5/5). Dich: D:\SISCOM-CRM\backend\scripts\windows\auth-demo-stack.ps1 (file moi).
# Mat khau siscom_app CHI DOC tu dong DATABASE_URL trong .env (mac dinh backend\.env; -EnvPath de chi ro), chi dua cho tien trinh con
# qua bien moi truong, khong in, khong ghi log, xoa sau khi chay. TUYET DOI khong ket noi siscom_crm_dev: ten DB thu phai dung regex va
# duoc doi chieu voi current_database() truoc moi buoc ghi. Khong prisma migrate dev / db push / reset; khong DROP/TRUNCATE/DELETE.
#   -Step list      : liet ke database thu ma siscom_app ket noi duoc (CHI DOC; khong can -DatabaseName).
#   -Step migrate   : prisma migrate deploy + migrate status tren DB thu (GHI schema, chi migration da co trong repo).
#   -Step seed      : node dist/cli/seed-lookups.js -> danh muc chuan D3 (customer_tier/customer_status/source/industry), IDEMPOTENT
#                     (ON CONFLICT DO NOTHING), chi DB thu (CLI tu choi siscom_crm_dev / baseline da khoa). Can "npm run build" truoc.
#   -Step bootstrap : node dist/cli/bootstrap-auth.js -> 4+1 tai khoan thu (sysadmin/admin/sale/kythuat/ketoan@siscom.local).
#                     Mat khau qua bien BOOTSTRAP_PASSWORD_SYSADMIN/ADMIN/SALE/TECHNICIAN/ACCOUNTANT (>= 12 ky tu); thieu thi hoi an.
#                     Can "npm run build" truoc (dist/). Chay dung MOT lan (sau do fn_auth_bootstrap_close khoa vinh vien).
#   -Step start     : chay backend node dist/main.js tren DB thu: HOST 127.0.0.1, PORT (mac dinh 3000), COOKIE_SECURE=false (http noi bo),
#                     CORS_ORIGINS = AUTH_ALLOWED_ORIGINS = FE 5173 (vite dev) va 4173 (vite preview). Ctrl-C de dung.
#   -Step status    : GET http://127.0.0.1:<Port>/api/v1/health (CHI DOC).
#   -NonInteractive : bo buoc go lai ten DB de xac nhan (danh cho harness tu dong); moi kiem tra khac giu nguyen.
#   -PgPort         : cong PostgreSQL (mac dinh 5432; khac 5432 chi de dien tap tren cluster tam). DATABASE_URL trong .env phai cung cong.
# B1.4 (runbook docs\B1.4_DEMO_WINDOWS_RUNBOOK.md): DB DA TACH ROLE bang demo-split.bat (chu so huu siscom_migrator) => buoc start tu dat
#   AUTH_DATABASE_URL = siscom_auth (mat khau doc tu %LOCALAPPDATA%\SISCOM-CRM\demo\roles-<port>.secrets do demo-split sinh; khong in).
#   migrate/seed/bootstrap chi cho DB CHUA tach (siscom_app la chu so huu); DB da tach: demo-split.bat -Step migrate.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'migrate', 'seed', 'bootstrap', 'start', 'status')][string]$Step,
  [string]$DatabaseName,
  [string]$EnvPath,
  [ValidateRange(1024, 65535)][int]$Port = 3000,
  [string]$Origins = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173',
  [ValidateRange(1024, 65535)][int]$PgPort = 5432,
  [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
$script:pw = $null; $script:psql = $null
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
function Get-AppPasswordFromEnv([string]$envPath, [int]$expectPort) {
  if (-not (Test-Path -LiteralPath $envPath)) { Fail ('Khong thay file .env: ' + $envPath + ' (dung -EnvPath D:\SISCOM-CRM\backend\.env khi chay tu worktree).') }
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
  if ($user -ne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne $expectPort) { Fail ('DATABASE_URL dung port ' + $port + ', can ' + $expectPort + '.') }
  if ($src -ne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev (chi de doi chieu, KHONG ket noi).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  Say 'DATABASE_URL trong .env hop le (user/host/port da kiem tra). Mat khau siscom_app lay tu .env, khong in.'
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
function Psql([string]$db, [string]$sql) {
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = $sql | & $script:psql -X -w -h 127.0.0.1 -p $PgPort -U siscom_app -d $db -t -A -v ON_ERROR_STOP=1 -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql bao loi tren "' + $db + '": ' + (($out | ForEach-Object { $_.ToString() }) -join ' ')) }
  return (($out | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}
function Run-Node([string[]]$a, [hashtable]$extraEnv) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $set = @()
  # I2 (ra soat P3): MIGRATE_DATABASE_URL con sot trong phien shell se lam bootstrap-auth/prisma tro DB KHAC voi -DatabaseName => go khoi
  # moi truong cua tien trinh con (script nay luon kiem tra -DatabaseName roi tu dat DATABASE_URL); khoi phuc sau khi chay.
  $savedMig = $env:MIGRATE_DATABASE_URL; Remove-Item Env:MIGRATE_DATABASE_URL -ErrorAction SilentlyContinue
  try {
    foreach ($k in $extraEnv.Keys) { Set-Item -Path ('Env:' + $k) -Value $extraEnv[$k]; $set += $k }
    & node @a | Out-Host; $code = $LASTEXITCODE   # Out-Host: stdout cua node KHONG lot vao gia tri tra ve (chi tra ma thoat)
  } finally {
    $ErrorActionPreference = $prev; foreach ($k in $set) { Remove-Item -Path ('Env:' + $k) -ErrorAction SilentlyContinue }
    if ($null -ne $savedMig) { $env:MIGRATE_DATABASE_URL = $savedMig }
  }
  return $code
}
$ownedVars = @()
try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  if (-not $EnvPath) { $EnvPath = Join-Path $root '.env'; if (-not (Test-Path -LiteralPath $EnvPath) -and (Test-Path -LiteralPath 'D:\SISCOM-CRM\backend\.env')) { $EnvPath = 'D:\SISCOM-CRM\backend\.env' } }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  if ($Step -eq 'status') {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $Port + '/api/v1/health') -TimeoutSec 5
    Say ('HTTP ' + $r.StatusCode + ' ' + $r.Content); exit 0
  }
  $script:pw = Get-AppPasswordFromEnv $EnvPath $PgPort
  if ($Step -eq 'list') {
    $rows = Psql 'postgres' "SELECT datname || ' (owner=' || pg_get_userbyid(datdba) || ')' FROM pg_database WHERE datname ~ '^siscom_crm_(restore|test)_\d{8}_\d{6}$' AND has_database_privilege('siscom_app', datname, 'CONNECT') ORDER BY datname;"
    if ($rows) { Say 'Database thu siscom_app ket noi duoc:'; Say $rows } else { Say 'Chua co database thu nao (chay create-test-db.bat).' 'Yellow' }
    exit 0
  }
  if (-not $DatabaseName) { Fail ('Buoc ' + $Step + ' can -DatabaseName <siscom_crm_test_YYYYMMDD_HHMMSS>.') }
  if ($DatabaseName -notmatch '^siscom_crm_(restore|test)_\d{8}_\d{6}$') { Fail 'Ten database phai la siscom_crm_test_YYYYMMDD_HHMMSS (hoac siscom_crm_restore_...). siscom_crm_dev bi tu choi.' }
  $ghi = ''; if ($Step -eq 'migrate' -or $Step -eq 'seed' -or $Step -eq 'bootstrap') { $ghi = ' (GHI vao database thu)' }
  Say ('Database thu: ' + $DatabaseName + ' | Buoc: ' + $Step + $ghi) 'Yellow'
  if (-not $NonInteractive) {
    $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
    if ($c -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  }
  $info = (Psql $DatabaseName "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -ne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -ne 'siscom_app') { Fail 'Tai khoan ket noi khong phai siscom_app.' }
  $split = $info[2] -eq 'siscom_migrator'
  if (-not $split -and $info[2] -ne 'siscom_app') { Fail ('Chu so huu database thu la "' + $info[2] + '" (khong phai siscom_app/siscom_migrator).') }
  if ($split -and $Step -ne 'start') { Fail ('DB da tach role (chu so huu siscom_migrator): buoc ' + $Step + ' khong dung o day. Migrate: demo-split.bat -Step migrate. Seed/bootstrap phai chay TRUOC khi tach role.') }
  $authUrl = $null
  if ($split) {
    $sf = Join-Path $env:LOCALAPPDATA ('SISCOM-CRM\demo\roles-' + $PgPort + '.secrets')
    $ap = $null
    if (Test-Path -LiteralPath $sf) { foreach ($l in Get-Content -LiteralPath $sf) { if ($l -match '^AUTH_PW=([0-9a-f]{64})$') { $ap = $Matches[1] } } }
    if (-not $ap) { Fail ('DB da tach role nhung chua co mat khau siscom_auth trong ' + $sf + ' (chay demo-split.bat -Step split tren may nay).') }
    $authUrl = 'postgresql://siscom_auth:' + $ap + '@127.0.0.1:' + $PgPort + '/' + $DatabaseName; $ap = $null
    Ok ('Dung database thu ' + $info[0] + ' (DA tach role: pool nghiep vu siscom_app + pool xac thuc siscom_auth).')
  } else {
    Ok ('Dung database thu ' + $info[0] + ' (owner siscom_app).')
    if ($Step -eq 'start') { Say 'CANH BAO: DB CHUA tach role => mot pool siscom_app lam ca xac thuc (S3 mo). Nghiem thu bao mat: chay demo-split.bat -Step split truoc.' 'Yellow' }
  }
  if ($Step -eq 'migrate') {
    # Kiem tra truoc khi GHI (CHI DOC; phai chay truoc khi xoa mat khau khoi bo nho): migration M1.2 can quyen SET tren 2 tham so app.*
    # (PostgreSQL >= 15, siscom_app khong phai superuser) va DB khong duoc co migration loi do dang.
    $sv = Psql $DatabaseName 'SHOW server_version_num;'
    if ([int]$sv -ge 150000) {
      $gp = Psql $DatabaseName "SELECT has_parameter_privilege('app.actor_employee_id', 'SET') AND has_parameter_privilege('app.priv_request_id', 'SET');"
      if ($gp -ne 't') { Fail 'siscom_app chua co quyen SET app.actor_employee_id / app.priv_request_id => migration M1.2 se loi P3018/42501. Chay create-test-db.bat (mac dinh cap quyen nay) roi migrate tren DB MOI. Chua ghi gi vao DB.' }
      Ok 'siscom_app co quyen SET app.actor_employee_id, app.priv_request_id.'
    }
    $hasMig = Psql $DatabaseName "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations';"
    if ($hasMig -eq '1') {
      $nf = Psql $DatabaseName 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;'
      if ([int]$nf -gt 0) { Fail 'DB thu nay co migration bi loi do dang (P3018). KHONG sua tay / migrate resolve: bo DB nay, tao DB moi bang create-test-db.bat.' }
    }
  }
  $url ='postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:' + $PgPort + '/' + $DatabaseName
  $script:pw = $null
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue   # khong de URL siscom_crm_dev (neu co) lot vao tien trinh con
  # I2: tuong tu voi MIGRATE_DATABASE_URL (prisma.config.ts uu tien bien nay) => buoc migrate/bootstrap chi dung DB da kiem tra qua -DatabaseName.
  $script:savedMigUrl = $env:MIGRATE_DATABASE_URL; Remove-Item Env:MIGRATE_DATABASE_URL -ErrorAction SilentlyContinue
  if ($null -ne $script:savedMigUrl) { Say 'Da go MIGRATE_DATABASE_URL khoi moi truong cua script (chi dung -DatabaseName); se khoi phuc khi thoat.' 'Yellow' }
  Push-Location $root
  try {
    switch ($Step) {
      'migrate' {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
          $env:DATABASE_URL = $url
          & npx.cmd prisma migrate deploy; $c1 = $LASTEXITCODE
          Say ('prisma migrate deploy ma thoat = ' + $c1)
          & npx.cmd prisma migrate status; $c2 = $LASTEXITCODE
          Say ('prisma migrate status ma thoat = ' + $c2)
        } finally { $ErrorActionPreference = $prev; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
        if ($c1 -ne 0 -or $c2 -ne 0) { Fail 'migrate deploy/status that bai. KHONG chay lai; gui log.' }
        Ok 'Schema da ap len database thu, migrate status up to date.'
      }
      'seed' {
        if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\cli\seed-lookups.js'))) { Fail 'Thieu dist\cli\seed-lookups.js: chay "npm run build" trong backend truoc.' }
        $code = Run-Node @('dist\cli\seed-lookups.js') @{ DATABASE_URL = $url; NODE_ENV = 'development' }
        if ($code -ne 0) { Fail ('seed-lookups ma thoat ' + $code + '. Khong ghi them gi; gui log.') }
        Ok 'Da seed danh muc chuan D3 (idempotent; chay lai khong trung).'
      }
      'bootstrap' {
        if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\cli\bootstrap-auth.js'))) { Fail 'Thieu dist\cli\bootstrap-auth.js: chay "npm run build" trong backend truoc.' }
        foreach ($k in @('SYSADMIN', 'ADMIN', 'SALE', 'TECHNICIAN', 'ACCOUNTANT')) {
          $name = 'BOOTSTRAP_PASSWORD_' + $k
          if (-not (Get-Item -Path ('Env:' + $name) -ErrorAction SilentlyContinue)) {
            if ($NonInteractive) { Fail ('Thieu bien moi truong ' + $name + ' (che do khong tuong tac).') }
            $v = Read-Secret ('Mat khau thu cho tai khoan ' + $k + ' (>= 12 ky tu, khong luu)')
            Set-Item -Path ('Env:' + $name) -Value $v; $ownedVars += $name; $v = $null
          }
        }
        $code = Run-Node @('dist\cli\bootstrap-auth.js') @{ DATABASE_URL = $url; NODE_ENV = 'development' }
        if ($code -ne 0) { Fail ('bootstrap-auth ma thoat ' + $code + '. Neu bao BOOTSTRAP_CLOSED: database thu nay da khoi tao roi, dung lai tai khoan cu.') }
        Ok 'Da khoi tao 4+1 tai khoan thu va dong che do khoi tao M1 (mat khau khong duoc in).'
      }
      'start' {
        if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\main.js'))) { Fail 'Thieu dist\main.js: chay "npm run build" trong backend truoc.' }
        Say ('Backend: http://127.0.0.1:' + $Port + '/api/v1 | DB thu ' + $DatabaseName + ' | COOKIE_SECURE=false | origin: ' + $Origins) 'Cyan'
        Say 'Ctrl-C de dung. FE: frontend\siscom-crm-web, "npm run dev" (hoac build + "npm run preview") voi VITE_CRM_AUTH_ENABLED=true, VITE_CRM_API_ENABLED=true.'
        $envs = @{ DATABASE_URL = $url; NODE_ENV = 'development'; HOST = '127.0.0.1'; PORT = [string]$Port; CORS_ORIGINS = $Origins; AUTH_ALLOWED_ORIGINS = $Origins; COOKIE_SECURE = 'false'; LOG_LEVEL = 'log'; TRUST_PROXY = 'false' }
        if ($authUrl) { $envs['AUTH_DATABASE_URL'] = $authUrl; Say 'AUTH_DATABASE_URL = siscom_auth (pool xac thuc rieng). Kiem: GET /api/v1/health/database => role.authPool = separate.' 'Cyan' }
        $code = Run-Node @('dist\main.js') $envs; $envs = $null
        Say ('Backend da dung (ma thoat ' + $code + ').')
      }
    }
  } finally { Pop-Location; $url = $null; $authUrl = $null }
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  $script:pw = $null; $url = $null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  foreach ($k in $ownedVars) { Remove-Item -Path ('Env:' + $k) -ErrorAction SilentlyContinue }
  # I2: khoi phuc MIGRATE_DATABASE_URL da go o dau (chi co y nghia khi chay truc tiep .ps1 trong cung phien PowerShell).
  if ($null -ne $script:savedMigUrl) { $env:MIGRATE_DATABASE_URL = $script:savedMigUrl; $script:savedMigUrl = $null }
}
