# SISCOM CRM B1.2.2 - TRIEN KHAI migration CHINH THUC bang Prisma Migrate (migrate deploy). CHUA CHAY - chi de ban ra soat.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\release-b122.ps1 (file moi)
# -Target scratch : dien tap `prisma migrate deploy` tren DATABASE THU MOI (siscom_crm_restore_*), de kiem tra lich su _prisma_migrations.
# -Target dev     : siscom_crm_dev THAT. Chi buoc `deploy` moi ghi; `preflight`/`verify` chi DOC. Buoc deploy tren dev can ban PHE DUYET RIENG (go cau xac nhan).
# Chi doc .env (khong sua). Mat khau chi nam trong bien tien trinh/PGPASSWORD (xoa ngay sau lenh), khong truyen qua tham so dong lenh, khong in ra.
# Khong dung prisma migrate dev / db push / migrate reset. Khong DROP/DELETE/TRUNCATE.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('dev', 'scratch')][string]$Target,
  [Parameter(Mandatory = $true)][ValidateSet('preflight', 'deploy', 'verify')][string]$Step,
  [string]$DatabaseName,
  [string]$RehearsedDb = 'siscom_crm_restore_20261011_223434',
  [string]$MigrationName = '20261012000000_b1_2_crm_core',
  [string]$Dir = 'D:\SISCOM-CRM\backups\b122',
  [string]$BackupDir = 'D:\SISCOM-CRM\db-backups',
  [int]$MaxBackupAgeMinutes = 30
)
$ErrorActionPreference = 'Stop'
$script:fail = $false; $script:pw = $null; $script:psql = $null; $script:log = $null
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
function Short-Hash([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Get-AppPasswordFromEnv([string]$envPath) {
  if (-not (Test-Path -LiteralPath $envPath)) { Fail ('Khong thay file .env: ' + $envPath) }
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
  if ($user -cne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -cne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev.') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  Say 'DATABASE_URL hop le: user=siscom_app host=127.0.0.1 port=5432 database=siscom_crm_dev. Mat khau lay tu .env, khong in.'
  $val = $null; $line = $null; $ui = $null; $u = $null
  return $pw
}
function Psql([string[]]$a, [string]$sql) {
  $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($sql) { $out = $sql | & $script:psql -X -w -h 127.0.0.1 -p 5432 -U siscom_app -d $Db @a 2>&1 }
    else { $out = & $script:psql -X -w -h 127.0.0.1 -p 5432 -U siscom_app -d $Db @a 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  return [pscustomobject]@{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n") }
}
function Scalar([string]$sql) {
  $r = Psql @('-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-') $sql
  if ($r.Code -ne 0) { Fail ('psql bao loi: ' + $r.Out) }
  return $r.Out.Trim()
}
function Prisma([string[]]$a, [bool]$scratchUrl) {
  Push-Location $root
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($scratchUrl) { $env:DATABASE_URL = 'postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $Db }
    $out = & npx.cmd prisma @a 2>&1; $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Pop-Location; if ($scratchUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } }
  return [pscustomobject]@{ Code = $code; Out = (($out | ForEach-Object { $_.ToString() }) -join "`n") }
}
$tblList = @('lookup_item', 'department', 'employee', 'role', 'permission', 'role_permission', 'employee_role', 'customer', 'contact', 'activity', 'customer_assignment', 'audit_log')
$names = ($tblList | ForEach-Object { "('" + $_ + "')" }) -join ','
$allowedTables = (($tblList + @('app_meta', '_prisma_migrations')) | ForEach-Object { "'" + $_ + "'" }) -join ','
$rowSum = ($tblList | ForEach-Object { '(SELECT count(*) FROM public."' + $_ + '")' }) -join ' + '
function Verify-Counts {
  $q = @"
WITH t(n) AS (VALUES $names)
SELECT
 (SELECT count(*) FROM pg_class c JOIN t ON t.n = c.relname WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace) || '|' ||
 (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN t ON t.n = c.relname WHERE k.contype = 'f' AND c.relnamespace = 'public'::regnamespace) || '|' ||
 (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN t ON t.n = c.relname WHERE k.contype = 'c' AND c.relnamespace = 'public'::regnamespace) || '|' ||
 (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN t ON t.n = c.relname WHERE NOT i.indisprimary AND c.relnamespace = 'public'::regnamespace) || '|' ||
 (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN t ON t.n = c.relname WHERE NOT g.tgisinternal AND c.relnamespace = 'public'::regnamespace) || '|' ||
 (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'fn\_%' OR proname = 'f_vn_fold')) || '|' ||
 (SELECT count(*) FROM pg_class WHERE relkind = 'S' AND relname LIKE '%\_code\_seq') || '|' ||
 (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')) || '|' ||
 coalesce((SELECT value FROM app_meta WHERE key = 'schema_baseline'), '(none)');
"@
  $v = (Scalar $q).Split('|')
  $want = @('12', '33', '27', '44', '15', '15', '4', '2', 'b1.1'); $lab = @('bang moi', 'khoa ngoai', 'CHECK', 'index (khong tinh PK)', 'trigger', 'ham', 'sequence ma', 'extension', 'app_meta.schema_baseline (phai GIU b1.1)')
  $all = $true
  for ($i = 0; $i -lt $want.Count; $i++) { if ($v[$i] -eq $want[$i]) { Ok ($lab[$i] + ' = ' + $v[$i]) } else { Bad ($lab[$i] + ' = ' + $v[$i] + ', ky vong ' + $want[$i]); $all = $false } }
  return $all
}
function Assert-Clean([string]$when, [bool]$rows) {
  $q = @"
SELECT
 (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND c.relname NOT IN ($allowedTables)) || '|' ||
 (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg\_toast%' AND nspname NOT LIKE 'pg\_temp%') || '|' ||
 (SELECT count(*) FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace AND relname NOT LIKE '%\_code\_seq' AND relname <> 'audit_log_id_seq') || '|' ||
 (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND NOT (p.proname LIKE 'fn\_%' OR p.proname = 'f_vn_fold') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')) || '|' ||
 ($rowSum);
"@
  $v = (Scalar $q).Split('|')
  $lab = @('bang la trong public', 'schema la', 'sequence la', 'ham la', 'dong du lieu trong 12 bang nghiep vu')
  $n = if ($rows) { 5 } else { 4 }; $clean = $true
  for ($i = 0; $i -lt $n; $i++) { if ($v[$i] -ne '0') { Bad ('Sach? (' + $when + ') ' + $lab[$i] + ' = ' + $v[$i] + ' (ky vong 0)'); $clean = $false } }
  if ($clean) { Ok ('Sach (' + $when + '): khong co doi tuong la' + $(if ($rows) { ', 12 bang nghiep vu rong' } else { '' }) + '.') }
  return $clean
}
function Backend-Running { try { $c = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction Stop; return [bool]$c } catch { return $false } }
$HistPre = '20261011000000_init,true,true'
function Stream-Hash($fs) {
  $fs.Position = 0
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '') } finally { $sha.Dispose() }
}
function Check-Status([string]$mode) {
  $stt = Prisma @('migrate', 'status') ($Target -eq 'scratch')
  Add-Content -LiteralPath $script:log -Value $stt.Out -Encoding UTF8
  Say ('prisma migrate status ma thoat = ' + $stt.Code)
  $tail = (($stt.Out -split "`n" | Select-Object -Last 12) -join "`n")
  if ($stt.Out -match '(?i)\berror\b|P10\d\d|P30\d\d|can''t reach|cannot|unable|failed|diverge|drift|not found|does not exist|permission denied|authentication') { Fail ('prisma migrate status co dau hieu LOI ("' + $Matches[0] + '"), khong chi la migration cho ap dung. DUNG, gui log. Dau ra:' + "`n" + $tail) }
  if ($mode -eq 'pending') {
    if ($stt.Code -ne 1) { Fail ('Truoc deploy ky vong ma thoat 1 (co migration cho ap dung), nhan ' + $stt.Code + '. Dau ra:' + "`n" + $tail) }
    $m = [regex]::Match($stt.Out, '(?is)(?:have|has) not yet been applied:?\s*(.*?)(?:\r?\n\s*\r?\n|To apply|$)')
    if (-not $m.Success) { Fail ('Khong doc duoc danh sach migration cho ap dung. Dau ra:' + "`n" + $tail) }
    $list = @($m.Groups[1].Value -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($list.Count -ne 1 -or $list[0] -ne $MigrationName) { Fail ('Danh sach cho ap dung phai la dung [' + $MigrationName + '] ; thuc te: [' + ($list -join ', ') + ']') }
    Ok 'prisma migrate status: ma thoat 1, KHONG co loi, dung 1 migration cho ap dung = migration moi.'
  } else {
    if ($stt.Code -ne 0 -or $stt.Out -notmatch '(?i)up to date') { Fail ('prisma migrate status khong bao up to date (ma ' + $stt.Code + '). Dau ra:' + "`n" + $tail) }
    Ok 'prisma migrate status: ma thoat 0, Database schema is up to date.'
  }
}
function Check-Backup {
  $dump = Get-ChildItem -LiteralPath $BackupDir -Filter '*.dump' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $dump) { Fail ('Khong co file .dump trong ' + $BackupDir) }
  $age = [int]((Get-Date) - $dump.LastWriteTime).TotalMinutes
  if ($dump.Name -notmatch '^siscom_crm_dev_') { Fail ('Ban sao luu moi nhat khong phai cua siscom_crm_dev: ' + $dump.Name) }
  if ($age -gt $MaxBackupAgeMinutes) { Fail ('Ban sao luu moi nhat (' + $dump.Name + ') cu ' + $age + ' phut > ' + $MaxBackupAgeMinutes + '. Chay backup-db.bat roi restore-test.bat ngay truoc khi deploy.') }
  $shaF = $dump.FullName + '.sha256'
  if (-not (Test-Path -LiteralPath $shaF)) { Fail 'Thieu file .sha256 cua ban sao luu.' }
  $have = Short-Hash $dump.FullName
  if (((Get-Content -LiteralPath $shaF -TotalCount 1) -split '\s+')[0] -ne $have) { Fail 'SHA-256 ban sao luu khong khop file .sha256. KHONG deploy.' }
  # Dau vet restore-test THANH CONG cua dung ban sao luu nay (do restore-test.ps1 ban moi ghi)
  $mk = $dump.FullName + '.restore-ok.txt'
  if (-not (Test-Path -LiteralPath $mk)) { Fail ('Ban sao luu ' + $dump.Name + ' CHUA co dau vet restore-test thanh cong (' + $dump.Name + '.restore-ok.txt). Chay restore-test.bat (ban da cap nhat) roi thu lai.') }
  # Doc dau vet: tach tung truong key=value (chap nhan ca dinh dang nhieu dong lan mot dong), moi truong dung 1 lan, khong lay ca dong.
  $txt = [string]::Join(' ', @(Get-Content -LiteralPath $mk))
  $kv = @{}
  foreach ($m in [regex]::Matches($txt, '(?<![A-Za-z0-9_])(sha256|dump|restored_db|schema_baseline|tables|at)=(\S+)')) {
    $k = $m.Groups[1].Value
    if ($kv.ContainsKey($k)) { Fail ('Dau vet restore-test: truong "' + $k + '" xuat hien nhieu lan.') }
    $kv[$k] = $m.Groups[2].Value
  }
  foreach ($k in @('sha256', 'dump', 'restored_db', 'schema_baseline', 'tables', 'at')) { if (-not $kv.ContainsKey($k)) { Fail ('Dau vet restore-test thieu truong "' + $k + '".') } }
  if ($kv['sha256'] -notmatch '^[0-9A-Fa-f]{64}$') { Fail 'Truong sha256 trong dau vet khong phai dung 64 ky tu hex.' }
  if ($kv['sha256'] -ne $have) { Fail 'Dau vet restore-test ung voi MOT file sao luu KHAC (SHA-256 64 ky tu khong khop).' }
  if ($kv['dump'] -ne $dump.Name) { Fail ('Dau vet ghi ten sao luu "' + $kv['dump'] + '", khac file moi nhat "' + $dump.Name + '".') }
  $rm = [regex]::Match($kv['restored_db'], '^siscom_crm_restore_([0-9]{8}_[0-9]{6})\z')
  if (-not $rm.Success) { Fail 'Truong restored_db khong dung mau siscom_crm_restore_YYYYMMDD_HHMMSS (khong chap nhan siscom_crm_dev).' }
  $dm = [regex]::Match($dump.Name, '^siscom_crm_dev_([0-9]{8}_[0-9]{6})\.dump\z')
  if (-not $dm.Success) { Fail 'Ten file sao luu khong dung mau siscom_crm_dev_YYYYMMDD_HHMMSS.dump.' }
  if ([string]::CompareOrdinal($rm.Groups[1].Value, $dm.Groups[1].Value) -lt 0) { Fail 'Database khoi phuc duoc tao TRUOC thoi diem sao luu - khong the la ban khoi phuc cua file nay.' }
  if ($kv['schema_baseline'] -ne 'b1.1') { Fail ('Restore-test cho schema_baseline = ' + $kv['schema_baseline'] + ', can b1.1.') }
  $nt = 0; if (-not [int]::TryParse($kv['tables'], [ref]$nt) -or $nt -lt 1) { Fail 'Dau vet restore-test: so bang khong hop le.' }
  $at = [datetime]::MinValue
  if (-not [datetime]::TryParse($kv['at'], [ref]$at)) { Fail 'Dau vet restore-test: khong doc duoc thoi gian (at).' }
  if ($at -lt $dump.LastWriteTime) { Fail 'Dau vet restore-test cu hon ban sao luu.' }
  if ($at -gt (Get-Date).AddMinutes(5)) { Fail 'Dau vet restore-test co thoi gian o tuong lai.' }
  $exist = Scalar ("SELECT count(*) FROM pg_database WHERE datname = '" + $kv['restored_db'] + "';")
  if ($exist -ne '1') { Say ('Luu y: database khoi phuc ' + $kv['restored_db'] + ' khong con (co the ban da xoa); dau vet van hop le.') 'Yellow' }
  Ok ('Ban sao luu hop le: ' + $dump.Name + ' (' + $age + ' phut truoc, SHA-256 khop) VA da restore-test THANH CONG (DB thu ' + $kv['restored_db'] + ', baseline ' + $kv['schema_baseline'] + ', ' + $nt + ' bang).')
}
function Run-Preflight([bool]$forDeploy) {
  # --- file: migration chinh thuc phai GIONG HET ban da dien tap (so SHA-256) ---
  $migFile = Join-Path $root ('prisma\migrations\' + $MigrationName + '\migration.sql')
  $rehFile = Join-Path $Dir 'migration_rehearsal.sql'
  $stFile = Join-Path $Dir ('rehearsal_state_' + $RehearsedDb + '.json')
  foreach ($f in @($migFile, $rehFile, $stFile)) { if (-not (Test-Path -LiteralPath $f)) { Fail ('Khong thay: ' + $f) } }
  $stR = Get-Content -LiteralPath $stFile -Raw | ConvertFrom-Json
  if ($stR.apply -ne $true -or -not $stR.hashMig) { Fail 'Ban ghi dien tap (rehearsal_state) khong co apply DAT/hashMig. Khong dung ban dien tap nay.' }
  $hR = Short-Hash $rehFile; $hO = $(if ($script:lockedHash) { $script:lockedHash } else { Short-Hash $migFile })
  if ($hR -ne $stR.hashMig) { Fail 'migration_rehearsal.sql da bi thay doi sau khi dien tap (SHA-256 khac ban ghi). DUNG.' }
  if ($hO -ne $hR) { Fail 'migration.sql chinh thuc KHAC ban da dien tap (SHA-256 khac). DUNG, khong deploy.' }
  $script:expectedHash = $hR
  Ok ('SHA-256 migration chinh thuc = ban dien tap = ban ghi dien tap: ' + $hO)
  $items = (Get-ChildItem -LiteralPath (Join-Path $root 'prisma\migrations') | ForEach-Object { $_.Name } | Sort-Object) -join ','
  $expItems = (@('20261011000000_init', $MigrationName, 'migration_lock.toml') | Sort-Object) -join ','
  if ($items -ne $expItems) { Fail ('prisma\migrations phai gom dung: ' + $expItems + ' ; hien co: ' + $items) }
  $inner = (Get-ChildItem -LiteralPath (Join-Path $root ('prisma\migrations\' + $MigrationName)) | ForEach-Object { $_.Name }) -join ','
  if ($inner -ne 'migration.sql') { Fail ('Thu muc migration moi chi duoc chua migration.sql ; hien co: ' + $inner) }
  Ok 'prisma\migrations gom dung: init + migration moi + migration_lock.toml.'
  # --- database ---
  $info = (Scalar "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || current_setting('server_version') || '|' || current_setting('server_encoding') || '|' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -cne $Db) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $Db + '".') }
  if ($info[1] -cne 'siscom_app' -or $info[2] -cne 'siscom_app') { Fail 'Tai khoan hoac chu so huu database khong phai siscom_app.' }
  if ($info[4] -ne 'UTF8') { Fail ('Ma hoa ' + $info[4] + ', can UTF8.') }
  if ([int]$info[5] -lt 180000) { Fail ('PostgreSQL ' + $info[3] + ' < 18. DUNG.') }
  Ok ('Ket noi dung: db=' + $info[0] + ', user=' + $info[1] + ', chu so huu=' + $info[2] + ', PostgreSQL ' + $info[3] + ', ' + $info[4])
  $base = Scalar "SELECT coalesce((SELECT value FROM app_meta WHERE key = 'schema_baseline'), '(none)');"
  if ($base -ne 'b1.1') { Fail ('schema_baseline = ' + $base + ', can b1.1 truoc khi deploy.') }
  $perm = Scalar "SELECT has_database_privilege(current_user, current_database(), 'CREATE')::text || '|' || has_schema_privilege(current_user, 'public', 'CREATE')::text || '|' || (SELECT count(*) FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent'))::text;"
  if ($perm -ne 'true|true|2') { Fail ('Quyen/extension chua du: ' + $perm + ' (ky vong true|true|2).') }
  Ok 'schema_baseline = b1.1; siscom_app co quyen CREATE; pg_trgm + unaccent co san.'
  if ($forDeploy) {
    $left = Scalar "SELECT (to_regclass('public.customer') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE '%\_code\_seq') OR to_regprocedure('public.f_vn_fold(text)') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')))::text;"
    if ($left -ne 'false') { Fail 'Database da co doi tuong B1.2 (bang/sequence/ham/extension). KHONG deploy len database nay.' }
    Ok 'Chua co doi tuong B1.2 nao.'
  }
  $hist = Scalar "SELECT coalesce(string_agg(migration_name || ',' || (finished_at IS NOT NULL)::text || ',' || (rolled_back_at IS NULL)::text, ';' ORDER BY started_at), '(trong)') FROM public._prisma_migrations;"
  if ($forDeploy -and $hist -ne $HistPre) { Fail ('Lich su _prisma_migrations khong nhu ky vong. Co: ' + $hist + ' ; ky vong: ' + $HistPre) }
  Ok ('Lich su _prisma_migrations truoc deploy: ' + $hist)
  $init = Join-Path $root 'prisma\migrations\20261011000000_init\migration.sql'
  $ck = Scalar "SELECT coalesce((SELECT checksum FROM public._prisma_migrations WHERE migration_name = '20261011000000_init'), '');"
  if ($ck -and ($ck -ne (Short-Hash $init))) { Say 'Luu y: checksum init trong DB khac SHA-256 file init cuc bo (co the do dinh dang checksum cua Prisma khac du doan, hoac file init da bi sua). Ghi nhan, gui cho toi.' 'Yellow' }
  if ($Target -eq 'dev' -and -not [string]::IsNullOrEmpty($env:DATABASE_URL)) { Fail 'Bien moi truong DATABASE_URL dang duoc dat trong phien nay (co the tro database khac). Mo cua so cmd MOI.' }
  Check-Status 'pending'
  if ($Target -eq 'dev') {
    if (Backend-Running) { Fail 'Backend dang lang nghe cong 3000. Dung backend truoc.' }
    Check-Backup
    Ok 'Backend khong chay; bien DATABASE_URL khong bi dat trong phien nay.'
  }
}
try {
  if (-not (Test-Path -LiteralPath $Dir)) { Fail ('Khong thay thu muc ' + $Dir) }
  $script:log = Join-Path $Dir ('release_' + $Target + '_' + $Step + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('B1.2.2 release target=' + $Target + ' step=' + $Step + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  if ($Target -eq 'dev') { if ($DatabaseName) { Fail 'Voi -Target dev khong duoc truyen -DatabaseName.' }; $Db = 'siscom_crm_dev' }
  else {
    if ($DatabaseName -cnotmatch '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z') { Fail 'Voi -Target scratch, -DatabaseName phai la siscom_crm_restore_YYYYMMDD_HHMMSS.' }
    $Db = $DatabaseName
    if ($Step -eq 'deploy' -and $Db -ceq $RehearsedDb) { Fail 'Dien tap deploy phai dung database THU MOI (chay restore-test.bat lai), khong dung database da dien tap psql.' }
  }
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  Say ('Muc tieu: ' + $Target + ' | Database: ' + $Db + ' | Buoc: ' + $Step + $(if ($Step -eq 'deploy') { ' (GHI)' } else { ' (chi doc)' }))
  $c = Read-Host 'Go lai CHINH XAC ten database de xac nhan'
  if ($c -cne $Db) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')

  switch ($Step) {
    'preflight' { Run-Preflight $true; if (-not $script:fail) { Ok 'PREFLIGHT DAT. Chua ghi gi vao database.' } }
    'deploy' {
      $migFile = Join-Path $root ('prisma\migrations\' + $MigrationName + '\migration.sql')
      if (-not (Test-Path -LiteralPath $migFile)) { Fail ('Khong thay ' + $migFile) }
      $fs = New-Object System.IO.FileStream -ArgumentList $migFile, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read), ([System.IO.FileShare]::Read)
      try {
        $script:lockedHash = Stream-Hash $fs
        Say ('Da KHOA migration.sql (chi cho doc, khong ai sua/xoa/doi ten duoc) tu luc kiem tra den khi deploy xong. SHA-256 = ' + $script:lockedHash)
        Run-Preflight $true
        if ($Target -eq 'dev') {
          Write-Host ''; Write-Host 'SAP AP DUNG MIGRATION THAT LEN siscom_crm_dev. Day la thay doi co ban sao luu nhung KHONG hoan tac bang nut bam.' -ForegroundColor Yellow
          $p = Read-Host 'Neu ban DA PHE DUYET, go CHINH XAC: TOI PHE DUYET MIGRATION B1.2.2 TREN siscom_crm_dev'
          if ($p -cne 'TOI PHE DUYET MIGRATION B1.2.2 TREN siscom_crm_dev') { Fail 'Cau xac nhan khong khop. KHONG deploy.' }
        }
        # Kiem tra lai NGAY TRUOC deploy (sau khi cho nguoi dung xac nhan)
        if ((Stream-Hash $fs) -ne $script:lockedHash -or $script:lockedHash -ne $script:expectedHash) { Fail 'SHA-256 migration.sql doi/khac ban dien tap ngay truoc deploy. KHONG deploy.' }
        Check-Status 'pending'
        if ($Target -eq 'dev') { Check-Backup; if (Backend-Running) { Fail 'Backend dang chay.' } }
        Ok 'Kiem tra lan cuoi truoc deploy: SHA-256 dung, status dung, (dev) sao luu + restore-test con hieu luc.'
        $r = Prisma @('migrate', 'deploy') ($Target -eq 'scratch')
        Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
        Say ('prisma migrate deploy ma thoat = ' + $r.Code)
        if ((Stream-Hash $fs) -ne $script:lockedHash) { Bad 'migration.sql CO THAY DOI trong luc deploy (khong the xay ra neu khoa dung).' } else { Ok 'Noi dung migration.sql khong doi tu luc kiem tra den khi deploy xong.' }
        if ($r.Code -ne 0) {
          Bad 'prisma migrate deploy THAT BAI. KHONG chay lai. 15 dong cuoi:'; Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n")
          Say 'Xem muc Khoi phuc trong B1.2.2_DEPLOY_PLAN.md; gui toi file log truoc khi lam gi them.' 'Yellow'
        } else { Ok 'prisma migrate deploy thanh cong.'; $script:doPost = $true }
      } finally { $fs.Dispose() }
    }
    'verify' { $script:doPost = $true }
  }
  if ($script:doPost) {
    $good = Verify-Counts
    $clean = Assert-Clean 'sau deploy' ($Step -eq 'deploy')
    $hist = Scalar "SELECT coalesce(string_agg(migration_name || ',' || (finished_at IS NOT NULL)::text || ',' || (rolled_back_at IS NULL)::text, ';' ORDER BY started_at), '(trong)') FROM public._prisma_migrations;"
    if ($hist -eq ($HistPre + ';' + $MigrationName + ',true,true')) { Ok ('Lich su _prisma_migrations dung: ' + $hist) } else { Bad ('Lich su _prisma_migrations khong nhu ky vong: ' + $hist); $good = $false }
    $steps = Scalar ("SELECT coalesce((SELECT applied_steps_count::text FROM public._prisma_migrations WHERE migration_name = '" + $MigrationName + "'), '?');")
    Say ('applied_steps_count cua migration moi = ' + $steps)
    $ckDb = Scalar ("SELECT coalesce((SELECT checksum FROM public._prisma_migrations WHERE migration_name = '" + $MigrationName + "'), '');")
    $ckFile = Short-Hash (Join-Path $root ('prisma\migrations\' + $MigrationName + '\migration.sql'))
    if ($ckDb -eq $ckFile) { Ok 'checksum trong _prisma_migrations = SHA-256 file migration.sql.' } else { Say ('Luu y: checksum Prisma ghi (' + $ckDb.Substring(0, [Math]::Min(12, $ckDb.Length)) + '...) khac SHA-256 file (' + $ckFile.Substring(0, 12) + '...). Co the do dinh dang checksum khac du doan; ghi nhan, gui cho toi.') 'Yellow' }
    try { Check-Status 'uptodate' } catch { Bad $_.Exception.Message; $good = $false }
    if ($Target -eq 'scratch' -and $Step -eq 'deploy' -and $good -and $clean -and -not $script:fail) {
      $sf = Join-Path $Dir ('rehearsal_state_' + $Db + '.json')
      (@{ guard = $true; apply = $true; viaPrismaDeploy = $true; hashMig = (Short-Hash (Join-Path $Dir 'migration_rehearsal.sql')) } | ConvertTo-Json) | Set-Content -LiteralPath $sf -Encoding ASCII
      Say 'Da ghi rehearsal_state cho database thu nay de chay tiep rehearse-b122 -Step verify/tests/probe/drift.' 'Yellow'
    }
    if ($Target -eq 'dev') { Say 'KHONG chay rehearse-b122 (tests/probe) tren siscom_crm_dev: chung se lam tang sequence ma.' 'Yellow' }
  }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; if ($Target -eq 'scratch') { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Dung lai va gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: buoc nay DAT.' -ForegroundColor Green }
