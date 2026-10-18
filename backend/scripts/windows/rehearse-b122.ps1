# SISCOM CRM B1.2.2 - DIEN TAP migration tren DATABASE THU (siscom_crm_restore_<ngay>_<gio>). TUYET DOI khong dung siscom_crm_dev. (rev.2)
# Dich: D:\SISCOM-CRM\backend\scripts\windows\rehearse-b122.ps1  (chep de ban rev.1 - day la FILE DUY NHAT can thay)
# Moi lan chay MOT buoc (-Step). Tom tat doc/ghi:
#   guard  : DOC database thu (SELECT/SHOW). Chi doc 2 file SQL + ghi log/state vao thu muc backups\b122. KHONG ghi database.
#   verify : DOC database thu.
#   drift  : DOC database thu (prisma chi soi cau truc). Ghi 1 file .sql vao backups\b122.
#   fail   : GHI database thu trong 1 giao dich co y bi loi => ky vong rollback het, KHONG con gi.
#   apply  : GHI database thu: tao toan bo doi tuong B1.2 (chi 1 lan tren 1 DB moi).
#   tests  : GHI TAM database thu trong giao dich tu ROLLBACK (khong de lai dong/bang nao; chi gia tri sequence ma bi tang).
#   probe  : GHI database thu duy nhat dieu nay: tang customer_code_seq (20 ket noi x 50 ma). KHONG tao bang/doi tuong nao.
# Mat khau siscom_app doc tu DATABASE_URL trong backend\.env (chi doc, khong sua); DICH luon la -DatabaseName, KHONG BAO GIO la database trong DATABASE_URL.
# Khong co DROP/DELETE/TRUNCATE trong script nay. Khong ghi mat khau ra man hinh/log. Khong dung toi siscom_crm_dev, .env, frontend.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [ValidateSet('guard', 'fail', 'apply', 'verify', 'tests', 'probe', 'drift')][string]$Step = 'guard',
  [string]$Dir = 'D:\SISCOM-CRM\backups\b122'
)
$Db = $DatabaseName
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
function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Get-AppPasswordFromEnv([string]$envPath) {
  # Chi DOC .env (khong sua). Dung DATABASE_URL de lay mat khau siscom_app; kiem tra user/host/port/database nguon truoc khi dung. Khong in mat khau/URL.
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
  if ($user -ne 'siscom_app') { Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -ne '127.0.0.1') { Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -ne 'siscom_crm_dev') { Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev (nguon).') }
  if (-not $pw) { Fail 'DATABASE_URL khong co mat khau.' }
  Say ('DATABASE_URL hop le: user=siscom_app host=127.0.0.1 port=5432 database_nguon=siscom_crm_dev (chi de doi chieu, KHONG dung lam dich). Mat khau lay tu .env, khong in.')
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
function Count-Re([string]$text, [string]$re) { return ([regex]::Matches($text, $re)).Count }
function Short-Hash([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }

# ---- Phan tich tu vung SQL: bo comment, chuoi '...', "...", va doan $tag$...$tag$ ----
$script:lex = [regex]'--[^\r\n]*|/\*[\s\S]*?\*/|''(?:[^'']|'''')*''|"(?:[^"]|"")*"|(?<d>\$(?<tag>[A-Za-z_][A-Za-z0-9_]*)?\$)[\s\S]*?\k<d>'
function Strip-Sql([string]$t) { return $script:lex.Replace($t, ' ') }
function Dollar-Bodies([string]$t) {
  $res = @()
  foreach ($m in $script:lex.Matches($t)) { if ($m.Value.StartsWith('$')) { $d = $m.Groups['d'].Value; $res += $m.Value.Substring($d.Length, $m.Value.Length - 2 * $d.Length) } }
  return $res
}
$script:badWords = '(?i)\b(COPY|DROP|GRANT|COMMIT|dblink|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|pg_terminate_backend|pg_cancel_backend)\b|ALTER\s+(ROLE|USER|DATABASE|SYSTEM)|CREATE\s+(ROLE|USER|DATABASE|SCHEMA|TABLESPACE)|SET\s+(SESSION|ROLE|LOCAL\s+ROLE)|TRUNCATE\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET'
$tblList = @('lookup_item', 'department', 'employee', 'role', 'permission', 'role_permission', 'employee_role', 'customer', 'contact', 'activity', 'customer_assignment', 'audit_log')
$names = ($tblList | ForEach-Object { "('" + $_ + "')" }) -join ','
$allowedTables = (($tblList + @('app_meta', '_prisma_migrations')) | ForEach-Object { "'" + $_ + "'" }) -join ','
$rowSum = ($tblList | ForEach-Object { '(SELECT count(*) FROM public."' + $_ + '")' }) -join ' + '

function Preflight-File([string]$path, [bool]$isFailVariant) {
  if (-not (Test-Path -LiteralPath $path)) { Fail ('Khong thay file: ' + $path) }
  $t = [System.IO.File]::ReadAllText($path)
  Say ('Kiem tra file ghep: ' + $path + ' (' + (Get-Item -LiteralPath $path).Length + ' byte)')
  $exp = [ordered]@{
    'CREATE TYPE' = @('(?m)^CREATE TYPE "', 5); 'CREATE TABLE' = @('(?m)^CREATE TABLE "', 12); 'CREATE EXTENSION' = @('(?m)^CREATE EXTENSION', 2)
    'CREATE SEQUENCE' = @('(?m)^CREATE SEQUENCE', 4); 'CREATE OR REPLACE FUNCTION' = @('(?m)^CREATE OR REPLACE FUNCTION', 15)
    'FOREIGN KEY' = @('(?m)ADD CONSTRAINT "[a-z_]+" FOREIGN KEY', 33); 'CHECK (ck_)' = @('(?m)ADD CONSTRAINT ck_', 27)
    'INDEX (thuong+unique)' = @('(?m)^CREATE (UNIQUE )?INDEX', 44); 'CREATE TRIGGER' = @('(?m)^CREATE TRIGGER', 15); 'DO block' = @('(?m)^DO \$\$', 1)
  }
  foreach ($k in $exp.Keys) { $n = Count-Re $t $exp[$k][0]; if ($n -ne $exp[$k][1]) { Fail ('File ghep: ' + $k + ' = ' + $n + ', ky vong ' + $exp[$k][1] + '. DUNG, khong thuc thi.') } }
  if ($t -match 'app_meta') { Fail 'File ghep nhac toi app_meta. DUNG.' }
  # 1) Khong co ky tu backslash ngoai chuoi/comment/dollar-quote  => khong co meta-command psql (\c, \!, \i, \copy, \gexec...)
  $top = Strip-Sql $t
  if ($top.Contains('\')) { Fail 'File ghep co dau \ ngoai chuoi/comment: co the la lenh meta cua psql (\c, \!, \i, \copy...). DUNG.' }
  # 2) Danh sach trang: moi cau lenh cap cao nhat chi duoc la CREATE/ALTER TABLE/COMMENT ON/DO (va SELECT 1/0 o ban co y loi)
  $stm = @(($top -split ';') | ForEach-Object { ($_ -replace '\s+', ' ').Trim() } | Where-Object { $_ })
  $okRe = '(?i)^(CREATE (OR REPLACE )?(FUNCTION|TRIGGER|TYPE|TABLE|UNIQUE INDEX|INDEX|SEQUENCE|EXTENSION)\b|ALTER TABLE\b|COMMENT ON\b|DO$)'
  $hist = @{}
  foreach ($s in $stm) {
    if ($isFailVariant -and $s -match '(?i)^SELECT 1/0$') { $hist['SELECT 1/0 (co y loi)'] = 1; continue }
    if ($s -notmatch $okRe) { Fail ('Cau lenh ngoai danh sach cho phep: "' + $s.Substring(0, [Math]::Min(80, $s.Length)) + '". DUNG.') }
    $key = ($s -split ' ')[0..1] -join ' '; if ($hist.ContainsKey($key)) { $hist[$key]++ } else { $hist[$key] = 1 }
  }
  foreach ($m in [regex]::Matches($t, '(?m)^ALTER TABLE "?(\w+)"?')) { if ($tblList -notcontains $m.Groups[1].Value) { Fail ('ALTER TABLE tren bang ngoai pham vi: ' + $m.Groups[1].Value) } }
  # 3) Noi dung cac than ham/DO (dollar-quote) khong co tu khoa nguy hiem
  foreach ($b in (Dollar-Bodies $t)) { if ($b -match $script:badWords) { Fail ('Than ham/DO chua tu khoa cam: "' + $Matches[0] + '". DUNG.') } }
  if ($isFailVariant) { if ($t.TrimEnd() -notmatch 'SELECT 1/0;$') { Fail 'Ban co y loi phai ket thuc bang SELECT 1/0;' } }
  elseif ($t -match 'SELECT 1/0') { Fail 'File migration_rehearsal.sql khong duoc chua SELECT 1/0 (nham file?).' }
  $iFn = $t.IndexOf('CREATE OR REPLACE FUNCTION public.fn_next_activity_code'); $iTb = $t.IndexOf('CREATE TABLE "lookup_item"'); $iTr = $t.IndexOf('CREATE TRIGGER')
  if (-not ($iFn -ge 0 -and $iFn -lt $iTb -and $iTb -lt $iTr)) { Fail 'Thu tu sai: phai la ham sinh ma -> CREATE TABLE -> trigger. DUNG.' }
  Say ('  Thong ke lenh cap cao nhat: ' + (($hist.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Name + ' x' + $_.Value }) -join '; '))
  Ok 'File ghep dat: dem doi tuong dung, khong backslash/meta-command, chi lenh trong danh sach cho phep, than ham sach, thu tu dung. (Day la rao chan thuc dung, KHONG phai bao dam tuyet doi - van can ban doc lai file.)'
}
function Check-TestsFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { Fail ('Khong thay file: ' + $path) }
  $raw = [System.IO.File]::ReadAllText($path)
  $x = [regex]::Replace($raw, '(?m)^\\(set ON_ERROR_STOP (on|off)|pset pager off)[ \t]*\r?$', '')
  if ((Strip-Sql $x).Contains('\')) { Fail 'File kiem thu co meta-command psql ngoai (\set ON_ERROR_STOP, \pset pager off). DUNG.' }
  if ($raw -match '(?i)\b(COMMIT|COPY|GRANT|dblink|pg_read_file|pg_read_binary_file|lo_import|lo_export|pg_terminate_backend)\b|ALTER\s+(ROLE|USER|DATABASE|SYSTEM)|CREATE\s+(ROLE|USER|DATABASE|SCHEMA)|SET\s+(SESSION|ROLE)|DROP\s+(DATABASE|ROLE|TABLE|SCHEMA)') { Fail ('File kiem thu chua tu khoa cam: "' + $Matches[0] + '". DUNG.') }
  if ((Count-Re $raw '(?m)^BEGIN;') -ne 1 -or (Count-Re $raw '(?m)^ROLLBACK;') -ne 1 -or $raw.TrimEnd() -notmatch 'ROLLBACK;$') { Fail 'File kiem thu phai co dung 1 BEGIN; va ket thuc bang ROLLBACK; (khong COMMIT). DUNG.' }
  $n = Count-Re $raw '(?m)^SELECT pg_temp\.expect_'
  if ($n -lt 40) { Fail ('So ca kiem thu doc duoc qua it (' + $n + ').') }
  Ok ('File kiem thu dat: 1 BEGIN / 1 ROLLBACK cuoi, khong COMMIT, chi 2 meta-command cho phep, ' + $n + ' ca.')
  return [pscustomobject]@{ Raw = $raw; Count = $n }
}
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
function Assert-Clean([string]$when) {
  # Doi tuong NGHIEP VU = 12 bang B1.2 (+ app_meta, _prisma_migrations co san). Moi thu khac trong public, schema la, sequence la, ham la, hoac DONG DU LIEU = du kiem thu con sot.
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
  $clean = $true
  for ($i = 0; $i -lt 5; $i++) { if ($v[$i] -ne '0') { Bad ('Sach? (' + $when + ') ' + $lab[$i] + ' = ' + $v[$i] + ' (ky vong 0)'); $clean = $false } }
  if ($clean) { Ok ('Sach (' + $when + '): khong con bang/schema/sequence/ham kiem thu, 12 bang nghiep vu rong.') }
  return $clean
}
$stateFile = Join-Path $Dir ('rehearsal_state_' + $Db + '.json')
function Get-State { if (Test-Path -LiteralPath $stateFile) { return (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json) } else { return $null } }
function Save-State([string]$key, $val) {
  $s = @{}; $o = Get-State
  if ($o) { foreach ($p in $o.PSObject.Properties) { $s[$p.Name] = $p.Value } }
  $s[$key] = $val
  ($s | ConvertTo-Json) | Set-Content -LiteralPath $stateFile -Encoding ASCII
}
try {
  if ($Db -notmatch '^siscom_crm_restore_\d{8}_\d{6}$') { Fail 'Ten database khong dung mau siscom_crm_restore_YYYYMMDD_HHMMSS. Script CHI cho phep database thu do restore-test.bat tao (siscom_crm_dev bi tu choi).' }
  if (-not (Test-Path -LiteralPath $Dir)) { Fail ('Khong thay thu muc ' + $Dir) }
  $script:log = Join-Path $Dir ('rehearsal_' + $Step + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $script:log -Value ('B1.2.2 rehearsal rev2 step=' + $Step + ' db=' + $Db + ' at ' + (Get-Date -Format 'o')) -Encoding UTF8
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:psql = Find-Tool 'psql.exe'; if (-not $script:psql) { Fail 'Khong tim thay psql.exe.' }
  $migF = Join-Path $Dir 'migration_rehearsal.sql'; $failF = Join-Path $Dir 'migration_fail_test.sql'
  Say ('Buoc: ' + $Step + ' | Database thu: ' + $Db)
  $c = Read-Host 'Go lai CHINH XAC ten database thu de xac nhan'
  if ($c -ne $Db) { Fail 'Ten xac nhan khong khop. Dung lai.' }
  $script:pw = Get-AppPasswordFromEnv (Join-Path $root '.env')

  # --- Dieu kien tien quyet: BAT KY cai nao sai => dung ngay (khong chay tiep) ---
  $info = (Scalar "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || current_setting('server_version') || '|' || current_setting('server_encoding') || '|' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();").Split('|')
  if ($info[0] -ne $Db) { Fail ('Dang noi vao "' + $info[0] + '" thay vi "' + $Db + '".') }
  if ($info[1] -ne 'siscom_app' -or $info[2] -ne 'siscom_app') { Fail 'Tai khoan hoac chu so huu database khong phai siscom_app.' }
  if ($info[4] -ne 'UTF8') { Fail ('Ma hoa database la ' + $info[4] + ', can UTF8.') }
  if ([int]$info[5] -lt 180000) { Fail ('PostgreSQL ' + $info[3] + ' < 18. Ke hoach nham muc tieu 18.x; DUNG, khong chay tiep.') }
  Ok ('Ket noi dung: db=' + $info[0] + ', user=' + $info[1] + ', chu so huu=' + $info[2] + ', PostgreSQL ' + $info[3] + ', ma hoa ' + $info[4])
  $hasCustomer = ((Scalar "SELECT (to_regclass('public.customer') IS NOT NULL)::text;") -eq 'true')
  $base = Scalar "SELECT coalesce((SELECT value FROM app_meta WHERE key = 'schema_baseline'), '(none)');"
  Say ('Trang thai: bang customer ' + $(if ($hasCustomer) { 'DA CO' } else { 'chua co' }) + ' | schema_baseline = ' + $base)
  if ($base -ne 'b1.1') { Fail 'schema_baseline khong phai b1.1 - day khong phai ban khoi phuc cua siscom_crm_dev B1.1.' }
  $perm = Scalar "SELECT has_database_privilege(current_user, current_database(), 'CREATE')::text || '|' || has_schema_privilege(current_user, 'public', 'CREATE')::text || '|' || (SELECT count(*) FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent'))::text;"
  if ($perm -ne 'true|true|2') { Fail ('Quyen/extension chua du (CREATE tren DB | CREATE tren schema public | so extension co san) = ' + $perm + ', ky vong true|true|2. Khong tu nang quyen; bao toi.') }
  Ok 'siscom_app co quyen CREATE tren database va schema public; pg_trgm + unaccent co san (contrib).'
  if (-not $hasCustomer) {
    $left = Scalar "SELECT (EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE '%\_code\_seq') OR to_regprocedure('public.f_vn_fold(text)') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')))::text;"
    if ($left -ne 'false') { Fail 'Database chua co bang customer nhung da co sequence/ham/extension cua B1.2 (ap do dang?). Dung database moi.' }
  }
  $st = Get-State
  $needApplied = @('verify', 'tests', 'probe', 'drift')
  if ($needApplied -contains $Step) {
    if (-not $hasCustomer) { Fail 'Chua ap migration vao database nay (chay -Step apply truoc).' }
    if (-not $st -or $st.apply -ne $true) { Fail 'Khong co ban ghi apply DAT cho database nay (rehearsal_state). Dung lai; neu ap bang cach khac, bao toi.' }
  }

  switch ($Step) {
    'guard' {
      Preflight-File $migF $false
      Preflight-File $failF $true
      Save-State 'guard' $true
      Ok 'GUARD DAT: database thu hop le, 2 file SQL dat kiem tra. Chua ghi gi vao database.'
    }
    'fail' {
      if ($hasCustomer) { Fail 'Database nay da co bang B1.2. Buoc "fail" can database MOI (chay restore-test.bat lai).' }
      if (-not $st -or $st.guard -ne $true) { Fail 'Chua co guard DAT cho database nay. Chay -Step guard truoc.' }
      Preflight-File $failF $true; Preflight-File $migF $false
      $r = Psql @('-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', $failF)
      Say ('psql ma thoat = ' + $r.Code)
      $stopOk = ($r.Code -ne 0 -and $r.Out -match 'division by zero')
      if ($stopOk) { Ok 'Migration co y loi bi dung dung cho (division by zero).' }
      else { Bad 'Khong gap loi division by zero nhu ky vong. Day la loi THAT can xem (vi du thieu quyen tao extension):'; Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n") }
      $left = Scalar "SELECT ((to_regclass('public.customer') IS NOT NULL) OR (to_regprocedure('public.f_vn_fold(text)') IS NOT NULL) OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')) OR EXISTS (SELECT 1 FROM pg_class WHERE relname = 'customer_code_seq'))::text;"
      $atomic = ($left -eq 'false')
      if ($atomic) { Ok 'Nguyen tu: sau loi, KHONG con bang/ham/extension/sequence nao cua B1.2 (rollback tron goi).' } else { Bad 'Sau loi van con doi tuong B1.2 - migration KHONG nguyen tu. DUNG, bao toi.' }
      if ($stopOk -and $atomic) { Save-State 'fail' $true; Save-State 'hashMig' (Short-Hash $migF); Save-State 'hashFail' (Short-Hash $failF) }
    }
    'apply' {
      if ($hasCustomer) { Fail 'Database nay da co bang B1.2 (da ap dung roi). Dung database moi neu muon thu lai.' }
      if (-not $st -or $st.guard -ne $true -or $st.fail -ne $true) { Fail 'Chua co guard + fail DAT cho database nay. KHONG ap migration. Chay lan luot -Step guard, -Step fail.' }
      Preflight-File $migF $false
      if ((Short-Hash $migF) -ne $st.hashMig -or (Short-Hash $failF) -ne $st.hashFail) { Fail 'File SQL da thay doi sau buoc fail (hash khac). KHONG ap migration; chay lai guard + fail tren database moi.' }
      $r = Psql @('-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', $migF)
      if ($r.Code -ne 0) { Bad ('Ap migration that bai (ma ' + $r.Code + '). 20 dong cuoi:'); Say (($r.Out -split "`n" | Select-Object -Last 20) -join "`n") }
      else {
        Ok 'Ap migration vao DATABASE THU thanh cong (1 giao dich).'
        $good = Verify-Counts
        $clean = Assert-Clean 'sau apply'
        if ($good -and $clean) { Save-State 'apply' $true } else { Bad 'Co so lieu sai sau apply: KHONG ghi nhan apply DAT; cac buoc sau se bi chan. Gui log cho toi.' }
      }
    }
    'verify' { [void](Verify-Counts); [void](Assert-Clean 'verify') }
    'tests' {
      $tf = Join-Path $root 'docs\B1.2.2_CONSTRAINT_TESTS.sql'
      $tk = Check-TestsFile $tf
      $runF = Join-Path $Dir 'tests_run_tmp.sql'
      [System.IO.File]::WriteAllText($runF, ([regex]::Replace($tk.Raw, '(?m)^\\set ON_ERROR_STOP off', '\set ON_ERROR_STOP on')))
      try { $r = Psql @('-v', 'ON_ERROR_STOP=1', '-f', $runF) } finally { Remove-Item -LiteralPath $runF -ErrorAction SilentlyContinue }
      Add-Content -LiteralPath $script:log -Value $r.Out -Encoding UTF8
      Say ('psql ma thoat = ' + $r.Code)
      if ($r.Code -ne 0) { Bad 'psql thoat khac 0: co loi SQL NGOAI DU KIEN (loi nam ngoai cac khoi expect_*). 15 dong cuoi:'; Say (($r.Out -split "`n" | Select-Object -Last 15) -join "`n") }
      $stray = Count-Re $r.Out '(?m)^(psql:.*)?(ERROR|FATAL|PANIC):'
      if ($stray -gt 0) { Bad ('Dau ra co ' + $stray + ' dong ERROR/FATAL ngoai du kien (cac loi du kien da duoc bat ben trong ca kiem thu).') }
      $pass = 0; $failn = 0
      foreach ($m in [regex]::Matches($r.Out, '(?m)^\s*(PASS|FAIL)\s*\|\s*(\d+)')) { if ($m.Groups[1].Value -eq 'PASS') { $pass = [int]$m.Groups[2].Value } else { $failn = [int]$m.Groups[2].Value } }
      Say ('Tong ket: PASS = ' + $pass + ', FAIL = ' + $failn + ', so ca trong file = ' + $tk.Count)
      if (($pass + $failn) -ne $tk.Count) { Bad 'PASS + FAIL khac so ca trong file: co ca khong chay hoac khong ghi nhan.' }
      if ($failn -gt 0) { Bad 'Co kiem thu FAIL:'; $ix = $r.Out.IndexOf('can_xem_lai'); if ($ix -ge 0) { Say $r.Out.Substring($ix) } }
      if (-not $script:fail) { Ok ('Tat ca ' + $pass + ' kiem thu dat, psql thoat 0, khong co loi ngoai du kien.') }
      [void](Assert-Clean 'sau tests')
    }
    'probe' {
      # 20 tien trinh psql chay SONG SONG, moi cai lay 50 ma; so sanh o phia PowerShell. Khong tao bang/doi tuong nao.
      $procs = @(); $outs = @()
      $env:PGPASSWORD = $script:pw; $env:PGCLIENTENCODING = 'UTF8'
      try {
        for ($i = 1; $i -le 20; $i++) {
          $of = Join-Path $Dir ('probe_' + $i + '.out'); $ef = Join-Path $Dir ('probe_' + $i + '.err'); $outs += , @($of, $ef)
          $procs += Start-Process -FilePath $script:psql -ArgumentList @('-X', '-w', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'siscom_app', '-d', $Db, '-c', '"SELECT public.fn_next_customer_code() FROM generate_series(1,50);"') -RedirectStandardOutput $of -RedirectStandardError $ef -NoNewWindow -PassThru
          $null = $procs[-1].Handle
        }
      } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
      foreach ($p in $procs) { [void]$p.WaitForExit(120000) }
      $codes = @(); $errs = 0; $badExit = 0
      foreach ($p in $procs) { if (-not $p.HasExited -or $p.ExitCode -ne 0) { $badExit++ } }
      foreach ($o in $outs) {
        if (Test-Path -LiteralPath $o[0]) { $codes += @(Get-Content -LiteralPath $o[0] | Where-Object { $_ -match '^\S' }) }
        if ((Test-Path -LiteralPath $o[1]) -and ((Get-Item -LiteralPath $o[1]).Length -gt 0)) { $errs++ }
        Remove-Item -LiteralPath $o[0], $o[1] -ErrorAction SilentlyContinue
      }
      $uniq = @($codes | Select-Object -Unique).Count; $fmt = @($codes | Where-Object { $_ -match '^KH-\d{5,}$' }).Count
      Say ('Tien trinh loi: ' + $badExit + ' | tep loi khac rong: ' + $errs + ' | tong ma = ' + $codes.Count + ' | khac nhau = ' + $uniq + ' | dung dinh dang = ' + $fmt)
      if ($badExit -eq 0 -and $errs -eq 0 -and $codes.Count -eq 1000 -and $uniq -eq 1000 -and $fmt -eq 1000) { Ok '1000 ma sinh dong thoi tu 20 ket noi, khong trung, dung dinh dang. (Chi customer_code_seq bi tang.)' } else { Bad 'Sinh ma dong thoi khong dat.' }
      [void](Assert-Clean 'sau probe')
    }
    'drift' {
      if (-not (Assert-Clean 'truoc drift')) { Fail 'Database thu con doi tuong/dong kiem thu: ket qua drift khong tin cay. DUNG, gui log cho toi.' }
      $out = Join-Path $Dir ('drift_' + $Db + '.sql')
      $env:DATABASE_URL = 'postgresql://siscom_app:' + [uri]::EscapeDataString($script:pw) + '@127.0.0.1:5432/' + $Db
      Push-Location $root
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { $o = & npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --output $out 2>&1; $dc = $LASTEXITCODE }
      finally { $ErrorActionPreference = $prev; Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
      if ($dc -ne 0) { Bad ('prisma migrate diff loi (ma ' + $dc + ').') }
      else {
        $t = [System.IO.File]::ReadAllText($out)
        if ($t -match 'app_meta') { Bad 'Diff nhac toi app_meta - app_meta bi lech!' }
        elseif ($t -match '(?i)empty migration') { Ok 'Khong lech giua database thu va schema.prisma.' }
        else {
          # Chap nhan: DROP INDEX cua chi muc VIET TAY (uq_/ix_). Moi thu khac la bat thuong => KHONG DAT.
          $known = 0; $other = @()
          foreach ($m in [regex]::Matches($t, '(?m)^(?!--)\s*(\S.*?;)\s*$')) {
            $stmt = $m.Groups[1].Value.Trim()
            if ($stmt -match '^DROP INDEX "(uq|ix)_[a-z_]+";$') { $known++ } else { $other += $stmt }
          }
          Say ('Diff co ' + $known + ' DROP INDEX cua chi muc viet tay (uq_/ix_) - CHAP NHAN, KHONG AP DUNG.') 'Yellow'
          if ($other.Count -gt 0) { Bad ('Diff co ' + $other.Count + ' cau lenh KHAC chi muc viet tay (bat thuong):'); foreach ($x in $other) { Say ('  ' + $x) } }
          else { Ok 'Diff chi gom DROP INDEX cua chi muc viet tay da biet (Prisma khong mo ta duoc).' }
          Say ('Da luu: ' + $out + ' - gui cho toi.') 'Yellow'
        }
      }
    }
  }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Say ('[LOI] ' + $_.Exception.Message) 'Red' }
  else { Say ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') 'Red' }
  $script:fail = $true
}
finally { $script:pw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
if ($script:log) { Write-Host ('Log (khong chua mat khau): ' + $script:log) }
if ($script:fail) { Write-Host 'KET QUA: CO MUC KHONG DAT / LOI. Dung lai va gui toi log.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: buoc nay DAT.' -ForegroundColor Green }
