# SISCOM CRM B1.3.2-B - KIEM CHUNG M1 + M1.1 (20261020000000_b1_3_auth_core + 20261020120000_b1_3_auth_m1_1_guards) tren BAN SAO THU MOI.
# KHONG tu chay; can phe duyet rieng. Dich: D:\SISCOM-CRM\backend\scripts\windows\auth-m11-verify.ps1 (file moi).
# Thay the auth-m1-verify.ps1 KHI nhanh co M1.1 (auth-m1-verify ky vong dung 3 thu muc migration va khong biet thu tu rollback M1.1 -> M1).
# Chi lam viec voi -DatabaseName = ban sao tao boi make-stats-clone (nhan SISCOM_STATS_CLONE_OF:<TemplateDb>). Mau duoc duyet: siscom_crm_restore_20261015_214948 (CHI DOC).
# Tuyet doi KHONG: siscom_crm_dev, siscom_crm_restore_20261014_214105, siscom_crm_restore_20261015_214948 lam DICH (danh sach cam trong script).
# Steps: guard (chi doc) | apply (prisma migrate deploy: M1 + M1.1) | constraints (test M1, tu ROLLBACK) | constraints11 (test M1.1, tu ROLLBACK)
#        | regress (B1.2.2_CONSTRAINT_TESTS_SCOPED, can PASS|57) | rollback (M1.1 -> M1 -> migrate deploy lai) | drift (prisma migrate diff/status)
#        | concurrency (2 phien psql song song; COMMIT du lieu demo + dong khoi tao => BUOC CUOI, sau do bo ban sao)
# Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC, khong in); DATABASE_URL/PGPASSWORD chi dat cho tien trinh con tro DUNG ban sao roi xoa.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$TemplateDb = 'siscom_crm_restore_20261015_214948',
  [Parameter(Mandatory = $true)][ValidateSet('guard', 'apply', 'constraints', 'constraints11', 'regress', 'rollback', 'drift', 'concurrency')][string]$Step,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b132b'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
$M1 = '20261020000000_b1_3_auth_core'
$M11 = '20261020120000_b1_3_auth_m1_1_guards'
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
  if ($user -cne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -cne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -cne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi "' + $src + '", ky vong siscom_crm_dev (chi de lay mat khau, KHONG dung lam dich).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
# TryPsql: tra ve @{ Code; Out }. Khong nem loi.
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
# M1State: so bang M1 | so trigger M1 tren bang cu | dong _prisma_migrations cua M1 da xong (giong auth-m1-verify.ps1)
function M1State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('employee_credential','auth_session','password_reset_token','privileged_change_request'))::text || '|' || " +
    "(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_employee_role_guard','trg_employee_role_no_update','trg_employee_role_no_truncate','trg_employee_role_sod','trg_role_permission_guard','trg_role_permission_no_truncate','trg_role_permission_sod','trg_app_meta_bootstrap_lock','trg_app_meta_bootstrap_truncate','trg_permission_guard_delete'))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M1 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
# M11State: so trigger M1.1 | so ham M1.1 | dong _prisma_migrations cua M1.1 da xong
function M11State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_employee_status_guard','trg_pcr_exec_guard'))::text || '|' || " +
    "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('fn_auth_employee_status_guard','fn_pcr_exec_guard'))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M11 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function Sessions { return [int](Psql 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();') }
function Deploy {
  $r = Prisma @('migrate', 'deploy')
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  if ($r.Code -ne 0) { Bad ('prisma migrate deploy that bai (ma ' + $r.Code + '). 15 dong cuoi:'); Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n"); return $false }
  Ok 'prisma migrate deploy thanh cong.'; return $true
}
function Expect-Applied {
  $s = M1State; $s11 = M11State
  if ($s -eq '4|10|1') { Ok 'M1 co mat: 4 bang, 10 trigger tren bang cu, _prisma_migrations da ghi.' } else { Bad ('Trang thai M1 sau ap = ' + $s + ' (ky vong 4|10|1).') }
  if ($s11 -eq '2|2|1') { Ok 'M1.1 co mat: 2 trigger, 2 ham, _prisma_migrations da ghi.' } else { Bad ('Trang thai M1.1 sau ap = ' + $s11 + ' (ky vong 2|2|1).') }
}
function Require-Applied {
  $s = M1State; $s11 = M11State
  if ($s -ne '4|10|1' -or $s11 -ne '2|2|1') { Fail ('M1/M1.1 chua ap day du (M1 ' + $s + ', M1.1 ' + $s11 + '). Chay -Step apply truoc.') }
}
# Chay mot file test tu ROLLBACK; kiem 0 FAIL, trang thai khong doi, khong de lai du lieu.
function Run-ConstraintFile([string]$file) {
  $name = Split-Path $file -Leaf
  $r = TryPsql '' $file
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
  $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
  Say ('Ket qua ' + $name + ': PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ')')
  if ($r.Code -ne 0 -or -not $pass -or $failN) { Bad ($name + ' KHONG dat (xem log: dong "can_xem_lai").'); Say $r.Out } else { Ok ($name + ': 0 FAIL.') }
  if ((M1State) -ne '4|10|1' -or (M11State) -ne '2|2|1') { Bad 'Trang thai M1/M1.1 doi sau test (khong mong doi).' }
  if ((Psql "SELECT (SELECT count(*) FROM privileged_change_request) + (SELECT count(*) FROM employee_role) + (SELECT count(*) FROM role) + (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');") -ne '0') { Bad 'Con du lieu sau ROLLBACK cua test.' } else { Ok 'ROLLBACK sach: khong de lai du lieu.' }
}
# Chay psql nen (khong cho), stdout/stderr ra file trong LogDir. PGPASSWORD do ham goi dat/xoa.
function Start-Psql([string]$file, [string]$tag) {
  $o = Join-Path $LogDir ('auth_m11_conc_' + $tag + '_' + $script:stamp + '.out.txt')
  $e = Join-Path $LogDir ('auth_m11_conc_' + $tag + '_' + $script:stamp + '.err.txt')
  $al = @('-X', '-w', '-h', '127.0.0.1', '-p', '5432', '-U', 'siscom_app', '-d', $DatabaseName, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', ('"' + $file + '"'))
  $p = Start-Process -FilePath $script:psql -ArgumentList $al -RedirectStandardOutput $o -RedirectStandardError $e -NoNewWindow -PassThru
  $null = $p.Handle  # PowerShell 5.1: giu handle de doc duoc ExitCode sau khi tien trinh ket thuc
  return @{ P = $p; Out = $o; Err = $e }
}
# Kich ban song song: phien A giu khoa advisory ~4 giay; phien B bat dau cung luc, ngu 1 giay roi doi trang thai.
# Dat khi: dung MOT phien thanh cong, phien con lai bi tu choi voi ma mong doi, va bat bien ($inv) dung.
function Run-Pair([string]$name, [string]$sqlA, [string]$sqlB, [string]$expectRe, [string]$invSql, [string]$invLabel) {
  $enc = New-Object System.Text.UTF8Encoding -ArgumentList $false
  $fa = Join-Path $LogDir ('auth_m11_conc_' + $name + 'A_' + $script:stamp + '.sql'); [System.IO.File]::WriteAllText($fa, $sqlA, $enc)
  $fb = Join-Path $LogDir ('auth_m11_conc_' + $name + 'B_' + $script:stamp + '.sql'); [System.IO.File]::WriteAllText($fb, $sqlB, $enc)
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
  # Bat buoc thu tu A thang, B cho khoa (>= 3 s) roi bi chan dung ma; B thang = A khoi dong cham => duong cho khoa KHONG duoc thu.
  if ($codeA -ne 0) { Bad ($name + ': phien A phai thanh cong (ma ' + $codeA + '). Neu B thang do A khoi dong cham: chay lai tren ban sao MOI.') }
  elseif ($codeB -eq 0) { Bad ($name + ': phien B KHONG bi chan - vuot ' + $expectRe + '.') }
  elseif ($errB -notmatch $expectRe) { Bad ($name + ': phien B bi tu choi KHONG dung ma ' + $expectRe + '. Xem log.') }
  elseif ($secB -lt 3) { Bad ($name + ': phien B chi chay ' + $secB + ' s (< 3 s): khong chung minh duoc da cho khoa cua A.') }
  else { Ok ($name + ': B cho khoa cua A (' + $secB + ' s) roi bi chan dung ma ' + $Matches[0] + '.') }
  $inv = Psql $invSql
  if ($inv -eq 't') { Ok ($name + ': ' + $invLabel) } else { Bad ($name + ': trang thai cuoi sai - ' + $invLabel + ' (= ' + $inv + ').') }
}
try {
  $pat = '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z'
  $deny = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
  if ($DatabaseName -cnotmatch $pat) { Fail 'DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS (ban sao moi).' }
  if ($deny -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich.') }
  if ($TemplateDb -cnotmatch $pat -or $TemplateDb -ceq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $script:log = Join-Path $LogDir ('auth_m11_' + $Step + '_' + $DatabaseName + '_' + $script:stamp + '.txt')
  Set-Content -LiteralPath $script:log -Value ('auth-m11-verify step=' + $Step + ' db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $script:root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $migFile = Join-Path $script:root ('prisma\migrations\' + $M1 + '\migration.sql')
  $mig11File = Join-Path $script:root ('prisma\migrations\' + $M11 + '\migration.sql')
  $testFile = Join-Path $script:root 'docs\B1.3_M1_CONSTRAINT_TESTS.sql.txt'
  $test11File = Join-Path $script:root 'docs\B1.3_M1_1_CONSTRAINT_TESTS.sql.txt'
  $rbFile = Join-Path $script:root 'docs\B1.3_M1_ROLLBACK.sql.txt'
  $rb11File = Join-Path $script:root 'docs\B1.3_M1_1_ROLLBACK.sql.txt'
  $concFile = Join-Path $script:root 'docs\B1.3_M1_1_CONCURRENCY_SETUP.sql.txt'
  $regFile = Join-Path $script:root 'docs\B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt'
  $hashFiles = @($migFile, $mig11File, $testFile, $test11File, $rbFile, $rb11File, $concFile); if ($Step -eq 'regress') { $hashFiles += $regFile }
  foreach ($f in $hashFiles) {
    if (-not (Test-Path -LiteralPath $f)) { Fail ('Thieu file: ' + $f) }
    # core.autocrlf co the doi LF -> CRLF khi checkout: in them SHA-256 sau khi chuan hoa CRLF -> LF (= so trong B1.3.2B_M1_1_REPORT.md).
    $lf = [System.IO.File]::ReadAllBytes($f); $lf = [byte[]]@(for ($i = 0; $i -lt $lf.Length; $i++) { if (-not ($lf[$i] -eq 13 -and $i + 1 -lt $lf.Length -and $lf[$i + 1] -eq 10)) { $lf[$i] } })
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $lfHash = -join ($sha.ComputeHash($lf) | ForEach-Object { $_.ToString('X2') }) } finally { $sha.Dispose() }
    Say ('SHA-256 ' + (Split-Path $f -Leaf) + ' = ' + (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash + ' | sau chuan hoa LF = ' + $lfHash)
  }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Ban sao: ' + $DatabaseName + ' | Buoc: ' + $Step + ' | ' + $(if (@('guard', 'drift') -contains $Step) { 'chi doc' } elseif (@('constraints', 'constraints11', 'regress') -contains $Step) { 'ghi tam trong transaction, tu ROLLBACK' } elseif ($Step -eq 'concurrency') { 'COMMIT du lieu demo + dong khoi tao VINH VIEN tren ban sao' } else { 'GHI cau truc ban sao (khong dung toi DB mau/siscom_crm_dev)' })) 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten ban sao de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  if ($Step -eq 'concurrency' -and (Read-Host 'Buoc nay khong hoan tac duoc tren ban sao. Go COMMIT-FIXTURES de tiep tuc') -ne 'COMMIT-FIXTURES') { Fail 'Khong xac nhan COMMIT-FIXTURES. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $script:root '.env')
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid, 'pg_database'), '') || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name IN ('20261011000000_init', '20261012000000_b1_2_crm_core') AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -cne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -cne 'siscom_app' -or $info[2] -cne 'siscom_app') { Fail 'Tai khoan hoac chu so huu khong phai siscom_app.' }
  if ($info[3] -cne ('SISCOM_STATS_CLONE_OF:' + $TemplateDb)) { Fail 'Database KHONG co nhan ban sao cua make-stats-clone khop -TemplateDb. TU CHOI.' }
  if ($info[4] -ne '2') { Fail 'Thieu migration init / b1_2_crm_core da ap.' }
  if ([int]$info[5] -lt 150000) { Fail ('PostgreSQL ' + $info[5] + ' < 15: khong ho tro NULLS NOT DISTINCT (uq_pcr_pending).') }
  Ok ('Guard: ban sao co nhan, khong nam trong danh sach cam, co B1.1/B1.2, PostgreSQL ' + $info[5] + '.')
  $n = Sessions; if ($n -ne 0) { Fail ('Co ' + $n + ' phien khac dang ket noi toi ban sao. Dung (khong ngat ket noi cua ai).') }
  Ok 'Khong co phien khac.'
  $state = M1State
  $state11 = M11State
  $rbac = Psql "SELECT (SELECT count(*) FROM role) || '|' || (SELECT count(*) FROM permission) || '|' || (SELECT count(*) FROM role_permission) || '|' || (SELECT count(*) FROM employee_role) || '|' || (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');"
  Say ('Trang thai M1 (bang|trigger|lich su) = ' + $state + ' ; M1.1 (trigger|ham|lich su) = ' + $state11 + ' ; RBAC (role|permission|role_permission|employee_role|bootstrap_done) = ' + $rbac)
  switch ($Step) {
    'guard' {
      $dirs = @(Get-ChildItem -LiteralPath (Join-Path $script:root 'prisma\migrations') -Directory | ForEach-Object { $_.Name })
      Say ('Thu muc migration: ' + ($dirs -join ', '))
      if ($dirs.Count -ne 4 -or $dirs -notcontains $M1 -or $dirs -notcontains $M11) { Bad 'Ky vong dung 4 thu muc migration (init, b1_2_crm_core, M1, M1.1).' } else { Ok 'Dung 4 thu muc migration; M1 va M1.1 la moi.' }
      if ($state -ne '0|0|0' -or $state11 -ne '0|0|0') { Bad ('Ban sao da co dau vet M1/M1.1 (' + $state + ' / ' + $state11 + '): dung ban sao MOI.') } else { Ok 'Ban sao chua co M1/M1.1.' }
      if ($rbac -ne '0|0|0|0|0') { Bad ('Bang RBAC khong rong (' + $rbac + '): test rang buoc se tu choi chay. Bao lai truoc khi tiep tuc.') } else { Ok 'Bang RBAC rong, chua co auth_bootstrap_done.' }
      $r = Prisma @('migrate', 'status')
      Say ('prisma migrate status (ma ' + $r.Code + '): ' + (($r.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
    }
    'apply' {
      if ($state -ne '0|0|0' -or $state11 -ne '0|0|0') { Fail ('Da co dau vet M1/M1.1 (' + $state + ' / ' + $state11 + '): khong ap lai. Dung -Step rollback de thu hoan tac/ap lai.') }
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): dung lai, bao toi.') }
      Say 'Ap M1 + M1.1 bang prisma migrate deploy (chi ban sao)...' 'Yellow'
      if (Deploy) { Expect-Applied }
    }
    'constraints' { Require-Applied; Run-ConstraintFile $testFile }
    'constraints11' { Require-Applied; Run-ConstraintFile $test11File }
    'regress' {
      Require-Applied
      $r = TryPsql '' $regFile
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
      $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
      Say ('Ket qua: PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ', ky vong PASS=57)')
      if ($r.Code -ne 0 -or $failN -or $pass -ne '57' -or $r.Out -match '(?m)^(psql:.*)?ERROR') { Bad 'B1.2.2_CONSTRAINT_TESTS_SCOPED co FAIL/ERROR hoac khong du 57 PASS sau M1 + M1.1 (hoi quy).'; Say $r.Out } else { Ok 'B1.2.2_CONSTRAINT_TESTS_SCOPED: 57/57 PASS sau M1 + M1.1.' }
    }
    'rollback' {
      Require-Applied
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): rollback chi cho ban sao chua dung that.') }
      $r = TryPsql '' $rb11File
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      if ($r.Code -ne 0) { Bad ('B1.3_M1_1_ROLLBACK.sql.txt loi: ' + $r.Out) }
      elseif ($r.Out -notmatch '(?m)^0\|0\|0$') { Bad ('Sau rollback M1.1 van con doi tuong: ' + $r.Out) }
      else { Ok 'Rollback M1.1: 0 ham/trigger/lich su M1.1 con lai.' }
      if (-not $script:fail) {
        $r = TryPsql '' $rbFile
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        if ($r.Code -ne 0) { Bad ('B1.3_M1_ROLLBACK.sql.txt loi: ' + $r.Out) }
        elseif ($r.Out -notmatch '(?m)^0\|0\|0\|0\|0$') { Bad ('Sau rollback M1 van con doi tuong M1: ' + $r.Out) }
        else { Ok 'Rollback M1: 0 bang/enum/ham/trigger/lich su M1 con lai.' }
      }
      $s = M1State; $s11 = M11State
      if ($s -ne '0|0|0' -or $s11 -ne '0|0|0') { Bad ('Trang thai sau rollback = M1 ' + $s + ' / M1.1 ' + $s11 + ' (ky vong 0|0|0 / 0|0|0).') } else { Ok 'Trang thai sau rollback = 0|0|0 / 0|0|0.' }
      if (-not $script:fail) {
        Say 'Ap lai M1 + M1.1 bang prisma migrate deploy...' 'Yellow'
        if (Deploy) { Expect-Applied }
      }
    }
    'drift' {
      Require-Applied
      $outFile = Join-Path $LogDir ('auth_m11_drift_' + $DatabaseName + '.sql')
      $r1 = Prisma @('migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', $outFile)
      $r2 = Prisma @('migrate', 'status')
      Say ('prisma migrate status (ma ' + $r2.Code + '): ' + (($r2.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
      if ($r1.Code -ne 0) { Bad ('prisma migrate diff loi (ma ' + $r1.Code + '): ' + $r1.Out) }
      else {
        $t = [System.IO.File]::ReadAllText($outFile)
        if ($t -match 'empty migration') { Ok 'migrate diff: "empty migration" - schema.prisma khop ban sao sau M1 + M1.1.' }
        else { Bad ('migrate diff co noi dung (LECH), KHONG chay noi dung do. Xem: ' + $outFile) }
      }
    }
    'concurrency' {
      Require-Applied
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): buoc concurrency can ban sao chua co du lieu RBAC.') }
      $r = TryPsql '' $concFile
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
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; foreach ($n in 'PGPASSWORD', 'DATABASE_URL') { Remove-Item ('Env:' + $n) -ErrorAction SilentlyContinue } }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Dung lai va gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: buoc nay DAT.' -ForegroundColor Green }
