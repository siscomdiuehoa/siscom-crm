# SISCOM CRM B1.2.3-B2 P2-3c - KIEM CHUNG contact.full_name_fold STORED tren BAN SAO THU MOI. KHONG tu chay.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\fold-verify.ps1 (file moi). Chi lam viec voi -DatabaseName (ban sao tao boi make-stats-clone, co nhan SISCOM_STATS_CLONE_OF:<TemplateDb>).
# Tuyet doi KHONG: siscom_crm_dev, siscom_crm_restore_20261014_214105 (P1 da khoa), siscom_crm_restore_20261015_214948 (ban sao PERF dang dung) lam DICH (danh sach cam trong script).
# Steps: guard (doc) | apply (ALTER TABLE) | sync (giao dich tu ROLLBACK) | rollback (DDL rollback + down.sql + up.sql lai) | drift (prisma migrate diff/status, khong sua schema) | probe (jest: S0 vs A2-stored, chi doc)
# Mat khau siscom_app doc tu DATABASE_URL trong .env (CHI DOC); khong in; DATABASE_URL chi duoc dat cho tien trinh con tro DUNG ban sao (buoc drift) roi xoa.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [Parameter(Mandatory = $true)][string]$TemplateDb,
  [Parameter(Mandatory = $true)][ValidateSet('guard', 'apply', 'sync', 'rollback', 'drift', 'probe')][string]$Step,
  [string]$LogDir = 'D:\SISCOM-CRM\backups\b123'
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:log = $null
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
  if ($src -ne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi "' + $src + '", ky vong siscom_crm_dev (chi de doi chieu, KHONG dung lam dich).') }
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
function PsqlFile([string]$file) { $r = TryPsql '' $file; if ($r.Code -ne 0) { Fail ('psql bao loi khi chay ' + (Split-Path $file -Leaf) + ': ' + $r.Out) }; return $r.Out }
function HasCol([string]$col) { return ((Psql ("SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.contact'::regclass AND a.attname = '" + $col + "' AND NOT a.attisdropped;")) -eq '1') }
function Fingerprint { return (Psql "SELECT count(*) || '|' || coalesce(md5(string_agg(concat_ws('~', id, customer_id, full_name, coalesce(phone,''), is_primary::text, coalesce(deleted_at::text,''), updated_at::text), ',' ORDER BY id)), '-') FROM public.contact;") }
function Mismatch { return [int](Psql 'SELECT count(*) FROM public.contact WHERE full_name_fold IS DISTINCT FROM public.f_vn_fold(full_name);') }
function Sessions { return [int](Psql 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();') }
try {
  $pat = '^siscom_crm_restore_\d{8}_\d{6}$'
  $deny = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')
  if ($DatabaseName -notmatch $pat) { Fail 'DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS (ban sao moi).' }
  if ($deny -contains $DatabaseName) { Fail ('CAM: "' + $DatabaseName + '" khong duoc dung lam dich cua buoc kiem chung nay.') }
  if ($TemplateDb -notmatch $pat -or $TemplateDb -eq $DatabaseName) { Fail 'TemplateDb phai la database nguon cua ban sao (khac ban sao).' }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
  $script:log = Join-Path $LogDir ('fold_' + $Step + '_' + $DatabaseName + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('fold-verify step=' + $Step + ' db=' + $DatabaseName + ' template=' + $TemplateDb + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $sqlDir = Join-Path $root 'docs\proposed-migration'
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Ban sao: ' + $DatabaseName + ' | Buoc: ' + $Step + ' | ' + $(if (@('guard', 'drift', 'probe') -contains $Step) { 'khong sua cau truc ban sao' } else { 'GHI cau truc ban sao (khong dung toi DB goc/siscom_crm_dev)' })) 'Yellow'
  if ((Read-Host 'Go lai CHINH XAC ten ban sao de xac nhan') -ne $DatabaseName) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')
  $info = (Psql "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid, 'pg_database'), '') || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261012000000_b1_2_crm_core' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' || (SELECT count(*) FROM public.customer WHERE legacy_id LIKE 'PERF-%')::text FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -ne $DatabaseName) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $DatabaseName + '".') }
  if ($info[1] -ne 'siscom_app' -or $info[2] -ne 'siscom_app') { Fail 'Tai khoan hoac chu so huu khong phai siscom_app.' }
  if ($info[3] -ne ('SISCOM_STATS_CLONE_OF:' + $TemplateDb)) { Fail 'Database KHONG co nhan ban sao cua make-stats-clone khop -TemplateDb. TU CHOI.' }
  if ($info[4] -ne '1') { Fail 'Thieu migration 20261012000000_b1_2_crm_core.' }
  if ($info[5] -ne '50000') { Fail ('So khach PERF = ' + $info[5] + ', ky vong 50000 (ban sao dung bo PERF).') }
  Ok 'Guard: dung ban sao co nhan, khong nam trong danh sach cam, schema B1.2 va bo PERF co mat.'
  $n = Sessions; if ($n -ne 0) { Fail ('Co ' + $n + ' phien khac dang ket noi toi ban sao. Dung (khong ngat ket noi cua ai).') }
  Ok 'Khong co phien khac.'
  $vol = (Psql "SELECT string_agg(p.proname || ':' || p.provolatile::text, ', ' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('f_vn_fold', 'unaccent');")
  Say ('Do on dinh ham (i=IMMUTABLE, s=STABLE, v=VOLATILE): ' + $vol)
  if ($vol -notmatch 'f_vn_fold:i') { Fail 'f_vn_fold KHONG IMMUTABLE: dung, khong tao cot sinh san.' }
  $has = HasCol 'full_name_fold'
  $fp0 = Fingerprint
  Say ('Cot full_name_fold: ' + $(if ($has) { 'DA CO' } else { 'chua co' }) + ' | contact (so dong|dau van tay): ' + $fp0)
  switch ($Step) {
    'guard' {
      $r = TryPsql "BEGIN; CREATE TEMP TABLE t_fold_probe (s text, f text GENERATED ALWAYS AS (public.f_vn_fold(s)) STORED) ON COMMIT DROP; INSERT INTO t_fold_probe (s) VALUES (E'Nguy\u1EC5n V\u0103n \u00C1nh'); SELECT CASE WHEN f = 'nguyen van anh' THEN 'STORED_OK' ELSE 'STORED_SAI:' || f END FROM t_fold_probe; ROLLBACK;"
      if ($r.Code -ne 0 -or $r.Out -notmatch 'STORED_OK') { Bad ('Khong tao duoc cot STORED tu f_vn_fold (bang tam): ' + $r.Out) } else { Ok 'PostgreSQL chap nhan cot GENERATED ... STORED tu f_vn_fold (bang tam, da ROLLBACK).' }
      Say ('Dung luong: ' + (Psql "SELECT pg_size_pretty(pg_relation_size('public.contact')) || ' bang; ' || pg_size_pretty(pg_indexes_size('public.contact')) || ' chi muc; do dai ten tb ' || round(avg(octet_length(full_name)),1) FROM public.contact;"))
      Say ('Phien ban: ' + (Psql 'SHOW server_version;'))
    }
    'apply' {
      if ($has) { Fail 'Cot da ton tai: khong ap lai (dung -Step rollback de thu hoan tac/ap lai).' }
      Say 'Ap up.sql (ALTER TABLE ghi lai toan bang, giu khoa ACCESS EXCLUSIVE tren ban sao thu)...' 'Yellow'
      $sw = [System.Diagnostics.Stopwatch]::StartNew(); [void](PsqlFile (Join-Path $sqlDir 'B1_2_4_contact_full_name_fold.up.sql')); $sw.Stop()
      Ok ('up.sql xong sau ' + [math]::Round($sw.Elapsed.TotalSeconds, 2) + ' giay.')
      if (-not (HasCol 'full_name_fold')) { Bad 'Cot khong xuat hien sau up.sql.' }
      $g = Psql "SELECT attgenerated FROM pg_attribute WHERE attrelid = 'public.contact'::regclass AND attname = 'full_name_fold';"
      if ($g -ne 's') { Bad ('attgenerated = "' + $g + '", ky vong s (STORED).') } else { Ok 'Cot la GENERATED STORED.' }
      [void](Psql 'ANALYZE public.contact;')
      $m = Mismatch; if ($m -ne 0) { Bad ($m.ToString() + ' dong full_name_fold khac f_vn_fold(full_name).') } else { Ok 'Doi chieu toan bang: 0 dong lech.' }
      $fp1 = Fingerprint; if ($fp1 -ne $fp0) { Bad ('Du lieu contact doi: ' + $fp0 + ' -> ' + $fp1) } else { Ok 'Du lieu contact (cac cot goc) khong doi.' }
      Say ('Dung luong sau: ' + (Psql "SELECT pg_size_pretty(pg_relation_size('public.contact'));"))
    }
    'sync' {
      if (-not $has) { Fail 'Chua co cot (chay -Step apply truoc).' }
      $r = TryPsql '' (Join-Path $sqlDir 'fold_sync_test.sql')
      Say $r.Out
      if ($r.Code -ne 0 -or $r.Out -notmatch 'DONG BO DAT') { Bad 'fold_sync_test.sql KHONG dat.' } else { Ok 'Dong bo: INSERT, UPDATE ten, UPDATE cot khac, xoa mem, doi chieu toan bang deu dat.' }
      $fp1 = Fingerprint; if ($fp1 -ne $fp0) { Bad ('Sau ROLLBACK du lieu contact van doi: ' + $fp0 + ' -> ' + $fp1) } else { Ok 'ROLLBACK sach: contact khong doi.' }
      if ((Sessions) -ne 0) { Bad 'Con phien hoat dong sau kiem tra.' }
    }
    'rollback' {
      if (-not $has) { Fail 'Chua co cot (chay -Step apply truoc).' }
      $r = TryPsql "BEGIN; ALTER TABLE public.contact ADD COLUMN x_probe text GENERATED ALWAYS AS (public.f_vn_fold(full_name)) STORED; SELECT 1/0; COMMIT;"
      if ($r.Code -eq 0) { Bad 'Cau co y loi lai thanh cong (bat thuong).' }
      if (HasCol 'x_probe') { Bad 'x_probe con lai sau giao dich loi: DDL KHONG rollback.' } else { Ok 'Giao dich DDL loi -> ROLLBACK het (x_probe khong ton tai).' }
      [void](PsqlFile (Join-Path $sqlDir 'B1_2_4_contact_full_name_fold.down.sql'))
      if (HasCol 'full_name_fold') { Bad 'down.sql chay xong nhung cot van con.' } else { Ok 'down.sql: cot da go.' }
      $fpd = Fingerprint; if ($fpd -ne $fp0) { Bad ('Sau down.sql du lieu contact doi: ' + $fp0 + ' -> ' + $fpd) } else { Ok 'Sau down.sql du lieu contact khong doi.' }
      [void](PsqlFile (Join-Path $sqlDir 'B1_2_4_contact_full_name_fold.up.sql'))
      if (-not (HasCol 'full_name_fold')) { Bad 'Ap lai up.sql that bai.' } else { Ok 'Ap lai up.sql: cot co mat tro lai.' }
      [void](Psql 'ANALYZE public.contact;')
      $m = Mismatch; if ($m -ne 0) { Bad ($m.ToString() + ' dong lech sau khi ap lai.') } else { Ok 'Sau ap lai: 0 dong lech.' }
      $fpu = Fingerprint; if ($fpu -ne $fp0) { Bad ('Sau ap lai du lieu contact doi: ' + $fp0 + ' -> ' + $fpu) } else { Ok 'Sau ap lai du lieu contact khong doi.' }
    }
    'drift' {
      if (-not $has) { Fail 'Chua co cot (chay -Step apply truoc).' }
      $outFile = Join-Path $LogDir ('fold_drift_' + $DatabaseName + '.sql')
      $env:DATABASE_URL = 'postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $DatabaseName
      Push-Location $root
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try {
        $o1 = & npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --output $outFile 2>&1; $dc = $LASTEXITCODE
        $o2 = & npx.cmd prisma migrate status 2>&1; $sc = $LASTEXITCODE
      } finally { $ErrorActionPreference = $prev; Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
      Say ('prisma migrate status (ma ' + $sc + '): ' + (($o2 | ForEach-Object { $_.ToString() }) -join ' | '))
      if ($dc -ne 0) { Bad ('prisma migrate diff loi (ma ' + $dc + '): ' + (($o1 | ForEach-Object { $_.ToString() }) -join ' | ')) }
      else {
        $t = [System.IO.File]::ReadAllText($outFile)
        if ($t -match 'full_name_fold') { Bad ('Prisma coi cot full_name_fold la LECH (xem ' + $outFile + ').') }
        elseif ($t -match 'empty migration') { Ok 'migrate diff: "empty migration" - KHONG lech, Prisma khong dong den cot sinh san.' }
        else { Bad ('migrate diff co noi dung khac, can doc: ' + $outFile) }
      }
    }
    'probe' {
      if (-not $has) { Fail 'Chua co cot (chay -Step apply truoc).' }
      $enc = [uri]::EscapeDataString($script:pw)
      $env:TEST_DATABASE_URL = 'postgresql://siscom_app:' + $enc + '@127.0.0.1:5432/' + $DatabaseName
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
      $env:BENCH_EXPECT_DB = $DatabaseName; $env:BENCH_FOLD_PROBE = '1'; $env:PERF_REPORT_DIR = $LogDir
      $script:pw = $null
      $jest = Join-Path $root 'node_modules\jest\bin\jest.js'
      if (-not (Test-Path -LiteralPath $jest)) { Fail 'Khong thay node_modules\jest\bin\jest.js.' }
      Say 'Chay jest: test/perf/bench/fold-probe.bench-spec.ts (chi doc, ban sao).' 'Yellow'
      Push-Location $root
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & node.exe $jest --config ./test/jest-bench.json --runInBand --runTestsByPath test/perf/bench/fold-probe.bench-spec.ts 2>&1 | ForEach-Object { Say $_.ToString() }; $code = $LASTEXITCODE }
      finally { $ErrorActionPreference = $prev; Pop-Location }
      if ($code -ne 0) { Bad ('fold-probe thoat ma ' + $code + ' (xem fold_probe_*.json).') } else { Ok 'fold-probe thoat ma 0 (khop tuyet doi; xem gateVerdict trong fold_probe_*.json).' }
    }
  }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; foreach ($n in 'PGPASSWORD', 'DATABASE_URL', 'TEST_DATABASE_URL', 'BENCH_EXPECT_DB', 'BENCH_FOLD_PROBE', 'PERF_REPORT_DIR') { Remove-Item ('Env:' + $n) -ErrorAction SilentlyContinue } }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Dung lai va gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: buoc nay DAT.' -ForegroundColor Green }
