# SISCOM CRM B1.4 - CUM PostgreSQL 18 RIENG CHO DEMO (khong phai PostgreSQL hien tai cong 5432).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-pg.ps1 (file moi). Runbook: docs\B1.4_DEMO_WINDOWS_RUNBOOK.md.
#   -Step init  : initdb mot cum MOI tai -DataDir (mac dinh D:\SISCOM-CRM-demo-pg\data), chi nghe 127.0.0.1:<PgPort> (mac dinh 55433),
#                 xac thuc scram-sha-256 (KHONG trust), cluster_name = 'siscom_demo' (nhan de cac script demo nhan ra cum - tu choi cum khac),
#                 log_statement = none. Tao role siscom_app (mat khau ngau nhien) + quyen SET app.* (nhu create-test-db).
#                 Mat khau postgres / siscom_app: sinh ngau nhien, luu %LOCALAPPDATA%\SISCOM-CRM\demo\pg-<port>.secrets; file env cho script:
#                 %LOCALAPPDATA%\SISCOM-CRM\demo\demo-<port>.env (DATABASE_URL siscom_app; ten DB 'siscom_crm_dev' chi de doi chieu, KHONG co
#                 database nay tren cum demo). Ca hai file ngoai repo, ACL chi SID tai khoan Windows hien tai. Khong in mat khau.
#   -Step start : khoi dong cum (pg_ctl, khong can quyen Administrator, khong dang ky Windows service).
#   -Step stop  : dung cum (pg_ctl stop -m fast).
#   -Step status: trang thai + nhan cum.
# TU CHOI: cong 5432 (PostgreSQL hien tai), -DataDir nam trong thu muc cai PostgreSQL hoac la thu muc data cua dich vu hien tai,
#   init khi thu muc da co du lieu, init khi cong dang co tien trinh nghe.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('init', 'start', 'stop', 'status')][string]$Step,
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [string]$DataDir = 'D:\SISCOM-CRM-demo-pg\data'
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Find-Tool([string]$name) {
  $dirs = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+$' -and [int]$_.Name -ge 18 } | Sort-Object { [int]$_.Name } -Descending
  foreach ($d in $dirs) { $p = Join-Path $d.FullName ('bin\' + $name); if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}
function New-RandomSecret() {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Protect-File([string]$file) {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & icacls.exe $file /inheritance:r /grant:r ('*' + $sid + ':(R,W)') 2>&1 | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($code -ne 0) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; Fail ('Khong dat duoc quyen rieng cho ' + $file + ' (icacls ma ' + $code + '); da xoa file.') }
}
function Test-PortOpen([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null); $ok = $iar.AsyncWaitHandle.WaitOne(500); if ($ok) { try { $c.EndConnect($iar) } catch { $ok = $false } }; return $ok } finally { $c.Close() }
}
function Wait-Ready([int]$seconds) {
  for ($i = 0; $i -lt ($seconds * 2); $i++) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $script:isready -h 127.0.0.1 -p $PgPort -q 2>&1 | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
function Start-Cluster() {
  # pg_ctl chay nen, khong cho (-w co the giu handle cua cua so); cho bang pg_isready.
  Start-Process -FilePath $script:pgctl -ArgumentList @('-D', ('"' + $DataDir + '"'), '-l', ('"' + $script:logFile + '"'), 'start') -WindowStyle Hidden | Out-Null
  if (-not (Wait-Ready 30)) { Fail ('Cum demo khong san sang sau 30 giay. Xem log: ' + $script:logFile) }
}
function Invoke-SuperPsql([string]$pw, [hashtable]$vars, [string]$sql) {
  $lines = @()
  if ($vars) { foreach ($k in $vars.Keys) { $v = [string]$vars[$k]; if ($v -notmatch '^[A-Za-z0-9_]*$') { Fail 'Gia tri bien khong hop le.' }; $lines += ('\set ' + $k + " '" + $v + "'") } }
  $lines += $sql
  $env:PGPASSWORD = $pw; $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = ($lines -join "`n") | & $script:psql -X -q -w -h 127.0.0.1 -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A -f - 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  $all = @($out | ForEach-Object { $_.ToString() })
  if ($code -ne 0) { Fail ('psql ma thoat ' + $code + ': ' + (($all | Select-Object -Last 4) -join ' | ')) }
  $d = @($all | Where-Object { $_ -ne '' -and $_ -notmatch '^(WARNING|NOTICE|DETAIL|HINT|psql:)' }); if ($d.Count -eq 0) { return '' }; return $d[-1].Trim()
}
$pgPw = $null; $appPw = $null
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai cua may: cum demo phai dung cong khac (mac dinh 55433).' }
  $full = [System.IO.Path]::GetFullPath($DataDir).TrimEnd('\')
  if ($full -like 'C:\Program Files\PostgreSQL*') { Fail 'DataDir khong duoc nam trong thu muc cai PostgreSQL (du lieu cua dich vu hien tai).' }
  if ($full -notmatch '^[\x20-\x7E]+$' -or $full -match "[`"']") { Fail 'DataDir phai la duong dan ASCII, khong co dau nhay.' }
  $svcDirs = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'pg_ctl' } | ForEach-Object { if ($_.PathName -match '-D\s+"?([^"]+?)"?(\s+-|$)') { [System.IO.Path]::GetFullPath($Matches[1]).TrimEnd('\') } })
  if ($svcDirs -contains $full) { Fail 'DataDir trung thu muc data cua dich vu PostgreSQL dang cai. Dung lai.' }
  $DataDir = $full
  $script:pgctl = Find-Tool 'pg_ctl.exe'; $script:psql = Find-Tool 'psql.exe'; $script:isready = Find-Tool 'pg_isready.exe'; $initdb = Find-Tool 'initdb.exe'
  if (-not $script:pgctl -or -not $script:psql -or -not $initdb) { Fail 'Khong tim thay PostgreSQL 18 (C:\Program Files\PostgreSQL\18\bin).' }
  $root = Split-Path -Parent $DataDir
  $script:logFile = Join-Path $root ('postgres-' + $PgPort + '.log')
  $dir = Join-Path $env:LOCALAPPDATA 'SISCOM-CRM\demo'
  $secFile = Join-Path $dir ('pg-' + $PgPort + '.secrets'); $envFile = Join-Path $dir ('demo-' + $PgPort + '.env')
  Say ('Cum demo: ' + $DataDir + ' | 127.0.0.1:' + $PgPort + ' | Buoc: ' + $Step) 'Yellow'

  switch ($Step) {
    'init' {
      if ((Test-Path -LiteralPath $DataDir) -and @(Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue).Count -gt 0) { Fail ('Thu muc ' + $DataDir + ' da co du lieu: khong ghi de. Dung -Step start, hoac chon -DataDir khac.') }
      if (Test-PortOpen $PgPort) { Fail ('Cong ' + $PgPort + ' dang co tien trinh nghe. Chon -PgPort khac.') }
      if (Test-Path -LiteralPath $secFile) { Fail ('Da co file mat khau ' + $secFile + ' cua mot cum demo cu cung cong. Xoa file nay (va cum cu neu bo) roi init lai.') }
      New-Item -ItemType Directory -Force -Path $DataDir, $dir | Out-Null
      $pgPw = New-RandomSecret; $appPw = New-RandomSecret
      $pwFile = Join-Path $dir ('initdb-' + $PgPort + '.tmp')
      Set-Content -LiteralPath $pwFile -Value $pgPw -Encoding ASCII -NoNewline; Protect-File $pwFile
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & $initdb -D $DataDir -U postgres -E UTF8 --no-locale --auth=scram-sha-256 ('--pwfile=' + $pwFile) 2>&1 | Out-Null; $code = $LASTEXITCODE }
      finally { $ErrorActionPreference = $prev; Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
      if ($code -ne 0) { Fail ('initdb that bai (ma ' + $code + ').') }
      Ok 'initdb xong (scram-sha-256, UTF8).'
      Add-Content -LiteralPath (Join-Path $DataDir 'postgresql.conf') -Encoding ASCII -Value @('', '# SISCOM CRM demo (demo-pg.ps1)', "listen_addresses = '127.0.0.1'", ('port = ' + $PgPort), "cluster_name = 'siscom_demo'", "log_statement = 'none'", 'log_min_duration_statement = -1')
      Set-Content -LiteralPath (Join-Path $DataDir 'pg_hba.conf') -Encoding ASCII -Value @('# SISCOM CRM demo: chi 127.0.0.1, luon scram-sha-256 (khong trust)', 'host all all 127.0.0.1/32 scram-sha-256')
      Start-Cluster
      $cn = Invoke-SuperPsql $pgPw $null "SELECT current_setting('cluster_name') || '|' || current_setting('server_version_num');"
      if ($cn.Split('|')[0] -ne 'siscom_demo') { Fail 'Cum vua tao khong mang nhan siscom_demo. Dung lai.' }
      Invoke-SuperPsql $pgPw @{ pw = $appPw } "SELECT format('CREATE ROLE siscom_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'pw') \gexec" | Out-Null
      Invoke-SuperPsql $pgPw $null 'GRANT SET ON PARAMETER app.actor_employee_id TO siscom_app; GRANT SET ON PARAMETER app.priv_request_id TO siscom_app;' | Out-Null
      Set-Content -LiteralPath $secFile -Encoding ASCII -Value @(('POSTGRES_PW=' + $pgPw), ('APP_PW=' + $appPw)); Protect-File $secFile
      Set-Content -LiteralPath $envFile -Encoding ASCII -Value @(('# Sinh boi demo-pg.ps1 cho cum demo cong ' + $PgPort + '. Ten DB chi de doi chieu (khong ket noi).'), ('DATABASE_URL=postgresql://siscom_app:' + $appPw + '@127.0.0.1:' + $PgPort + '/siscom_crm_dev')); Protect-File $envFile
      Ok ('Role siscom_app + quyen SET app.*; mat khau luu ' + $secFile + ' va ' + $envFile + ' (chi tai khoan Windows hien tai).')
      Say ''
      Say ('CUM DEMO SAN SANG: 127.0.0.1:' + $PgPort + ' (cluster_name = siscom_demo). Buoc tiep: demo-setup.bat') 'Cyan'
    }
    'start' {
      if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'PG_VERSION'))) { Fail ('Chua co cum tai ' + $DataDir + ' (chay -Step init).') }
      if (Wait-Ready 1) { Ok 'Cum demo dang chay.' } else { Start-Cluster; Ok 'Da khoi dong cum demo.' }
    }
    'stop' {
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & $script:pgctl -D $DataDir -m fast -w stop 2>&1 | Out-Host; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
      if ($code -ne 0) { Fail ('pg_ctl stop ma ' + $code + ' (cum co the da dung).') }
      Ok 'Da dung cum demo.'
    }
    'status' {
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & $script:pgctl -D $DataDir status 2>&1 | Out-Host } finally { $ErrorActionPreference = $prev }
      if ((Wait-Ready 1) -and (Test-Path -LiteralPath $secFile)) {
        foreach ($l in Get-Content -LiteralPath $secFile) { if ($l -match '^POSTGRES_PW=([0-9a-f]{64})$') { $pgPw = $Matches[1] } }
        Say ('Nhan cum: ' + (Invoke-SuperPsql $pgPw $null "SELECT current_setting('cluster_name') || ' | ' || version();"))
      }
    }
  }
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally { $pgPw = $null; $appPw = $null; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
