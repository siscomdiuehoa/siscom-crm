# SISCOM CRM - THU KHOI PHUC ban sao luu cua CUM DEMO vao mot database MOI tren chinh cum demo (khong phai cong 5432).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-restore-test.ps1 (file moi, 05/11/2026). restore-test.ps1 co dinh 5432 => KHONG dung cho demo.
#   -PgPort     : cong cum demo (mac dinh 55433). Cong 5432 bi TU CHOI.
#   -DumpFile   : file .dump (mac dinh: file moi nhat trong -BackupDir, mac dinh D:\SISCOM-CRM-demo-pg\backups). Kiem SHA-256 theo <file>.sha256.
#   -SourceDatabaseName : DB nguon de so so dong (mac dinh: ten trong file dump = phan truoc _YYYYMMDD_HHMMSS); bo qua so sanh neu DB nguon khong ton tai.
# Tao database MOI siscom_crm_restore_<ngay-gio> (OWNER siscom_migrator neu role co, neu khong: siscom_app), pg_restore --exit-on-error
#   (giu chu so huu doi tuong nhu DB nguon - cac role cum demo da co), so so dong 6 bang voi DB nguon, ghi <dump>.restore-ok.txt.
# KHONG DROP/TRUNCATE/DELETE; database thu duoc GIU LAI (dung lam ban sao de dien tap migration/rollback). Xoa thu cong khi khong can.
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [string]$DumpFile,
  [string]$BackupDir = 'D:\SISCOM-CRM-demo-pg\backups',
  [string]$SourceDatabaseName
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
function Invoke-Psql([string]$pw, [string]$db, [string]$sql) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $env:PGPASSWORD = $pw; $env:PGREQUIREAUTH = 'scram-sha-256'; $out = & $script:psql -X -q -w -h 127.0.0.1 -p $PgPort -U postgres -d $db -v ON_ERROR_STOP=1 -t -A -c $sql 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql (postgres @ ' + $db + ') ma thoat ' + $code + ': ' + ((@($out | ForEach-Object { $_.ToString() }) | Select-Object -Last 3) -join ' | ')) }
  return (@($out | ForEach-Object { $_.ToString() } | Where-Object { $_ -ne '' -and $_ -notmatch '^(WARNING|NOTICE|DETAIL|HINT|psql:)' }) | Select-Object -Last 1)
}
$pgPw = $null
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai cua may: script nay chi dung cho cum demo (mac dinh -PgPort 55433).' }
  $script:psql = Find-Tool 'psql.exe'; $restore = Find-Tool 'pg_restore.exe'
  if (-not $script:psql -or -not $restore) { Fail 'Khong tim thay psql/pg_restore.' }
  if (-not $DumpFile) {
    $latest = Get-ChildItem -LiteralPath $BackupDir -Filter '*.dump' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Fail ('Khong co file .dump nao trong ' + $BackupDir + '. Chay demo-backup.bat truoc.') }
    $DumpFile = $latest.FullName
  }
  if (-not (Test-Path -LiteralPath $DumpFile)) { Fail ('Khong thay file: ' + $DumpFile) }
  $shaFile = $DumpFile + '.sha256'
  if (-not (Test-Path -LiteralPath $shaFile)) { Fail ('Thieu ' + $shaFile + ' (demo-backup.ps1 luon ghi). Khong khoi phuc file khong co SHA-256.') }
  $want = ((Get-Content -LiteralPath $shaFile -First 1) -split '\s+')[0].ToLower()
  $have = (Get-FileHash -LiteralPath $DumpFile -Algorithm SHA256).Hash.ToLower()
  if ($want -ne $have) { Fail 'SHA-256 khong khop: file sao luu da bi thay doi/hong. Khong khoi phuc.' }
  Ok ('SHA-256 khop: ' + $have)
  $pgPw = Get-DemoSecret $PgPort 'POSTGRES_PW'
  if (-not $pgPw) { Fail ('Khong co file mat khau cum demo (pg-' + $PgPort + '.secrets).') }
  $cluster = Invoke-Psql $pgPw 'postgres' 'SHOW cluster_name;'
  if ($cluster -ne 'siscom_demo') { Fail ('Cum tren cong ' + $PgPort + ' co cluster_name = "' + $cluster + '", khong phai cum demo. Dung lai.') }
  Ok 'Ket noi cum demo (cluster_name = siscom_demo).'
  if (-not $SourceDatabaseName) { $leaf = [IO.Path]::GetFileNameWithoutExtension($DumpFile); if ($leaf -match '^(.+)_[0-9]{8}_[0-9]{6}$') { $SourceDatabaseName = $Matches[1] } }
  $owner = 'siscom_app'
  if ((Invoke-Psql $pgPw 'postgres' "SELECT 1 FROM pg_roles WHERE rolname = 'siscom_migrator';") -eq '1') { $owner = 'siscom_migrator' }
  $target = 'siscom_crm_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
  if ((Invoke-Psql $pgPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname = '" + $target + "';")) -eq '1') { Fail 'Database thu da ton tai (khong ghi de). Doi vai giay roi chay lai.' }
  Say ('Tao database MOI ' + $target + ' (OWNER ' + $owner + ') tren cum demo ' + $PgPort + '; khong dung toi DB nguon.') 'Yellow'
  Invoke-Psql $pgPw 'postgres' ('CREATE DATABASE ' + $target + ' OWNER ' + $owner + ';') | Out-Null
  Ok ('Da tao database ' + $target)

  Say '--- pg_restore --exit-on-error (giu chu so huu doi tuong) ---' 'Cyan'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $env:PGPASSWORD = $pgPw; $env:PGREQUIREAUTH = 'scram-sha-256'; & $restore -w -h 127.0.0.1 -p $PgPort -U postgres -d $target --exit-on-error $DumpFile 2>&1 | Out-Host; $rc = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
  if ($rc -ne 0) { Fail ('pg_restore that bai (ma ' + $rc + '). Database thu ' + $target + ' van con, xoa thu cong neu muon.') }
  Ok 'pg_restore hoan tat'

  $tables = @('customer', 'contact', 'employee', 'activity', 'audit_log', '_prisma_migrations')
  $cmpSrc = $false
  if ($SourceDatabaseName -and (Invoke-Psql $pgPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname = '" + $SourceDatabaseName + "';")) -eq '1') { $cmpSrc = $true }
  $lines = @('target_database=' + $target, 'dump=' + $DumpFile, 'sha256=' + $have, 'restored_at=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), 'owner=' + $owner)
  $mismatch = 0
  foreach ($t in $tables) {
    $n = Invoke-Psql $pgPw $target ('SELECT count(*) FROM public.' + $t + ';')
    if ($cmpSrc) {
      $s = Invoke-Psql $pgPw $SourceDatabaseName ('SELECT count(*) FROM public.' + $t + ';')
      $tag = ''; if ($n -ne $s) { $mismatch++; $tag = '  <== LECH' }
      Say (('{0,-20} ban sao={1,8}  nguon={2,8}' -f $t, $n, $s) + $tag)
      $lines += ($t + '=' + $n + ' (nguon ' + $SourceDatabaseName + '=' + $s + ')')
    } else { Say (('{0,-20} ban sao={1,8}' -f $t, $n)); $lines += ($t + '=' + $n) }
  }
  $base = Invoke-Psql $pgPw $target "SELECT value FROM public.app_meta WHERE key = 'schema_baseline';"
  $lines += ('schema_baseline=' + $base)
  if ($cmpSrc -and $mismatch -gt 0) { Fail ('So dong LECH o ' + $mismatch + ' bang so voi DB nguon. Khong ghi restore-ok. Database thu ' + $target + ' van con de xem.') }
  Set-Content -LiteralPath ($DumpFile + '.restore-ok.txt') -Encoding ASCII -Value $lines
  Ok ('THANH CONG: ' + $target + ' (schema_baseline=' + $base + '). Da ghi ' + $DumpFile + '.restore-ok.txt')
  Say ('Ban sao nay dung de dien tap migration/rollback: demo-split.bat -Step migrate -DatabaseName ' + $target + ' -PgPort ' + $PgPort) 'Cyan'
  Say ('Khi khong can: xoa thu cong DUNG database thu (psql -U postgres -p ' + $PgPort + ' -c "DROP DATABASE ' + $target + '"). Script nay khong xoa gi.') 'Gray'
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally { $pgPw = $null; Remove-Item Env:PGPASSWORD, Env:PGREQUIREAUTH -ErrorAction SilentlyContinue }
