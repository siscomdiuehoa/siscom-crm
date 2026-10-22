# SISCOM CRM B1.3.2-B - KIEM CHUNG migration M1 (20261020000000_b1_3_auth_core) tren BAN SAO THU MOI. KHONG tu chay; can phe duyet rieng.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\auth-m1-verify.ps1 (file moi). Chi lam viec voi -DatabaseName = ban sao tao boi make-stats-clone
#   (co nhan SISCOM_STATS_CLONE_OF:<TemplateDb>). Mau duoc duyet: siscom_crm_restore_20261015_214948 (CHI DOC, khong bao gio la dich).
# Tuyet doi KHONG: siscom_crm_dev, siscom_crm_restore_20261014_214105, siscom_crm_restore_20261015_214948 lam DICH (danh sach cam trong script).
# Steps: guard (chi doc) | apply (prisma migrate deploy tren ban sao) | constraints (B1.3_M1_CONSTRAINT_TESTS.sql.txt, tu ROLLBACK)
#        | regress (B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt, tu ROLLBACK, can dung PASS|57) | rollback (B1.3_M1_ROLLBACK.sql.txt roi migrate deploy lai) | drift (prisma migrate diff/status)
# Hai file M1 *.sql.txt la SQL thuan (duoi .txt de Git theo doi ma khong doi .gitignore); psql -f doc binh thuong.
# Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC, khong in); DATABASE_URL chi dat cho tien trinh con tro DUNG ban sao roi xoa.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [string]$TemplateDb = 'siscom_crm_restore_20261015_214948',
  [Parameter(Mandatory = $true)][ValidateSet('guard', 'apply', 'constraints', 'regress', 'rollback', 'drift')][string]$Step,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b132b'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
$M1 = '20261020000000_b1_3_auth_core'
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
# M1State: so bang M1 | so trigger M1 tren bang cu | dong _prisma_migrations cua M1 da xong
function M1State {
  return (Psql ("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('employee_credential','auth_session','password_reset_token','privileged_change_request'))::text || '|' || " +
    "(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_employee_role_guard','trg_employee_role_no_update','trg_employee_role_no_truncate','trg_employee_role_sod','trg_role_permission_guard','trg_role_permission_no_truncate','trg_role_permission_sod','trg_app_meta_bootstrap_lock','trg_app_meta_bootstrap_truncate','trg_permission_guard_delete'))::text || '|' || " +
    "(SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '" + $M1 + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;"))
}
function Sessions { return [int](Psql 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();') }
function Deploy {
  $r = Prisma @('migrate', 'deploy')
  Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
  if ($r.Code -ne 0) { Bad ('prisma migrate deploy that bai (ma ' + $r.Code + '). 15 dong cuoi:'); Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n"); return $false }
  Ok 'prisma migrate deploy thanh cong.'; return $true
}
function Expect-Applied {
  $s = M1State
  if ($s -eq '4|10|1') { Ok 'M1 co mat: 4 bang, 10 trigger tren bang cu, _prisma_migrations da ghi.' } else { Bad ('Trang thai M1 sau ap = ' + $s + ' (ky vong 4|10|1).') }
}
try {
  $pat = '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z'
  $deny = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
  if ($DatabaseName -cnotmatch $pat) { Fail 'DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS (ban sao moi).' }
  if ($deny -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich.') }
  if ($TemplateDb -cnotmatch $pat -or $TemplateDb -ceq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:log = Join-Path $LogDir ('auth_m1_' + $Step + '_' + $DatabaseName + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('auth-m1-verify step=' + $Step + ' db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $script:root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $migFile = Join-Path $script:root ('prisma\migrations\' + $M1 + '\migration.sql')
  $testFile = Join-Path $script:root 'docs\B1.3_M1_CONSTRAINT_TESTS.sql.txt'
  $rbFile = Join-Path $script:root 'docs\B1.3_M1_ROLLBACK.sql.txt'
  $regFile = Join-Path $script:root 'docs\B1.2.2_CONSTRAINT_TESTS_SCOPED.sql.txt'
  $hashFiles = @($migFile, $testFile, $rbFile); if ($Step -eq 'regress') { $hashFiles += $regFile }
  foreach ($f in $hashFiles) {
    if (-not (Test-Path -LiteralPath $f)) { Fail ('Thieu file: ' + $f) }
    # core.autocrlf co the doi LF -> CRLF khi checkout: in them SHA-256 sau khi chuan hoa CRLF -> LF (= so trong B1.3.2B_REPORT.md).
    $lf = [System.IO.File]::ReadAllBytes($f); $lf = [byte[]]@(for ($i = 0; $i -lt $lf.Length; $i++) { if (-not ($lf[$i] -eq 13 -and $i + 1 -lt $lf.Length -and $lf[$i + 1] -eq 10)) { $lf[$i] } })
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $lfHash = -join ($sha.ComputeHash($lf) | ForEach-Object { $_.ToString('X2') }) } finally { $sha.Dispose() }
    Say ('SHA-256 ' + (Split-Path $f -Leaf) + ' = ' + (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash + ' | sau chuan hoa LF = ' + $lfHash)
  }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Ban sao: ' + $DatabaseName + ' | Buoc: ' + $Step + ' | ' + $(if (@('guard', 'drift') -contains $Step) { 'chi doc' } elseif (@('constraints', 'regress') -contains $Step) { 'ghi tam trong transaction, tu ROLLBACK' } else { 'GHI cau truc ban sao (khong dung toi DB mau/siscom_crm_dev)' })) 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten ban sao de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
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
  $rbac = Psql "SELECT (SELECT count(*) FROM role) || '|' || (SELECT count(*) FROM permission) || '|' || (SELECT count(*) FROM role_permission) || '|' || (SELECT count(*) FROM employee_role) || '|' || (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');"
  Say ('Trang thai M1 (bang|trigger|lich su) = ' + $state + ' ; RBAC (role|permission|role_permission|employee_role|bootstrap_done) = ' + $rbac)
  switch ($Step) {
    'guard' {
      $dirs = @(Get-ChildItem -LiteralPath (Join-Path $script:root 'prisma\migrations') -Directory | ForEach-Object { $_.Name })
      Say ('Thu muc migration: ' + ($dirs -join ', '))
      if ($dirs.Count -ne 3 -or $dirs -notcontains $M1) { Bad 'Ky vong dung 3 thu muc migration (init, b1_2_crm_core, M1).' } else { Ok 'Dung 3 thu muc migration; chi M1 la moi.' }
      if ($state -ne '0|0|0') { Bad ('Ban sao da co dau vet M1 (' + $state + '): dung ban sao MOI.') } else { Ok 'Ban sao chua co M1.' }
      if ($rbac -ne '0|0|0|0|0') { Bad ('Bang RBAC khong rong (' + $rbac + '): test rang buoc M1 se tu choi chay. Bao lai truoc khi tiep tuc.') } else { Ok 'Bang RBAC rong, chua co auth_bootstrap_done.' }
      $r = Prisma @('migrate', 'status')
      Say ('prisma migrate status (ma ' + $r.Code + '): ' + (($r.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
    }
    'apply' {
      if ($state -ne '0|0|0') { Fail ('M1 da co dau vet (' + $state + '): khong ap lai. Dung -Step rollback de thu hoan tac/ap lai.') }
      if ($rbac -ne '0|0|0|0|0') { Fail ('Bang RBAC khong rong (' + $rbac + '): dung lai, bao toi.') }
      Say 'Ap M1 bang prisma migrate deploy (chi ban sao)...' 'Yellow'
      if (Deploy) { Expect-Applied }
    }
    'constraints' {
      if ($state -ne '4|10|1') { Fail ('M1 chua ap day du (' + $state + '). Chay -Step apply truoc.') }
      $r = TryPsql '' $testFile
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
      $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
      Say ('Ket qua: PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ')')
      if ($r.Code -ne 0 -or -not $pass -or $failN) { Bad 'B1.3_M1_CONSTRAINT_TESTS.sql.txt KHONG dat (xem log: dong "can_xem_lai").'; Say $r.Out } else { Ok 'B1.3_M1_CONSTRAINT_TESTS.sql.txt: 0 FAIL.' }
      if ((M1State) -ne '4|10|1') { Bad 'Trang thai M1 doi sau test (khong mong doi).' }
      if ((Psql "SELECT (SELECT count(*) FROM privileged_change_request) + (SELECT count(*) FROM employee_role) + (SELECT count(*) FROM role) + (SELECT count(*) FROM app_meta WHERE key = 'auth_bootstrap_done');") -ne '0') { Bad 'Con du lieu sau ROLLBACK cua test.' } else { Ok 'ROLLBACK sach: khong de lai du lieu.' }
    }
    'regress' {
      if ($state -ne '4|10|1') { Fail ('M1 chua ap day du (' + $state + ').') }
      # Ban thu hep pham vi (Git theo doi): 57 assertion chi xet ban ghi thu; B122_SCOPE_GUARD dung neu UUID/ma/MST thu da ton tai.
      $r = TryPsql '' $regFile
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      $pass = ([regex]::Match($r.Out, '(?m)^PASS\|(\d+)')).Groups[1].Value
      $failN = ([regex]::Match($r.Out, '(?m)^FAIL\|(\d+)')).Groups[1].Value
      Say ('Ket qua: PASS=' + $pass + ' FAIL=' + $(if ($failN) { $failN } else { '0' }) + ' (ma psql ' + $r.Code + ', ky vong PASS=57)')
      if ($r.Code -ne 0 -or $failN -or $pass -ne '57' -or $r.Out -match '(?m)^(psql:.*)?ERROR') { Bad 'B1.2.2_CONSTRAINT_TESTS_SCOPED co FAIL/ERROR hoac khong du 57 PASS sau M1 (hoi quy).'; Say $r.Out } else { Ok 'B1.2.2_CONSTRAINT_TESTS_SCOPED: 57/57 PASS sau M1.' }
    }
    'rollback' {
      if ($state -ne '4|10|1') { Fail ('M1 chua ap day du (' + $state + ').') }
      $r = TryPsql '' $rbFile
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      if ($r.Code -ne 0) { Bad ('B1.3_M1_ROLLBACK.sql.txt loi: ' + $r.Out) }
      elseif ($r.Out -notmatch '(?m)^0\|0\|0\|0\|0$') { Bad ('Sau rollback van con doi tuong M1: ' + $r.Out) }
      else { Ok 'Rollback: 0 bang/enum/ham/trigger/lich su M1 con lai.' }
      $s = M1State; if ($s -ne '0|0|0') { Bad ('Trang thai sau rollback = ' + $s + ' (ky vong 0|0|0).') } else { Ok 'Trang thai sau rollback = 0|0|0.' }
      if (-not $script:fail) {
        Say 'Ap lai M1 bang prisma migrate deploy...' 'Yellow'
        if (Deploy) { Expect-Applied }
      }
    }
    'drift' {
      if ($state -ne '4|10|1') { Fail ('M1 chua ap day du (' + $state + ').') }
      $outFile = Join-Path $LogDir ('auth_m1_drift_' + $DatabaseName + '.sql')
      $r1 = Prisma @('migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--output', $outFile)
      $r2 = Prisma @('migrate', 'status')
      Say ('prisma migrate status (ma ' + $r2.Code + '): ' + (($r2.Out -split "`n" | Where-Object { $_ -match 'migration|pending|applied|schema is up to date' }) -join ' | '))
      if ($r1.Code -ne 0) { Bad ('prisma migrate diff loi (ma ' + $r1.Code + '): ' + $r1.Out) }
      else {
        $t = [System.IO.File]::ReadAllText($outFile)
        if ($t -match 'empty migration') { Ok 'migrate diff: "empty migration" - schema.prisma khop ban sao sau M1.' }
        else { Bad ('migrate diff co noi dung (LECH), KHONG chay noi dung do. Xem: ' + $outFile) }
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
