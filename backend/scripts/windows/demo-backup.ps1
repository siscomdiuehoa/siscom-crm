# SISCOM CRM - SAO LUU database tren CUM PostgreSQL DEMO (pg_dump dinh dang custom) - KHONG phai PostgreSQL hien tai cong 5432.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-backup.ps1 (file moi, 05/11/2026). backup-db.ps1 doc backend\.env va co dinh 5432 => KHONG dung cho demo.
#   -PgPort       : cong cum demo (mac dinh 55433). Cong 5432 bi TU CHOI (khong co ngoai le).
#   -DatabaseName : database can sao luu; mac dinh doc D:\SISCOM-CRM-demo-pg\private\current-<port>.txt (do demo-setup ghi).
#   -BackupDir    : thu muc ghi file (mac dinh D:\SISCOM-CRM-demo-pg\backups - ngoai Git). Khong ghi de file cu.
# Mat khau postgres CUA CUM DEMO lay tu D:\SISCOM-CRM-demo-pg\private\pg-<port>.secrets (do demo-pg.ps1 sinh); khong hoi tay, khong in.
# Chi DOC database: SHOW cluster_name (phai 'siscom_demo'), pg_dump -Fc vao file .partial, kiem doc lai bang pg_restore -l, doi ten,
#   ghi <file>.sha256 (SHA-256). Thu khoi phuc: demo-restore-test.ps1 (bat buoc it nhat mot lan truoc migration - docs\BACKUP_RESTORE.md).
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [string]$DatabaseName,
  [string]$BackupDir = 'D:\SISCOM-CRM-demo-pg\backups'
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
function Get-DemoSecret([int]$port, [string]$key) {
  $f = Join-Path 'D:\SISCOM-CRM-demo-pg\private' ('pg-' + $port + '.secrets')
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  foreach ($l in Get-Content -LiteralPath $f) { if ($l -match ('^' + $key + '=([0-9a-f]{64})$')) { return $Matches[1] } }
  return $null
}
# psql chi doc, -w + PGPASSWORD chi trong pham vi lenh; SCRAM bat buoc (khong gui mat khau dang ro).
function Invoke-Psql([string]$pw, [string]$db, [string]$sql) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $env:PGPASSWORD = $pw; $env:PGREQUIREAUTH = 'scram-sha-256'; $out = & $script:psql -X -q -w -h 127.0.0.1 -p $PgPort -U postgres -d $db -v ON_ERROR_STOP=1 -t -A -c $sql 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql (postgres @ ' + $db + ') ma thoat ' + $code + ': ' + ((@($out | ForEach-Object { $_.ToString() }) | Select-Object -Last 3) -join ' | ')) }
  return (@($out | ForEach-Object { $_.ToString() } | Where-Object { $_ -ne '' -and $_ -notmatch '^(WARNING|NOTICE|DETAIL|HINT|psql:)' }) | Select-Object -Last 1)
}
$pgPw = $null
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai cua may: script nay chi sao luu cum demo (mac dinh -PgPort 55433).' }
  if ($BackupDir -match 'Dropbox|OneDrive') { Say '[CANH BAO] Thu muc sao luu nam trong Dropbox/OneDrive: file se bi dong bo len may khac.' 'Yellow' }
  $script:psql = Find-Tool 'psql.exe'; $dump = Find-Tool 'pg_dump.exe'; $restore = Find-Tool 'pg_restore.exe'
  if (-not $script:psql -or -not $dump -or -not $restore) { Fail 'Khong tim thay psql/pg_dump/pg_restore (cai "Command Line Tools" cua PostgreSQL).' }
  if (-not $DatabaseName) {
    $cur = Join-Path 'D:\SISCOM-CRM-demo-pg\private' ('current-' + $PgPort + '.txt')
    if (-not (Test-Path -LiteralPath $cur)) { Fail ('Khong co ' + $cur + ': chi ro -DatabaseName.') }
    $DatabaseName = (Get-Content -LiteralPath $cur -First 1).Trim()
  }
  if ($DatabaseName -notmatch '^siscom_crm_(test|restore)_[0-9]{8}_[0-9]{6}$') { Fail ('Ten database ' + $DatabaseName + ' khong phai DB demo/ban sao thu (siscom_crm_test_* / siscom_crm_restore_*).') }
  $pgPw = Get-DemoSecret $PgPort 'POSTGRES_PW'
  if (-not $pgPw) { Fail ('Khong co file mat khau cum demo D:\SISCOM-CRM-demo-pg\private\pg-' + $PgPort + '.secrets (demo-pg.bat -Step init / demo-setup.bat).') }
  Say ('Sao luu DB demo: ' + $DatabaseName + ' @ 127.0.0.1:' + $PgPort + ' -> ' + $BackupDir) 'Yellow'

  $cluster = Invoke-Psql $pgPw 'postgres' "SHOW cluster_name;"
  if ($cluster -ne 'siscom_demo') { Fail ('Cum tren cong ' + $PgPort + ' co cluster_name = "' + $cluster + '", khong phai cum demo (siscom_demo). Dung lai.') }
  Ok 'Ket noi cum demo (cluster_name = siscom_demo).'
  if ((Invoke-Psql $pgPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname = '" + $DatabaseName + "';")) -ne '1') { Fail ('Database ' + $DatabaseName + ' khong ton tai tren cum demo.') }
  $svNum = Invoke-Psql $pgPw $DatabaseName 'SHOW server_version_num;'
  $serverMajor = [int]($svNum.Substring(0, $svNum.Length - 4))
  $dumpMajor = [int]((& $dump --version) -replace '[^0-9.]', '' -split '\.')[0]
  if ($dumpMajor -lt $serverMajor) { Fail ('pg_dump (ban ' + $dumpMajor + ') cu hon may chu (ban ' + $serverMajor + ').') }
  $nTables = Invoke-Psql $pgPw $DatabaseName "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
  $nMig = Invoke-Psql $pgPw $DatabaseName "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL;"
  Ok ('Database ' + $DatabaseName + ' (PostgreSQL ' + $serverMajor + '): ' + $nTables + ' bang public, ' + $nMig + ' migration da ap.')

  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $probe = Join-Path $BackupDir ('.ghi-thu-' + [guid]::NewGuid().ToString('N'))
  try { New-Item -ItemType File -Path $probe | Out-Null; Remove-Item -LiteralPath $probe -Force } catch { Fail ('Khong ghi duoc vao ' + $BackupDir) }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $final = Join-Path $BackupDir ($DatabaseName + '_' + $stamp + '.dump'); $part = $final + '.partial'
  if ((Test-Path -LiteralPath $final) -or (Test-Path -LiteralPath $part)) { Fail 'File dich da ton tai (khong ghi de). Doi vai giay roi chay lai.' }

  Say '--- pg_dump -Fc (chi doc database) ---' 'Cyan'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $env:PGPASSWORD = $pgPw; $env:PGREQUIREAUTH = 'scram-sha-256'; & $dump -w -h 127.0.0.1 -p $PgPort -U postgres -d $DatabaseName -Fc -Z 6 -f $part; $dcode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
  if ($dcode -ne 0 -or -not (Test-Path -LiteralPath $part)) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue; Fail ('pg_dump that bai (ma ' + $dcode + '). Khong co file sao luu nao duoc tao.') }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $items = @(& $restore -l $part 2>&1); $rcode = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($rcode -ne 0 -or $items.Count -lt 3) { Remove-Item -LiteralPath $part -Force; Fail 'File sao luu khong doc lai duoc bang pg_restore -l. Da bo file loi.' }
  Rename-Item -LiteralPath $part -NewName (Split-Path $final -Leaf)
  $hash = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLower()
  Set-Content -LiteralPath ($final + '.sha256') -Encoding ASCII -Value ($hash + '  ' + (Split-Path $final -Leaf))
  $size = [math]::Round((Get-Item -LiteralPath $final).Length / 1MB, 2)
  Ok ('Da sao luu: ' + $final + ' (' + $size + ' MB, ' + ($items.Count) + ' muc trong pg_restore -l)')
  Ok ('SHA-256: ' + $hash + ' (ghi ' + $final + '.sha256)')
  Say 'Buoc tiep: demo-restore-test.bat (thu khoi phuc vao DB moi tren cum demo, so so dong) TRUOC khi migrate.' 'Cyan'
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally { $pgPw = $null; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
