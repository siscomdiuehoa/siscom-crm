# SISCOM CRM B1.3.2-B - KIEM CHUNG S1-S3 (M1.2 20261020180000_b1_3_auth_m1_2_priv_api + tach role siscom_migrator/siscom_app) tren BAN SAO THU MOI.
# KHONG tu chay; can phe duyet rieng. Dich: D:\SISCOM-CRM\backend\scripts\windows\auth-s1s3-verify.ps1 (file moi).
# Thay the auth-m11-verify.ps1 KHI nhanh co M1.2 (auth-m11-verify ky vong 4 thu muc migration va rollback khong biet M1.2).
# Chi lam viec voi -DatabaseName = ban sao tao boi make-stats-clone (nhan SISCOM_STATS_CLONE_OF:<TemplateDb>). Mau duoc duyet: siscom_crm_restore_20261015_214948 (CHI DOC).
# Tuyet doi KHONG: siscom_crm_dev, siscom_crm_restore_20261014_214105, siscom_crm_restore_20261015_214948 lam DICH (danh sach cam trong script).
# Steps (thu tu khuyen nghi; xem B1.3.2B_S1S3_REPORT.md muc 7):
#   TRUOC tach role (chu so huu = siscom_app, chay bang siscom_app):
#     guard (chi doc) | apply (prisma migrate deploy: M1 + M1.1 + M1.2) | constraints (test M1) | constraints11 (test M1.1) | constraints12 (test M1.2)
#     | regress (B1.2.2 scoped, PASS|57) | drift (prisma migrate diff/status) | rollback (M1.2 -> M1.1 -> M1 -> migrate deploy lai)
#   Tach role (chay bang postgres, hoi mat khau postgres, KHONG luu):
#     split (B1.3_S1_ROLE_SPLIT + B1.3_S1_APP_GRANTS; neu siscom_migrator chua co mat khau => psql \password tuong tac)
#     | privs (B1.3_S1_PRIVILEGE_TESTS, tu ROLLBACK) | unsplit (B1.3_S1_ROLE_SPLIT_ROLLBACK)
#   SAU tach role (chay bang siscom_migrator, hoi mat khau, KHONG luu):
#     deploy-owner (prisma migrate status + deploy + diff bang role chu so huu: chung minh Prisma van trien khai duoc)
# Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC, khong in); mat khau postgres/siscom_migrator nhap an. DATABASE_URL/PGPASSWORD chi dat cho
# tien trinh con tro DUNG ban sao roi xoa.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$TemplateDb = 'siscom_crm_restore_20261015_214948',
  [Parameter(Mandatory = $true)][ValidateSet('guard', 'apply', 'constraints', 'constraints11', 'constraints12', 'regress', 'drift', 'rollback', 'split', 'privs', 'unsplit', 'deploy-owner')][string]$Step,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b132b'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:user = $null; $script:log = $null
$M1 = '20261020000000_b1_3_auth_core'
$M11 = '20261020120000_b1_3_auth_m1_1_guards'
$M12 = '20261020180000_b1_3_auth_m1_2_priv_api'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c; if ($script:log) { Add-Content -LiteralPath $script:log -Value $m -Encoding UTF8 } }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Bad([string]$m) { Say ('[KHONG DAT] ' + $m) 'Red'; $script:fail = $true }
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
# TryPsql: tra ve @{ Code; Out }. Khong nem loi. Luon noi bang $script:user vao DUNG ban sao.
function TryPsql([string]$sql, [string]$file = '') {
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($file) { $out = & $script:psql -X -w -h 127.0.0.1 -p 5432 -U $script:user -d $DatabaseName -t -A -v ON_ERROR_STOP=1 -f $file 2>&1 }
    else { $out = $sql | & $script:psql -X -w -h 127.0.0.1 -p 5432 -U $script:user -d $DatabaseName -t -A -v ON_ERROR_STOP=1 -f - 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  return @{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n").Trim() }
}
function Psql([string]$sql) { $r = TryPsql $sql; if ($r.Code -ne 0) { Fail ('psql bao loi: ' + $r.Out) }; return $r.Out }
function Prisma([string[]]$a) {
  Push-Location $script:root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    # dotenv/config trong prisma.config.ts KHONG ghi de bien da dat => Prisma dung ban sao + role dang chon, khong dung siscom_crm_dev.
    $env:DATABASE_URL = 'postgresql://' + $script:user + ':' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $DatabaseName
    $out = & npx.cmd prisma @a 2>&1; $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  return @{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n") }
}
# Trang thai: M1 bang|trigger|lich su ; M1.1 trigger|ham|lich su ; M1.2 trigger|ham|lich su
function M1State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('employee_credential','auth_session','password_reset_token','privileged_change_request'))::text || '|' || " +
    "(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_employee_role_guard','trg_employee_role_no_update','trg_employee_role_no_truncate','trg_employee_role_sod','trg_role_permission_guard','trg_role_permission_no_truncate','trg_role_permission_sod','trg_app_meta_bootstrap_lock','trg_app_meta_bootstrap_truncate','trg_permission_guard_delete'))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M1 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function M11State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_employee_status_guard','trg_pcr_exec_guard'))::text || '|' || " +
    "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('fn_auth_employee_status_guard','fn_pcr_exec_guard'))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M11 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function M12State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_cred_secret_guard','trg_cred_revoke_sessions'))::text || '|' || " +
    "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_auth\_api\_%' OR p.proname IN ('fn_auth_bootstrap_close','fn_cred_secret_guard','fn_cred_revoke_sessions')))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M12 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function AllState { return ((M1State) + ' / ' + (M11State) + ' / ' + (M12State)) }
$EXPECT_ALL = '4|10|1 / 2|2|1 / 2|17|1'
$EXPECT_NONE = '0|0|0 / 0|0|0 / 0|0|0'
function Sessions { return [int](Psql 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();') }
function Deploy {
  $r = Prisma @('migrate', 'deploy')
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  if ($r.Code -ne 0) { Bad ('prisma migrate deploy that bai (ma ' + $r.Code + '). 15 dong cuoi:'); Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n"); return $false }
  Ok 'prisma migrate deploy thanh cong.'; return $true
}
function Expect-Applied { $s = AllState; if ($s -eq $EXPECT_ALL) { Ok ('M1/M1.1/M1.2 co mat: ' + $s) } else { Bad ('Trang thai sau ap = ' + $s + ' (ky vong ' + $EXPECT_ALL + ').') } }
function Require-Applied { $s = AllState; if ($s -ne $EXPECT_ALL) { Fail ('M1/M1.1/M1.2 chua ap day du (' + $s + '). Chay -Step apply truoc.') } }
function Run-ConstraintFile([string]$file) {
  $name = Split-Path $file -Leaf
  $r = TryPsql '' $file
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
  $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
  Say ('Ket qua ' + $name + ': PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ')')
  if ($r.Code -ne 0 -or -not $pass -or $failN) { Bad ($name + ' KHONG dat (xem log: dong "can_xem_lai").'); Say $r.Out } else { Ok ($name + ': 0 FAIL.') }
  if ((AllState) -ne $EXPECT_ALL) { Bad 'Trang thai M1/M1.1/M1.2 doi sau test (khong mong doi).' }
  if ((Psql "SELECT (SELECT count(*) FROM privileged_change_request) + (SELECT count(*) FROM employee_role) + (SELECT count(*) FROM role) + (SELECT count(*) FROM employee_credential) + (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');") -ne '0') { Bad 'Con du lieu sau ROLLBACK cua test.' } else { Ok 'ROLLBACK sach: khong de lai du lieu.' }
}
# Chay file SQL dac quyen (split/grants/unsplit), ky vong ma 0 va dong trang thai khop.
function Run-PrivFile([string]$file, [string]$stateRe, [string]$label) {
  $r = TryPsql '' $file
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  if ($r.Code -ne 0) { Bad ($label + ' loi (ma psql ' + $r.Code + '): ' + $r.Out); return $false }
  if ($r.Out -notmatch $stateRe) { Bad ($label + ': khong thay dong trang thai mong doi. Xem log.'); Say $r.Out; return $false }
  Ok ($label + ': ' + $Matches[0]); return $true
}
try {
  $pat = '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z'
  $deny = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
  if ($DatabaseName -cnotmatch $pat) { Fail 'DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS (ban sao moi).' }
  if ($deny -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich.') }
  if ($TemplateDb -cnotmatch $pat -or $TemplateDb -ceq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $script:log = Join-Path $LogDir ('auth_s1s3_' + $Step + '_' + $DatabaseName + '_' + $script:stamp + '.txt')
  Set-Content -LiteralPath $script:log -Value ('auth-s1s3-verify step=' + $Step + ' db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $script:root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $d = Join-Path $script:root 'docs'
  $f = @{
    mig1 = Join-Path $script:root ('prisma\migrations\' + $M1 + '\migration.sql'); mig11 = Join-Path $script:root ('prisma\migrations\' + $M11 + '\migration.sql')
    mig12 = Join-Path $script:root ('prisma\migrations\' + $M12 + '\migration.sql')
    t1 = Join-Path $d 'B1.3_M1_CONSTRAINT_TESTS.sql.txt'; t11 = Join-Path $d 'B1.3_M1_1_CONSTRAINT_TESTS.sql.txt'; t12 = Join-Path $d 'B1.3_M1_2_CONSTRAINT_TESTS.sql.txt'
    rb1 = Join-Path $d 'B1.3_M1_ROLLBACK.sql.txt'; rb11 = Join-Path $d 'B1.3_M1_1_ROLLBACK.sql.txt'; rb12 = Join-Path $d 'B1.3_M1_2_ROLLBACK.sql.txt'
    split = Join-Path $d 'B1.3_S1_ROLE_SPLIT.sql.txt'; grants = Join-Path $d 'B1.3_S1_APP_GRANTS.sql.txt'; unsplit = Join-Path $d 'B1.3_S1_ROLE_SPLIT_ROLLBACK.sql.txt'
    privs = Join-Path $d 'B1.3_S1_PRIVILEGE_TESTS.sql.txt'; reg = Join-Path $d 'B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt'
  }
  foreach ($k in @('mig1', 'mig11', 'mig12', 't1', 't11', 't12', 'rb1', 'rb11', 'rb12', 'split', 'grants', 'unsplit', 'privs', 'reg')) {
    $p = $f[$k]
    if (-not (Test-Path -LiteralPath $p)) { Fail ('Thieu file: ' + $p) }
    # core.autocrlf co the doi LF -> CRLF khi checkout: in them SHA-256 sau khi chuan hoa CRLF -> LF (= so trong B1.3.2B_S1S3_REPORT.md).
    $lf = [System.IO.File]::ReadAllBytes($p); $lf = [byte[]]@(for ($i = 0; $i -lt $lf.Length; $i++) { if (-not ($lf[$i] -eq 13 -and $i + 1 -lt $lf.Length -and $lf[$i + 1] -eq 10)) { $lf[$i] } })
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $lfHash = -join ($sha.ComputeHash($lf) | ForEach-Object { $_.ToString('X2') }) } finally { $sha.Dispose() }
    Say ('SHA-256 ' + (Split-Path $p -Leaf) + ' = ' + (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash + ' | sau chuan hoa LF = ' + $lfHash)
  }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  $preSplit = @('guard', 'apply', 'constraints', 'constraints11', 'constraints12', 'regress', 'drift', 'rollback')
  $asPostgres = @('split', 'privs', 'unsplit')
  $mode = if (@('guard', 'drift') -contains $Step) { 'chi doc' } elseif (@('constraints', 'constraints11', 'constraints12', 'regress', 'privs') -contains $Step) { 'ghi tam trong transaction, tu ROLLBACK' } elseif ($asPostgres -contains $Step) { 'DOI CHU SO HUU/QUYEN tren ban sao (bang postgres)' } else { 'GHI cau truc ban sao' }
  Say ('Ban sao: ' + $DatabaseName + ' | Buoc: ' + $Step + ' | ' + $mode) 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten ban sao de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  if ($Step -eq 'split' -and (Read-Host 'Buoc nay tao role cap cluster (siscom_migrator, siscom_auth_rt) va doi chu so huu ban sao. Go SPLIT-ROLES de tiep tuc') -ne 'SPLIT-ROLES') { Fail 'Khong xac nhan SPLIT-ROLES. Dung lai.' }
  if ($preSplit -contains $Step) { $script:user = 'siscom_app'; $script:pw = Get-AppPasswordFromEnv (Join-Path $script:root '.env') }
  elseif ($asPostgres -contains $Step) { $script:user = 'postgres'; $script:pw = Read-Secret 'Mat khau postgres (khong luu, khong in)' }
  else { $script:user = 'siscom_migrator'; $script:pw = Read-Secret 'Mat khau siscom_migrator (khong luu, khong in)' }
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid, 'pg_database'), '') || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name IN ('20261011000000_init', '20261012000000_b1_2_crm_core') AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -cne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -cne $script:user) { Fail ('Dang noi bang "' + $info[1] + '" thay vi "' + $script:user + '".') }
  if ($info[3] -cne ('SISCOM_STATS_CLONE_OF:' + $TemplateDb)) { Fail 'Database KHONG co nhan ban sao cua make-stats-clone khop -TemplateDb. TU CHOI.' }
  if ($info[4] -ne '2') { Fail 'Thieu migration init / b1_2_crm_core da ap.' }
  if ([int]$info[5] -lt 150000) { Fail ('PostgreSQL ' + $info[5] + ' < 15.') }
  $owner = $info[2]
  $needOwner = if (@('privs', 'unsplit', 'deploy-owner') -contains $Step) { 'siscom_migrator' } elseif ($Step -eq 'guard') { $owner } else { 'siscom_app' }
  if ($owner -cne $needOwner) { Fail ('Chu so huu ban sao = ' + $owner + '; buoc ' + $Step + ' can ' + $needOwner + '.') }
  Ok ('Guard: ban sao co nhan, khong nam trong danh sach cam, chu so huu ' + $owner + ', PostgreSQL ' + $info[5] + '.')
  $n = Sessions; if ($n -ne 0) { Fail ('Co ' + $n + ' phien khac dang ket noi toi ban sao. Dung (khong ngat ket noi cua ai).') }
  Ok 'Khong co phien khac.'
  $state = AllState
  $rbac = Psql "SELECT (SELECT count(*) FROM role) || '|' || (SELECT count(*) FROM permission) || '|' || (SELECT count(*) FROM role_permission) || '|' || (SELECT count(*) FROM employee_role) || '|' || (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');"
  Say ('Trang thai M1 / M1.1 / M1.2 = ' + $state + ' ; RBAC (role|permission|role_permission|employee_role|bootstrap_done) = ' + $rbac)
  switch ($Step) {
    'guard' {
      $dirs = @(Get-ChildItem -LiteralPath (Join-Path $script:root 'prisma\migrations') -Directory | ForEach-Object { $_.Name })
      Say ('Thu muc migration: ' + ($dirs -join ', '))
      if ($dirs.Count -ne 5 -or $dirs -notcontains $M1 -or $dirs -notcontains $M11 -or $dirs -notcontains $M12) { Bad 'Ky vong dung 5 thu muc migration (init, b1_2_crm_core, M1, M1.1, M1.2).' } else { Ok 'Dung 5 thu muc migration.' }
      if ($owner -ceq 'siscom_app' -and $state -ne $EXPECT_NONE) { Bad ('Ban sao da co dau vet M1/M1.1/M1.2 (' + $state + '): dung ban sao MOI.') } elseif ($owner -ceq 'siscom_app') { Ok 'Ban sao chua co M1/M1.1/M1.2.' } else { Say ('Ban sao da tach role (chu so huu ' + $owner + ').') 'Yellow' }
      if ($rbac -ne '0|0|0|0|0') { Bad ('Bang RBAC khong rong (' + $rbac + '): test rang buoc se tu choi chay.') } else { Ok 'Bang RBAC rong, chua co auth_bootstrap_done.' }
    }
    'apply' {
      if ($state -ne $EXPECT_NONE) { Fail ('Da co dau vet M1/M1.1/M1.2 (' + $state + '): khong ap lai. Dung -Step rollback de thu hoan tac/ap lai.') }
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): dung lai, bao toi.') }
      Say 'Ap M1 + M1.1 + M1.2 bang prisma migrate deploy (chi ban sao)...' 'Yellow'
      if (Deploy) { Expect-Applied }
    }
    'constraints' { Require-Applied; Run-ConstraintFile $f.t1 }
    'constraints11' { Require-Applied; Run-ConstraintFile $f.t11 }
    'constraints12' { Require-Applied; Run-ConstraintFile $f.t12 }
    'regress' {
      Require-Applied
      $r = TryPsql '' $f.reg
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
      $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
      Say ('Ket qua: PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ', ky vong PASS=57)')
      if ($r.Code -ne 0 -or $failN -or $pass -ne '57' -or $r.Out -match '(?m)^(psql:.*)?ERROR') { Bad 'B1.2.2_CONSTRAINT_TESTS_SCOPED co FAIL/ERROR hoac khong du 57 PASS sau M1 + M1.1 + M1.2.'; Say $r.Out } else { Ok 'B1.2.2_CONSTRAINT_TESTS_SCOPED: 57/57 PASS sau M1 + M1.1 + M1.2.' }
    }
    'drift' {
      Require-Applied
      $outFile = Join-Path $LogDir ('auth_s1s3_drift_' + $DatabaseName + '.sql')
      $r1 = Prisma @('migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', $outFile)
      $r2 = Prisma @('migrate', 'status')
      Say ('prisma migrate status (ma ' + $r2.Code + '): ' + (($r2.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
      if ($r1.Code -ne 0) { Bad ('prisma migrate diff loi (ma ' + $r1.Code + '): ' + $r1.Out) }
      elseif ([System.IO.File]::ReadAllText($outFile) -match 'empty migration') { Ok 'migrate diff: "empty migration" - schema.prisma khop ban sao sau M1 + M1.1 + M1.2.' }
      else { Bad ('migrate diff co noi dung (LECH), KHONG chay noi dung do. Xem: ' + $outFile) }
    }
    'rollback' {
      Require-Applied
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): rollback chi cho ban sao chua dung that.') }
      $chain = @(@{ F = $f.rb12; Re = '(?m)^0\|0\|0$'; L = 'Rollback M1.2' }, @{ F = $f.rb11; Re = '(?m)^0\|0\|0$'; L = 'Rollback M1.1' }, @{ F = $f.rb1; Re = '(?m)^0\|0\|0\|0\|0$'; L = 'Rollback M1' })
      foreach ($c in $chain) {
        if ($script:fail) { break }
        $r = TryPsql '' $c.F
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        if ($r.Code -ne 0) { Bad ($c.L + ' loi: ' + $r.Out) } elseif ($r.Out -notmatch $c.Re) { Bad ($c.L + ': van con doi tuong: ' + $r.Out) } else { Ok ($c.L + ': sach.') }
      }
      $s = AllState
      if ($s -ne $EXPECT_NONE) { Bad ('Trang thai sau rollback = ' + $s + ' (ky vong ' + $EXPECT_NONE + ').') } else { Ok ('Trang thai sau rollback = ' + $s + '.') }
      if (-not $script:fail) { Say 'Ap lai M1 + M1.1 + M1.2 bang prisma migrate deploy...' 'Yellow'; if (Deploy) { Expect-Applied } }
    }
    'split' {
      Require-Applied
      $null = Run-PrivFile $f.split '(?m)^0\|siscom_migrator\|false\|false$' 'Tach role (B1.3_S1_ROLE_SPLIT)'
      if (-not $script:fail) { $null = Run-PrivFile $f.grants '(?m)^false\|true\|false$' 'Cap quyen (B1.3_S1_APP_GRANTS)' }
      if (-not $script:fail) {
        if ((Psql "SELECT (rolpassword IS NULL)::text FROM pg_authid WHERE rolname = 'siscom_migrator';") -eq 'true') {
          Say 'siscom_migrator chua co mat khau. psql se hoi mat khau moi 2 lan (an, gui dang bam; khong luu vao log/script).' 'Yellow'
          $env:PGPASSWORD = $script:pw
          try { & $script:psql -X -w -h 127.0.0.1 -p 5432 -U postgres -d $DatabaseName -c '\password siscom_migrator'; $pc = $LASTEXITCODE } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
          if ($pc -ne 0) { Bad '\password siscom_migrator that bai.' } else { Ok 'Da dat mat khau siscom_migrator (luu vao trinh quan ly mat khau; KHONG ghi vao .env cua ung dung).' }
        } else { Ok 'siscom_migrator da co mat khau (khong doi).' }
      }
    }
    'privs' { Run-ConstraintFile $f.privs }
    'unsplit' {
      $null = Run-PrivFile $f.unsplit '(?m)^0\|siscom_app\|false$' 'Hoan tac tach role (B1.3_S1_ROLE_SPLIT_ROLLBACK)'
      if (-not $script:fail -and (AllState) -ne $EXPECT_ALL) { Bad 'M1/M1.1/M1.2 thay doi sau hoan tac tach role (khong mong doi).' }
    }
    'deploy-owner' {
      Require-Applied
      $r2 = Prisma @('migrate', 'status')
      Say ('prisma migrate status bang siscom_migrator (ma ' + $r2.Code + '): ' + (($r2.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
      if ($r2.Code -ne 0) { Bad 'prisma migrate status bang siscom_migrator that bai.' }
      if (Deploy) { Expect-Applied }
      $outFile = Join-Path $LogDir ('auth_s1s3_drift_owner_' + $DatabaseName + '.sql')
      $r1 = Prisma @('migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', $outFile)
      if ($r1.Code -ne 0) { Bad ('prisma migrate diff loi (ma ' + $r1.Code + '): ' + $r1.Out) }
      elseif ([System.IO.File]::ReadAllText($outFile) -match 'empty migration') { Ok 'migrate diff bang siscom_migrator: "empty migration".' }
      else { Bad ('migrate diff co noi dung (LECH), KHONG chay noi dung do. Xem: ' + $outFile) }
    }
  }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; foreach ($n in 'PGPASSWORD', 'DATABASE_URL') { Remove-Item ('Env:' + $n) -ErrorAction SilentlyContinue } }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Dung lai va gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: buoc nay DAT.' -ForegroundColor Green }
