# SISCOM CRM - THU khoi phuc ban sao luu vao mot database MOI (ten co ngay-gio). KHONG dung vao siscom_crm_dev.
# (B1.2.2: ghi them <ban_sao_luu>.restore-ok.txt khi khoi phuc thanh cong - release-b122.ps1 dung de xac nhan ban sao luu da duoc thu khoi phuc.)
# Khong DROP/TRUNCATE/DELETE. Database thu duoc GIU LAI de ban xem; xoa thu cong khi khong can (huong dan cuoi script).
[CmdletBinding()]
param([string]$DumpFile, [string]$BackupDir)
$ErrorActionPreference = 'Stop'
$script:fail = $false
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Ok([string]$m) { Write-Host ('[OK] ' + $m) }
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
function Run-Psql([string]$psql, [string]$user, [string]$pw, [string]$db, [string]$sql) {
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = $sql | & $psql -X -q -t -A -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U $user -d $db -f - 2>$null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Fail ('psql bao loi (ma ' + $code + ') voi tai khoan "' + $user + '" tren "' + $db + '".') }
  return (($out | Out-String).Trim())
}
$adminPw = $null; $appPw = $null
try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  if (-not $BackupDir) { $BackupDir = Join-Path (Split-Path $root -Parent) 'db-backups' }
  if (-not $DumpFile) {
    $latest = Get-ChildItem -LiteralPath $BackupDir -Filter '*.dump' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Fail ('Khong co file .dump nao trong ' + $BackupDir + '. Chay backup-db.bat truoc.') }
    $DumpFile = $latest.FullName
  }
  if (-not (Test-Path -LiteralPath $DumpFile)) { Fail ('Khong thay file: ' + $DumpFile) }
  Ok ('File sao luu: ' + $DumpFile)
  $shaFile = $DumpFile + '.sha256'
  if (Test-Path -LiteralPath $shaFile) {
    $want = ((Get-Content -LiteralPath $shaFile -TotalCount 1) -split '\s+')[0]
    $have = (Get-FileHash -LiteralPath $DumpFile -Algorithm SHA256).Hash
    if ($want -ne $have) { Fail 'SHA-256 khong khop: file sao luu da bi thay doi/hong. Khong khoi phuc.' }
    Ok 'SHA-256 khop'
  } else { Write-Host '[CANH BAO] Khong co file .sha256 de doi chieu.' -ForegroundColor Yellow }

  $psql = Find-Tool 'psql.exe'; $restore = Find-Tool 'pg_restore.exe'
  if (-not $psql -or -not $restore) { Fail 'Khong tim thay psql/pg_restore.' }
  $target = 'siscom_crm_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
  Write-Host ('Se tao database moi: ' + $target + ' (chu so huu siscom_app). Khong dung toi siscom_crm_dev.')
  $adminPw = Read-Secret 'Mat khau tai khoan postgres (chi de TAO database thu; khong luu)'
  if ((Run-Psql $psql 'postgres' $adminPw 'postgres' ("SELECT 1 FROM pg_database WHERE datname='" + $target + "';")) -eq '1') { Fail 'Database thu da ton tai (khong ghi de).' }
  Run-Psql $psql 'postgres' $adminPw 'postgres' ('CREATE DATABASE ' + $target + ' OWNER siscom_app;') | Out-Null
  Ok ('Da tao database ' + $target)
  $adminPw = $null

  $envFile = Join-Path $root '.env'
  try {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
    $u = New-Object System.Uri -ArgumentList $line.Substring(13)
    $appPw = [uri]::UnescapeDataString($u.UserInfo.Split(':', 2)[1])
  } catch { Fail 'Khong doc duoc mat khau ung dung tu .env (noi dung loi bi an).' }
  $env:PGPASSWORD = $appPw
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $restore -w -h 127.0.0.1 -p 5432 -U siscom_app -d $target --no-owner --exit-on-error $DumpFile 2>$null; $rc = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if ($rc -ne 0) { Fail ('pg_restore that bai (ma ' + $rc + '). Database thu ' + $target + ' van con, xoa thu cong neu muon.') }
  Ok 'pg_restore hoan tat'

  $meta = Run-Psql $psql 'siscom_app' $appPw $target "SELECT COALESCE((SELECT value FROM app_meta WHERE key='schema_baseline'),'(khong co)');"
  $cnt = Run-Psql $psql 'siscom_app' $appPw $target "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
  Ok ('Trong database thu: schema_baseline = ' + $meta + ' ; so bang = ' + $cnt)
  try {
    $mk = $DumpFile + '.restore-ok.txt'
    $mkLines = @(('sha256=' + (Get-FileHash -LiteralPath $DumpFile -Algorithm SHA256).Hash), ('dump=' + (Split-Path $DumpFile -Leaf)), ('restored_db=' + $target), ('schema_baseline=' + $meta), ('tables=' + $cnt), ('at=' + (Get-Date -Format 'o')))
    Set-Content -LiteralPath $mk -Value $mkLines -Encoding ASCII
    Ok ('Da ghi dau vet restore-test: ' + $mk)
  } catch { Write-Host '[CANH BAO] Khong ghi duoc dau vet restore-test (khong anh huong ket qua khoi phuc).' -ForegroundColor Yellow }
  Write-Host ''
  Write-Host 'THANH CONG: ban sao luu khoi phuc duoc. Database thu duoc giu lai. Khi khong can nua, xoa THU CONG (can quyen postgres):' -ForegroundColor Green
  Write-Host ('  psql -U postgres -h 127.0.0.1 -c "DROP DATABASE ' + $target + ';"   <- chi database thu nay, TUYET DOI khong phai siscom_crm_dev')
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red }
  else { Write-Host ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') -ForegroundColor Red }
  $script:fail = $true
}
finally { $adminPw = $null; $appPw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if ($script:fail) { exit 1 }
