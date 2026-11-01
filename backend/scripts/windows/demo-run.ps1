# SISCOM CRM B1.4 - CHAY BAN DEMO (sau demo-setup.ps1): khoi dong cum PostgreSQL demo, backend (2 pool) va giao dien, mo trinh duyet.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-run.ps1 (file moi). Runbook: docs\B1.4_DEMO_WINDOWS_RUNBOOK.md.
#   Backend: cua so rieng "SISCOM demo backend" (auth-demo-stack -Step start, cong -ApiPort, mac dinh 3100, NODE_ENV=development, http noi bo).
#   Giao dien: cua so rieng "SISCOM demo web" (vite preview cong 4173, proxy /api -> backend). Mo http://127.0.0.1:4173.
#   Dung demo: dong 2 cua so do (hoac Ctrl-C), roi demo-pg.bat -Step stop.
# Chi cum demo (cluster_name siscom_demo), khong bao gio cong 5432. Khong mo ra Internet.
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [ValidateRange(1024, 65535)][int]$ApiPort = 3100,
  [string]$DataDir = 'D:\SISCOM-CRM-demo-pg\data',
  [string]$DatabaseName,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Test-Http([string]$url) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; return $r.StatusCode } catch { return 0 } }
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai: demo chi dung cum demo rieng.' }
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $fe = (Resolve-Path (Join-Path $root '..\frontend\siscom-crm-web')).Path
  $dir = Join-Path $env:LOCALAPPDATA 'SISCOM-CRM\demo'
  if (-not $DatabaseName) {
    $cur = Join-Path $dir ('current-' + $PgPort + '.txt')
    if (-not (Test-Path -LiteralPath $cur)) { Fail 'Chua co ban demo (chay demo-setup.bat truoc).' }
    $DatabaseName = (Get-Content -LiteralPath $cur | Select-Object -First 1).Trim()
  }
  # QA M-3: duong dan duoc ghep vao lenh powershell -Command / cmd /k => chi chap nhan ky tu an toan (khong ' " % ^ & ! ...).
  foreach ($p in @($PSScriptRoot, $fe)) { if ($p -notmatch '^[A-Za-z0-9 :._()\\-]+$') { Fail ('Duong dan co ky tu dac biet, khong chay duoc an toan: ' + $p + ' (dat repo o duong dan chi co chu/so/dau cach/._-).') } }
  if ($DatabaseName -notmatch '^siscom_crm_test_\d{8}_\d{6}$') { Fail ('Ten DB demo khong hop le: ' + $DatabaseName) }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\main.js')) -or -not (Test-Path -LiteralPath (Join-Path $fe 'dist\index.html'))) { Fail 'Thieu ban build (chay demo-setup.bat -Build).' }
  if ((Test-Http ('http://127.0.0.1:' + $ApiPort + '/api/v1/health')) -ne 0) { Fail ('Cong ' + $ApiPort + ' dang co dich vu (backend demo dang chay?). Dong cua so backend cu truoc.') }
  if ((Test-Http 'http://127.0.0.1:4173/') -ne 0) { Fail 'Cong 4173 dang co dich vu (giao dien demo dang chay?). Dong cua so cu truoc.' }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'demo-pg.ps1') -Step start -PgPort $PgPort -DataDir $DataDir | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'Khong khoi dong duoc cum PostgreSQL demo.' }

  Say ('Mo backend (cua so rieng) tren DB ' + $DatabaseName + ' ...') 'Cyan'
  $beArgs = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', ("`$host.UI.RawUI.WindowTitle = 'SISCOM demo backend'; & '" + (Join-Path $PSScriptRoot 'auth-demo-stack.ps1') + "' -Step start -DatabaseName " + $DatabaseName + ' -PgPort ' + $PgPort + ' -Port ' + $ApiPort + ' -NonInteractive'))
  Start-Process -FilePath 'powershell.exe' -ArgumentList $beArgs | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) { if ((Test-Http ('http://127.0.0.1:' + $ApiPort + '/api/v1/health/database')) -eq 200) { $ok = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { Fail 'Backend khong len sau 60 giay: xem cua so "SISCOM demo backend".' }
  $h = (Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $ApiPort + '/api/v1/health/database') -TimeoutSec 5).Content
  if ($h -notmatch '"authPool":"separate"' -or $h -notmatch '"leastPrivilege":true' -or $h -notmatch '"authLeastPrivilege":true') { Say ('CANH BAO: health khong dung kien truc 2 pool: ' + $h) 'Yellow' } else { Ok 'Backend: 2 pool (siscom_app + siscom_auth), quyen toi thieu.' }

  Say 'Mo giao dien (cua so rieng) ...' 'Cyan'
  $feCmd = "title SISCOM demo web && cd /d `"" + $fe + "`" && set `"VITE_DEV_API_TARGET=http://127.0.0.1:" + $ApiPort + "`" && npx.cmd vite preview --port 4173 --strictPort --host 127.0.0.1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $feCmd) | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) { if ((Test-Http 'http://127.0.0.1:4173/') -eq 200) { $ok = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { Fail 'Giao dien khong len sau 40 giay: xem cua so "SISCOM demo web".' }
  Ok 'Giao dien: http://127.0.0.1:4173'
  if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4173' | Out-Null }
  Say ''
  Say ('Tai khoan demo: ' + (Join-Path $dir ('accounts-' + $DatabaseName + '.txt'))) 'Cyan'
  Say 'Dung demo: dong 2 cua so "SISCOM demo backend" va "SISCOM demo web", roi demo-pg.bat -Step stop.'
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
