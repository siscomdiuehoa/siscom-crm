# SISCOM CRM - Sao luu PostgreSQL (pg_dump dinh dang custom).
# Mac dinh ghi vao D:\SISCOM-CRM\db-backups (thu muc cha cua backend\ + "db-backups"). Co the doi: backup-db.bat -BackupDir "E:\Sao-luu"
# Chi DOC database, khong sua/xoa gi. Khong ghi de file cu. Khong in mat khau.
[CmdletBinding()]
param([string]$BackupDir)
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
function Major([string]$text) { if ($text -match '(\d+)(\.\d+)*') { return [int]$Matches[1] } return 0 }

$pw = $null
try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $envFile = Join-Path $root '.env'
  if (-not (Test-Path -LiteralPath $envFile)) { Fail 'Chua co file .env (chay setup-db.bat truoc).' }
  try {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
    $u = New-Object System.Uri -ArgumentList $line.Substring(13)
    $parts = $u.UserInfo.Split(':', 2)
    $user = [uri]::UnescapeDataString($parts[0]); $pw = [uri]::UnescapeDataString($parts[1])
    $db = $u.AbsolutePath.TrimStart('/'); $dbHost = $u.Host; $dbPort = $u.Port
  } catch { Fail 'Khong doc duoc DATABASE_URL trong .env (noi dung loi bi an de khong lo mat khau).' }
  if ($user -eq 'postgres') { Fail 'DATABASE_URL dang dung tai khoan postgres. Hay dung siscom_app.' }

  $dump = Find-Tool 'pg_dump.exe'; $restore = Find-Tool 'pg_restore.exe'; $psql = Find-Tool 'psql.exe'
  if (-not $dump -or -not $restore -or -not $psql) { Fail 'Khong tim thay pg_dump/pg_restore/psql (cai muc "Command Line Tools" cua PostgreSQL).' }

  if (-not $BackupDir) { $BackupDir = Join-Path (Split-Path $root -Parent) 'db-backups' }
  if ($BackupDir -match 'Dropbox|OneDrive') { Write-Host '[CANH BAO] Thu muc sao luu nam trong Dropbox/OneDrive: file chua du lieu that se bi dong bo len may khac.' -ForegroundColor Yellow }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $probe = Join-Path $BackupDir ('.ghi-thu-' + [guid]::NewGuid().ToString('N'))
  try { New-Item -ItemType File -Path $probe | Out-Null; Remove-Item -LiteralPath $probe -Force } catch { Fail ('Khong ghi duoc vao thu muc sao luu: ' + $BackupDir) }
  Ok ('Thu muc sao luu: ' + $BackupDir)

  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $svNum = (& $psql -X -q -t -A -w -h $dbHost -p $dbPort -U $user -d $db -c 'SHOW server_version_num;' 2>$null | Out-String).Trim()
    $svCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  if ($svCode -ne 0 -or $svNum -notmatch '^\d{5,6}$') { Fail 'Khong ket noi duoc database bang tai khoan ung dung. Kiem tra dich vu PostgreSQL va file .env.' }
  $serverMajor = [int][math]::Floor([int]$svNum / 10000)
  $dumpMajor = Major ((& $dump --version) -join ' ')
  if ($dumpMajor -lt $serverMajor) { Fail ('pg_dump (ban ' + $dumpMajor + ') cu hon may chu PostgreSQL (ban ' + $serverMajor + '). Dung pg_dump di kem ban ' + $serverMajor + '.') }
  Ok ('Ket noi database "' + $db + '" (PostgreSQL ' + $serverMajor + '), pg_dump ' + $dumpMajor)

  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $final = Join-Path $BackupDir ($db + '_' + $stamp + '.dump')
  $part = $final + '.partial'
  if ((Test-Path -LiteralPath $final) -or (Test-Path -LiteralPath $part)) { Fail 'File dich da ton tai (khong ghi de). Doi vai giay roi chay lai.' }

  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $dump -w -h $dbHost -p $dbPort -U $user -d $db -Fc -Z 6 -f $part; $dcode = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($dcode -ne 0 -or -not (Test-Path -LiteralPath $part)) {
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
    Fail ('pg_dump that bai (ma ' + $dcode + '). Khong co file sao luu nao duoc tao.')
  }
  $size = (Get-Item -LiteralPath $part).Length
  if ($size -lt 1024) { Remove-Item -LiteralPath $part -Force; Fail 'File sao luu qua nho, bo qua.' }

  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $list = & $restore -l $part 2>$null; $rcode = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  $items = @($list | Where-Object { $_ -and -not $_.StartsWith(';') })
  if ($rcode -ne 0 -or $items.Count -lt 3) { Remove-Item -LiteralPath $part -Force; Fail 'File sao luu khong doc lai duoc bang pg_restore -l. Da bo file loi.' }
  $hasMeta = [bool]($items | Where-Object { $_ -match 'TABLE DATA public app_meta' })
  Move-Item -LiteralPath $part -Destination $final
  $hash = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash
  [System.IO.File]::WriteAllText(($final + '.sha256'), ($hash + '  ' + (Split-Path $final -Leaf) + [Environment]::NewLine))

  Ok ('Muc co the khoi phuc: ' + $items.Count)
  if ($hasMeta) { Ok 'Co du lieu bang app_meta trong ban sao luu' } else { Write-Host '[CANH BAO] Khong thay du lieu bang app_meta trong ban sao luu (migration da chay chua?).' -ForegroundColor Yellow }
  Ok ('Da sao luu: ' + $final + ' (' + [math]::Round($size / 1KB, 1) + ' KB)')
  Ok ('SHA-256: ' + $hash)
  Write-Host 'Luu y: file nay co the chua du lieu that. De ngoai Git, khong chia se, bao ve nhu mat khau. Hay chay restore-test.bat de thu khoi phuc vao database MOI.'
}
catch {
  if ($_.Exception -is [System.ApplicationException]) { Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red }
  else { Write-Host ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau.') -ForegroundColor Red }
  $script:fail = $true
}
finally { $pw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if ($script:fail) { exit 1 }
