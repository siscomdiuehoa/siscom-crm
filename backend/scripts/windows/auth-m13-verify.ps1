# SISCOM CRM B1.3.2-B - KIEM CHUNG M1 + M1.1 + M1.2 + M1.3 (truoc tach role) tren BAN SAO THU MOI. KHONG tu chay; can phe duyet rieng bang van ban.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\auth-m13-verify.ps1 (file moi). Khong sua auth-m1/m11/s1s3-verify; buoc tach role (split/privs/unsplit/deploy-owner) van o auth-s1s3-verify.ps1.
# BAO VE CUNG (kiem tra TRUOC khi mo ket noi):
#   * -DatabaseName phai khop ^siscom_crm_(restore|test)_YYYYMMDD_HHMMSS$ ; khong nam trong danh sach cam (siscom_crm_dev, 2 baseline) ; khong chua dev/prod/production/baseline.
#   * Database phai co nhan 'SISCOM_STATS_CLONE_OF:<TemplateDb>' (do make-stats-clone tao) khop -TemplateDb ; chu so huu = siscom_app ; khong co phien khac.
#   * Chi ket noi 127.0.0.1:5432 ; sau khi noi phai xac nhan current_database() = -DatabaseName.
#   * Nguoi van hanh phai go lai CHINH XAC ten ban sao (va them tu khoa cho buoc ghi cau truc / khong hoan tac).
# Steps:
#   static        : OFFLINE, KHONG ket noi DB, khong doc .env. Kiem tra tinh tep SQL/migration/script (an toan de chay bat cu luc nao).
#   guard         : chi doc. Kiem tra ban sao + so thu muc migration (6) + RBAC rong + trang thai chua ap.
#   apply         : prisma migrate deploy (M1 + M1.1 + M1.2 + M1.3). Tu choi neu da co dau vet (idempotent: khong ap lai).
#   constraints / constraints11 / constraints12 : test ban dau cua M1 / M1.1 / M1.2 (tu ROLLBACK).
#   structure13   : B1.3_M1_3_STRUCTURE_TESTS (chi doc catalog; moi dong ok = t).
#   functional13  : B1.3_M1_3_FUNCTIONAL_TESTS (tu ROLLBACK; PASS phai bang so phep kiem khai bao trong tep, 0 FAIL).
#   regress       : B1.2.2_CONSTRAINT_TESTS_SCOPED, can PASS=57 sau M1..M1.3.
#   drift         : prisma migrate diff (empty migration) + migrate status (up to date).
#   rollback      : M1.3 -> M1.2 -> M1.1 -> M1 (tep rollback viet san) roi migrate deploy lai. Chi ban sao khong co du lieu RBAC.
#   concurrency   : 2 phien psql song song (admin cuoi / nguoi duyet cuoi). COMMIT du lieu demo + dong khoi tao => BUOC CUOI, sau do bo ban sao.
# Thu tu khuyen nghi tren MOT ban sao moi: static, guard, apply, constraints, constraints11, constraints12, structure13, functional13, regress, drift, rollback, drift, [ban sao khac: concurrency].
# Mat khau siscom_app doc tu DATABASE_URL trong .env luc chay (CHI DOC, khong in, khong ghi log); DATABASE_URL/PGPASSWORD chi dat cho tien trinh con tro DUNG ban sao roi xoa.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$TemplateDb = 'siscom_crm_restore_20261015_214948',
  [Parameter(Mandatory = $true)][ValidateSet('static', 'guard', 'apply', 'constraints', 'constraints11', 'constraints12', 'structure13', 'functional13', 'regress', 'drift', 'rollback', 'concurrency')][string]$Step,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b132b'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
$M1 = '20261020000000_b1_3_auth_core'
$M11 = '20261020120000_b1_3_auth_m1_1_guards'
$M12 = '20261020180000_b1_3_auth_m1_2_priv_api'
$M13 = '20261021000000_b1_3_auth_m1_3_reset_revocation'
$DB_ALLOW = '^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}\z'
$DB_DENY = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
$DB_DENY_WORDS = '(?i)(dev|prod|production|baseline|live)'
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
  if ($user -ne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -ne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi "' + $src + '", ky vong siscom_crm_dev (chi de lay mat khau, KHONG dung lam dich).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
function Hash-Lf([string]$p) {
  $b = [System.IO.File]::ReadAllBytes($p); $lf = [byte[]]@(for ($i = 0; $i -lt $b.Length; $i++) { if (-not ($b[$i] -eq 13 -and $i + 1 -lt $b.Length -and $b[$i + 1] -eq 10)) { $b[$i] } })
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return (-join ($sha.ComputeHash($lf) | ForEach-Object { $_.ToString('X2') })) } finally { $sha.Dispose() }
}
# TryPsql: tra ve @{ Code; Out }. Khong nem loi. Luon noi bang siscom_app vao DUNG ban sao, host 127.0.0.1.
function TryPsql([string]$sql, [string]$file = '') {
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($file) { $out = & $script:psql -X -w -h 127.0.0.1 -p 5432 -U siscom_app -d $DatabaseName -t -A -v ON_ERROR_STOP=1 -f $file 2>&1 }
    else { $out = $sql | & $script:psql -X -w -h 127.0.0.1 -p 5432 -U siscom_app -d $DatabaseName -t -A -v ON_ERROR_STOP=1 -f - 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  return @{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n").Trim() }
}
function Psql([string]$sql) { $r = TryPsql $sql; if ($r.Code -ne 0) { Fail ('psql bao loi: ' + $r.Out) }; return $r.Out }
function Prisma([string[]]$a) {
  Push-Location $script:root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    # dotenv/config trong prisma.config.ts KHONG ghi de bien da dat => Prisma dung ban sao, khong dung siscom_crm_dev.
    $env:DATABASE_URL = 'postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $DatabaseName
    $out = & npx.cmd prisma @a 2>&1; $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  return @{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n") }
}
# Trang thai (bang|trigger|lich su) cua tung migration. Chuoi gop 4 phan phan cach ' / '.
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
function M13State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'trg_cred_revoke_reset_tokens')::text || '|' || " +
    "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_cred_revoke_reset_tokens')::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M13 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function AllState { return ((M1State) + ' / ' + (M11State) + ' / ' + (M12State) + ' / ' + (M13State)) }
$EXPECT_ALL = '4|10|1 / 2|2|1 / 2|17|1 / 1|1|1'
$EXPECT_NONE = '0|0|0 / 0|0|0 / 0|0|0 / 0|0|0'
function Sessions { return [int](Psql 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();') }
function Deploy {
  $r = Prisma @('migrate', 'deploy')
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  if ($r.Code -ne 0) { Bad ('prisma migrate deploy that bai (ma ' + $r.Code + '). 15 dong cuoi:'); Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n"); return $false }
  Ok 'prisma migrate deploy thanh cong.'; return $true
}
function Expect-Applied { $s = AllState; if ($s -eq $EXPECT_ALL) { Ok ('M1/M1.1/M1.2/M1.3 co mat: ' + $s) } else { Bad ('Trang thai sau ap = ' + $s + ' (ky vong ' + $EXPECT_ALL + ').') } }
function Require-Applied { $s = AllState; if ($s -ne $EXPECT_ALL) { Fail ('M1..M1.3 chua ap day du (' + $s + '). Chay -Step apply truoc.') } }
function Require-CleanRbac { if ($script:rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $script:rbac + '): buoc nay can ban sao chua co du lieu RBAC/khoi tao. Dung ban sao MOI.') } }
function Check-Clean {
  if ((Psql "SELECT (SELECT count(*) FROM privileged_change_request) + (SELECT count(*) FROM employee_role) + (SELECT count(*) FROM role) + (SELECT count(*) FROM employee_credential) + (SELECT count(*) FROM password_reset_token) + (SELECT count(*) FROM auth_session) + (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');") -ne '0') { Bad 'Con du lieu sau ROLLBACK cua test.' } else { Ok 'ROLLBACK sach: khong de lai du lieu.' }
}
# Chay mot file test tu ROLLBACK; kiem 0 FAIL, trang thai khong doi, khong de lai du lieu. $minPass: so PASS toi thieu/chinh xac neu > 0.
function Run-ConstraintFile([string]$file, [int]$exactPass = 0) {
  $name = Split-Path $file -Leaf
  $r = TryPsql '' $file
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
  $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
  Say ('Ket qua ' + $name + ': PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + $(if ($exactPass -gt 0) { ', ky vong PASS=' + $exactPass } else { '' }) + ')')
  if ($r.Code -ne 0 -or -not $pass -or $failN) { Bad ($name + ' KHONG dat (xem log: dong "can_xem_lai").'); Say $r.Out }
  elseif ($exactPass -gt 0 -and [int]$pass -ne $exactPass) { Bad ($name + ': PASS=' + $pass + ' khac so phep kiem khai bao (' + $exactPass + ').'); Say $r.Out }
  else { Ok ($name + ': 0 FAIL.') }
  if ((AllState) -ne $EXPECT_ALL) { Bad 'Trang thai M1..M1.3 doi sau test (khong mong doi).' }
  Check-Clean
}
function Start-Psql([string]$file, [string]$tag) {
  $o = Join-Path $LogDir ('auth_m13_conc_' + $tag + '_' + $script:stamp + '.out.txt')
  $e = Join-Path $LogDir ('auth_m13_conc_' + $tag + '_' + $script:stamp + '.err.txt')
  $al = @('-X', '-w', '-h', '127.0.0.1', '-p', '5432', '-U', 'siscom_app', '-d', $DatabaseName, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', ('"' + $file + '"'))
  $p = Start-Process -FilePath $script:psql -ArgumentList $al -RedirectStandardOutput $o -RedirectStandardError $e -NoNewWindow -PassThru
  $null = $p.Handle  # PowerShell 5.1: giu handle de doc duoc ExitCode sau khi tien trinh ket thuc
  return @{ P = $p; Out = $o; Err = $e }
}
# Phien A giu khoa advisory ~4 giay; phien B bat dau cung luc, ngu 1 giay roi doi trang thai. Dat khi: A thanh cong, B cho >= 3 s roi bi chan dung ma, bat bien dung.
function Run-Pair([string]$name, [string]$sqlA, [string]$sqlB, [string]$expectRe, [string]$invSql, [string]$invLabel) {
  $enc = New-Object System.Text.UTF8Encoding -ArgumentList $false
  $fa = Join-Path $LogDir ('auth_m13_conc_' + $name + 'A_' + $script:stamp + '.sql'); [System.IO.File]::WriteAllText($fa, $sqlA, $enc)
  $fb = Join-Path $LogDir ('auth_m13_conc_' + $name + 'B_' + $script:stamp + '.sql'); [System.IO.File]::WriteAllText($fb, $sqlB, $enc)
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  try {
    $a = Start-Psql $fa ($name + 'A'); $b = Start-Psql $fb ($name + 'B')
    $doneA = $a.P.WaitForExit(60000); $doneB = $b.P.WaitForExit(60000)
    if (-not ($doneA -and $doneB)) {
      foreach ($x in @($a, $b)) { if (-not $x.P.HasExited) { Stop-Process -Id $x.P.Id -Force -ErrorAction SilentlyContinue } }
      Fail ($name + ': psql song song qua 60 giay (co the treo khoa); da dung tien trinh psql. Kiem tra pg_stat_activity.')
    }
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  $codeA = $a.P.ExitCode; $codeB = $b.P.ExitCode
  $errA = (Get-Content -LiteralPath $a.Err -Raw -ErrorAction SilentlyContinue); $errB = (Get-Content -LiteralPath $b.Err -Raw -ErrorAction SilentlyContinue)
  $secB = [math]::Round(($b.P.ExitTime - $b.P.StartTime).TotalSeconds, 1)
  Add-Content -LiteralPath $script:log -Value ($name + ' A ma=' + $codeA + ' err=' + $errA + "`n" + $name + ' B ma=' + $codeB + ' (' + $secB + ' s) err=' + $errB) -Encoding UTF8
  Say ($name + ': phien A ma ' + $codeA + ' | phien B ma ' + $codeB + ' (B chay ' + $secB + ' s; ~4 s = da cho khoa cua A)')
  if ($codeA -ne 0) { Bad ($name + ': phien A phai thanh cong (ma ' + $codeA + '). Neu B thang do A khoi dong cham: chay lai tren ban sao MOI.') }
  elseif ($codeB -eq 0) { Bad ($name + ': phien B KHONG bi chan - vuot ' + $expectRe + '.') }
  elseif ($errB -notmatch $expectRe) { Bad ($name + ': phien B bi tu choi KHONG dung ma ' + $expectRe + '. Xem log.') }
  elseif ($secB -lt 3) { Bad ($name + ': phien B chi chay ' + $secB + ' s (< 3 s): khong chung minh duoc da cho khoa cua A.') }
  else { Ok ($name + ': B cho khoa cua A (' + $secB + ' s) roi bi chan dung ma ' + $Matches[0] + '.') }
  $inv = Psql $invSql
  if ($inv -eq 't') { Ok ($name + ': ' + $invLabel) } else { Bad ($name + ': trang thai cuoi sai - ' + $invLabel + ' (= ' + $inv + ').') }
}
# ---------- Kiem tra tinh OFFLINE (khong DB, khong .env) ----------
function Static-Checks([string]$root) {
  $mig = Join-Path $root 'prisma\migrations'
  $dirs = @(Get-ChildItem -LiteralPath $mig -Directory | ForEach-Object { $_.Name })
  foreach ($m in @($M1, $M11, $M12, $M13)) { if ($dirs -contains $m) { Ok ('Co thu muc migration ' + $m) } else { Bad ('Thieu thu muc migration ' + $m) } }
  if ($dirs.Count -eq 6) { Ok 'Dung 6 thu muc migration.' } else { Bad ('Ky vong 6 thu muc migration, co ' + $dirs.Count + ': ' + ($dirs -join ', ')) }
  $d = Join-Path $root 'docs'
  $need = @('B1.3_M1_CONSTRAINT_TESTS.sql.txt', 'B1.3_M1_1_CONSTRAINT_TESTS.sql.txt', 'B1.3_M1_2_CONSTRAINT_TESTS.sql.txt', 'B1.3_M1_3_STRUCTURE_TESTS.sql.txt', 'B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt',
    'B1.3_M1_ROLLBACK.sql.txt', 'B1.3_M1_1_ROLLBACK.sql.txt', 'B1.3_M1_2_ROLLBACK.sql.txt', 'B1.3_M1_3_ROLLBACK.sql.txt', 'B1.3_M1_1_CONCURRENCY_SETUP.sql.txt', 'B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt')
  foreach ($n in $need) {
    $p = Join-Path $d $n
    if (-not (Test-Path -LiteralPath $p)) { Bad ('Thieu ' + $n); continue }
    $t = [System.IO.File]::ReadAllText($p)
    $isTest = $n -match 'TESTS|CONCURRENCY|ROLLBACK'
    if ($isTest -and $n -notmatch 'SCOPED') {
      if ($t -notmatch "siscom_crm_\(restore\|test\)_\[0-9\]\{8\}_\[0-9\]\{6\}") { Bad ($n + ': thieu guard ten database thu (regex restore|test).') } else { Ok ($n + ': co guard ten database thu.') }
    }
    Say ('SHA-256 (LF) ' + $n + ' = ' + (Hash-Lf $p))
  }
  $ft = Join-Path $d 'B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt'
  if (Test-Path -LiteralPath $ft) {
    $n = @([System.IO.File]::ReadAllLines($ft) | Where-Object { $_ -match '^SELECT pg_temp\.expect_(ok|err|true)\(' }).Count
    Say ('B1.3_M1_3_FUNCTIONAL_TESTS khai bao ' + $n + ' phep kiem (so PASS ky vong khi chay that).')
    if ($n -lt 30) { Bad 'So phep kiem chuc nang M1.3 < 30 (tep bi cat?).' } else { Ok 'So phep kiem chuc nang M1.3 hop le.' }
  }
  foreach ($m in @($M1, $M11, $M12, $M13)) { $f = Join-Path $mig ($m + '\migration.sql'); if (Test-Path -LiteralPath $f) { Say ('SHA-256 (LF) ' + $m + ' = ' + (Hash-Lf $f)) } }
  # Moi script xac minh phai co guard allowlist va KHONG co ten DB dich cam.
  foreach ($s in @('auth-m13-verify.ps1', 'run-auth-int-tests.ps1')) {
    $p = Join-Path $PSScriptRoot $s
    if (Test-Path -LiteralPath $p) { $t = [System.IO.File]::ReadAllText($p); if ($t -match "siscom_crm_\(restore\|test\)_") { Ok ($s + ': co allowlist ten database thu.') } else { Bad ($s + ': thieu allowlist ten database thu.') } }
  }
}
try {
  # ---- Guard ten database (chay TRUOC moi thao tac khac) ----
  if ($DatabaseName -notmatch $DB_ALLOW) { Fail 'DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS hoac siscom_crm_test_YYYYMMDD_HHMMSS (ban sao moi).' }
  if ($DB_DENY -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich.') }
  if ($DatabaseName -match $DB_DENY_WORDS) { Fail ('CAM: ten "' + $DatabaseName + '" chua tu khoa dev/prod/production/baseline/live.') }
  if ($TemplateDb -notmatch '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z' -or $TemplateDb -eq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  $script:root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $script:log = Join-Path $LogDir ('auth_m13_' + $Step + '_' + $DatabaseName + '_' + $script:stamp + '.txt')
  Set-Content -LiteralPath $script:log -Value ('auth-m13-verify step=' + $Step + ' db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  if ($Step -eq 'static') {
    Say 'Buoc static: OFFLINE, khong ket noi database, khong doc .env.' 'Yellow'
    Static-Checks $script:root
  }
  else {
    $d = Join-Path $script:root 'docs'
    $f = @{
      t1 = Join-Path $d 'B1.3_M1_CONSTRAINT_TESTS.sql.txt'; t11 = Join-Path $d 'B1.3_M1_1_CONSTRAINT_TESTS.sql.txt'; t12 = Join-Path $d 'B1.3_M1_2_CONSTRAINT_TESTS.sql.txt'
      s13 = Join-Path $d 'B1.3_M1_3_STRUCTURE_TESTS.sql.txt'; f13 = Join-Path $d 'B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt'
      rb1 = Join-Path $d 'B1.3_M1_ROLLBACK.sql.txt'; rb11 = Join-Path $d 'B1.3_M1_1_ROLLBACK.sql.txt'; rb12 = Join-Path $d 'B1.3_M1_2_ROLLBACK.sql.txt'; rb13 = Join-Path $d 'B1.3_M1_3_ROLLBACK.sql.txt'
      conc = Join-Path $d 'B1.3_M1_1_CONCURRENCY_SETUP.sql.txt'; reg = Join-Path $d 'B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt'
    }
    foreach ($k in $f.Keys) {
      if (-not (Test-Path -LiteralPath $f[$k])) { Fail ('Thieu file: ' + $f[$k]) }
      Say ('SHA-256 ' + (Split-Path $f[$k] -Leaf) + ' = ' + (Get-FileHash -LiteralPath $f[$k] -Algorithm SHA256).Hash + ' | sau chuan hoa LF = ' + (Hash-Lf $f[$k]))
    }
    foreach ($m in @($M1, $M11, $M12, $M13)) {
      $mf = Join-Path $script:root ('prisma\migrations\' + $m + '\migration.sql')
      if (-not (Test-Path -LiteralPath $mf)) { Fail ('Thieu migration: ' + $mf) }
      Say ('SHA-256 ' + $m + ' = ' + (Get-FileHash -LiteralPath $mf -Algorithm SHA256).Hash + ' | sau chuan hoa LF = ' + (Hash-Lf $mf))
    }
    $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
    $mode = if (@('guard', 'drift', 'structure13') -contains $Step) { 'chi doc' } elseif (@('constraints', 'constraints11', 'constraints12', 'functional13', 'regress') -contains $Step) { 'ghi tam trong transaction, tu ROLLBACK' } elseif ($Step -eq 'concurrency') { 'COMMIT du lieu demo + dong khoi tao VINH VIEN tren ban sao' } else { 'GHI cau truc ban sao (khong dung toi DB mau/siscom_crm_dev)' }
    Say ('Ban sao: ' + $DatabaseName + ' | Buoc: ' + $Step + ' | ' + $mode) 'Yellow'
    if ((Read-Host 'Go lai CHINH XAC ten ban sao de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
    if ($Step -eq 'concurrency' -and (Read-Host 'Buoc nay khong hoan tac duoc tren ban sao. Go COMMIT-FIXTURES de tiep tuc') -ne 'COMMIT-FIXTURES') { Fail 'Khong xac nhan COMMIT-FIXTURES. Dung lai.' }
    if (@('apply', 'rollback') -contains $Step -and (Read-Host 'Buoc nay GHI cau truc ban sao. Go WRITE-SCHEMA de tiep tuc') -ne 'WRITE-SCHEMA') { Fail 'Khong xac nhan WRITE-SCHEMA. Dung lai.' }
    $script:pw = Get-AppPasswordFromEnv (Join-Path $script:root '.env')
    $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid, 'pg_database'), '') || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name IN ('20261011000000_init', '20261012000000_b1_2_crm_core') AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();").Split('|')
    if ($info[0] -ne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
    if ($info[1] -ne 'siscom_app' -or $info[2] -ne 'siscom_app') { Fail 'Tai khoan hoac chu so huu khong phai siscom_app (da tach role? dung auth-s1s3-verify cho cac buoc sau tach).' }
    if ($info[3] -ne ('SISCOM_STATS_CLONE_OF:' + $TemplateDb)) { Fail 'Database KHONG co nhan ban sao cua make-stats-clone khop -TemplateDb. TU CHOI.' }
    if ($info[4] -ne '2') { Fail 'Thieu migration init / b1_2_crm_core da ap.' }
    if ([int]$info[5] -lt 150000) { Fail ('PostgreSQL ' + $info[5] + ' < 15: khong ho tro NULLS NOT DISTINCT (uq_pcr_pending).') }
    Ok ('Guard: ban sao co nhan, khong nam trong danh sach cam, chu so huu siscom_app, PostgreSQL ' + $info[5] + '.')
    $n = Sessions; if ($n -ne 0) { Fail ('Co ' + $n + ' phien khac dang ket noi toi ban sao. Dung (khong ngat ket noi cua ai).') }
    Ok 'Khong co phien khac.'
    $state = AllState
    $script:rbac = Psql "SELECT (SELECT count(*) FROM role) || '|' || (SELECT count(*) FROM permission) || '|' || (SELECT count(*) FROM role_permission) || '|' || (SELECT count(*) FROM employee_role) || '|' || (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');"
    Say ('Trang thai M1 / M1.1 / M1.2 / M1.3 = ' + $state + ' ; RBAC (role|permission|role_permission|employee_role|bootstrap_done) = ' + $script:rbac)
    switch ($Step) {
      'guard' {
        $dirs = @(Get-ChildItem -LiteralPath (Join-Path $script:root 'prisma\migrations') -Directory | ForEach-Object { $_.Name })
        Say ('Thu muc migration: ' + ($dirs -join ', '))
        if ($dirs.Count -ne 6) { Bad 'Ky vong dung 6 thu muc migration (init, b1_2_crm_core, M1, M1.1, M1.2, M1.3).' } else { Ok 'Dung 6 thu muc migration.' }
        if ($state -ne $EXPECT_NONE) { Bad ('Ban sao da co dau vet M1..M1.3 (' + $state + '): dung ban sao MOI.') } else { Ok 'Ban sao chua co M1..M1.3.' }
        if ($script:rbac -ne '0|0|0|0|0') { Bad ('Bang RBAC khong rong (' + $script:rbac + '): test se tu choi chay.') } else { Ok 'Bang RBAC rong, chua co auth_bootstrap_done.' }
        $r = Prisma @('migrate', 'status')
        Say ('prisma migrate status (ma ' + $r.Code + '): ' + (($r.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
      }
      'apply' {
        if ($state -ne $EXPECT_NONE) { Fail ('Da co dau vet M1..M1.3 (' + $state + '): khong ap lai. Dung -Step rollback de thu hoan tac/ap lai.') }
        Require-CleanRbac
        Say 'Ap M1 + M1.1 + M1.2 + M1.3 bang prisma migrate deploy (chi ban sao)...' 'Yellow'
        if (Deploy) { Expect-Applied }
      }
      'constraints' { Require-Applied; Require-CleanRbac; Run-ConstraintFile $f.t1 }
      'constraints11' { Require-Applied; Require-CleanRbac; Run-ConstraintFile $f.t11 }
      'constraints12' { Require-Applied; Require-CleanRbac; Run-ConstraintFile $f.t12 }
      'structure13' {
        Require-Applied
        $r = TryPsql '' $f.s13
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        $rows = @($r.Out -split "`n" | Where-Object { $_ -match '\|(t|f)\s*$' })
        $bad = @($rows | Where-Object { $_ -match '\|f\s*$' })
        Say ('structure13: ' + $rows.Count + ' dong, ' + $bad.Count + ' dong ok = f (ma psql ' + $r.Code + ')')
        if ($r.Code -ne 0 -or $rows.Count -lt 6 -or $bad.Count -gt 0) { Bad 'B1.3_M1_3_STRUCTURE_TESTS khong dat (can >= 6 dong, moi dong t).'; Say $r.Out } else { Ok 'B1.3_M1_3_STRUCTURE_TESTS: moi dong ok = t.' }
      }
      'functional13' {
        Require-Applied; Require-CleanRbac
        $expected = @([System.IO.File]::ReadAllLines($f.f13) | Where-Object { $_ -match '^SELECT pg_temp\.expect_(ok|err|true)\(' }).Count
        Run-ConstraintFile $f.f13 $expected
      }
      'regress' {
        Require-Applied
        $r = TryPsql '' $f.reg
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
        $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
        Say ('Ket qua: PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ', ky vong PASS=57)')
        if ($r.Code -ne 0 -or $failN -or $pass -ne '57' -or $r.Out -match '(?m)^(psql:.*)?ERROR') { Bad 'B1.2.2_CONSTRAINT_TESTS_SCOPED co FAIL/ERROR hoac khong du 57 PASS sau M1..M1.3.'; Say $r.Out } else { Ok 'B1.2.2_CONSTRAINT_TESTS_SCOPED: 57/57 PASS sau M1..M1.3.' }
      }
      'drift' {
        Require-Applied
        $outFile = Join-Path $LogDir ('auth_m13_drift_' + $DatabaseName + '.sql')
        $r1 = Prisma @('migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', $outFile)
        $r2 = Prisma @('migrate', 'status')
        Say ('prisma migrate status (ma ' + $r2.Code + '): ' + (($r2.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
        if ($r2.Code -ne 0 -or $r2.Out -notmatch 'up to date') { Bad 'prisma migrate status khong bao "up to date".' }
        if ($r1.Code -ne 0) { Bad ('prisma migrate diff loi (ma ' + $r1.Code + '): ' + $r1.Out) }
        elseif ([System.IO.File]::ReadAllText($outFile) -match 'empty migration') { Ok 'migrate diff: "empty migration" - schema.prisma khop ban sao sau M1..M1.3.' }
        else { Bad ('migrate diff co noi dung (LECH), KHONG chay noi dung do. Xem: ' + $outFile) }
      }
      'rollback' {
        Require-Applied; Require-CleanRbac
        $chain = @(
          @{ F = $f.rb13; Re = 'ROLLBACK M1\.3 XONG'; L = 'Rollback M1.3' },
          @{ F = $f.rb12; Re = '(?m)^0\|0\|0$'; L = 'Rollback M1.2' },
          @{ F = $f.rb11; Re = '(?m)^0\|0\|0$'; L = 'Rollback M1.1' },
          @{ F = $f.rb1; Re = '(?m)^0\|0\|0\|0\|0$'; L = 'Rollback M1' })
        foreach ($c in $chain) {
          if ($script:fail) { break }
          $r = TryPsql '' $c.F
          Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
          if ($r.Code -ne 0) { Bad ($c.L + ' loi: ' + $r.Out) } elseif ($r.Out -notmatch $c.Re) { Bad ($c.L + ': van con doi tuong hoac thieu dong xac nhan: ' + $r.Out) } else { Ok ($c.L + ': sach.') }
        }
        $s = AllState
        if ($s -ne $EXPECT_NONE) { Bad ('Trang thai sau rollback = ' + $s + ' (ky vong ' + $EXPECT_NONE + ').') } else { Ok ('Trang thai sau rollback = ' + $s + '.') }
        if (-not $script:fail) { Say 'Ap lai M1..M1.3 bang prisma migrate deploy...' 'Yellow'; if (Deploy) { Expect-Applied } }
      }
      'concurrency' {
        Require-Applied; Require-CleanRbac
        $r = TryPsql '' $f.conc
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        if ($r.Code -ne 0 -or $r.Out -notmatch '(?m)^SETUP_OK$') { Fail ('B1.3_M1_1_CONCURRENCY_SETUP.sql.txt loi: ' + $r.Out) }
        Ok 'Du lieu nen song song da COMMIT (ban sao nay khong con dung cho constraints/rollback).'
        $c1a = "BEGIN;`nUPDATE employee SET status = 'RESIGNED' WHERE id = 'f1382000-0000-4000-8000-000000000001';`nSELECT pg_sleep(4);`nCOMMIT;`n"
        $c1b = "SELECT pg_sleep(1);`nUPDATE employee SET deleted_at = now(), deleted_by = 'f1382000-0000-4000-8000-000000000005' WHERE id = 'f1382000-0000-4000-8000-000000000002';`n"
        $c1i = "SELECT (SELECT count(*) FROM employee_role er JOIN role r ON r.id = er.role_id JOIN employee e ON e.id = er.employee_id WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL) = 1" +
               " AND (SELECT status = 'RESIGNED' FROM employee WHERE id = 'f1382000-0000-4000-8000-000000000001')" +
               " AND (SELECT status = 'ACTIVE' AND deleted_at IS NULL FROM employee WHERE id = 'f1382000-0000-4000-8000-000000000002');"
        Run-Pair 'C1' $c1a $c1b 'LAST_ADMIN' $c1i 'CA1 RESIGNED, CA2 con hieu luc, dung 1 admin hieu luc'
        $c2a = "BEGIN;`nSELECT set_config('app.priv_request_id', 'f1383000-0000-4000-8000-000000000001', true), set_config('app.actor_employee_id', 'f1382000-0000-4000-8000-000000000005', true);`n" +
               "DELETE FROM employee_role WHERE employee_id = 'f1382000-0000-4000-8000-000000000004' AND role_id = 'f1381000-0000-4000-8000-000000000002';`nSELECT pg_sleep(4);`nCOMMIT;`n"
        $c2b = "SELECT pg_sleep(1);`nUPDATE employee SET status = 'ON_LEAVE' WHERE id = 'f1382000-0000-4000-8000-000000000003';`n"
        $c2i = "SELECT (SELECT count(*) FROM employee e WHERE fn_auth_emp_can_approve(e.id)) = 1" +
               " AND (SELECT status = 'EXECUTED' AND executed_by = 'f1382000-0000-4000-8000-000000000005' FROM privileged_change_request WHERE id = 'f1383000-0000-4000-8000-000000000001')" +
               " AND NOT EXISTS (SELECT 1 FROM employee_role WHERE employee_id = 'f1382000-0000-4000-8000-000000000004')" +
               " AND (SELECT status = 'ACTIVE' FROM employee WHERE id = 'f1382000-0000-4000-8000-000000000003');"
        Run-Pair 'C2' $c2a $c2b 'LAST_APPROVER' $c2i 'yeu cau EXECUTED boi CS, CD2 mat director, CD1 ACTIVE, dung 1 nguoi duyet hieu luc'
        Say 'Ban sao nay da dong khoi tao va co du lieu demo: KHONG dung lai cho buoc khac; xoa thu cong khi duoc phep.' 'Yellow'
      }
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
