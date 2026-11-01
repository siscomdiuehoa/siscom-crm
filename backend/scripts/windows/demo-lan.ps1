# SISCOM CRM B1.5 - BAN DEMO CHO DIEN THOAI TRONG WI-FI NOI BO (phuong an B: CA noi bo mkcert) - docs\B1.5_DEMO_LAN_RUNBOOK.md
# Dich: D:\SISCOM-CRM\backend\scripts\windows\demo-lan.ps1 (file moi).
#   -Step check : CHI DOC - kiem dieu kien (cum demo, DB, build, caddy.exe, chung chi), in Caddyfile se dung va lenh firewall de owner tu chay.
#   -Step start : khoi dong cum demo, backend (COOKIE_SECURE=true, TRUST_PROXY=loopback, origin = https://<IP Wi-Fi>:<LanPort>),
#                 giao dien (vite preview 127.0.0.1:4173) va Caddy (cua so rieng) nghe CHI https://<IP Wi-Fi>:<LanPort>:
#                 /api/* -> 127.0.0.1:<ApiPort>, con lai -> 127.0.0.1:4173 (Host = 127.0.0.1:4173 vi vite preview chi nhan localhost/IP).
# Bao mat: backend/giao dien/PostgreSQL van chi 127.0.0.1; Caddy admin off; khong auto_https (khong cong 80); chi IP rieng (10/172.16-31/192.168);
#   KHONG tao quy tac firewall, KHONG tai phan mem, KHONG cai CA - cac viec do owner lam theo runbook. Khong bao gio cong 5432.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'start')][string]$Step,
  [ValidateRange(1024, 65535)][int]$PgPort = 55433,
  [ValidateRange(1024, 65535)][int]$ApiPort = 3100,
  [ValidateRange(1024, 65535)][int]$LanPort = 8443,
  [string]$DataDir = 'D:\SISCOM-CRM-demo-pg\data',
  [string]$DatabaseName,
  [string]$LanIp,
  [string]$ToolsDir = 'D:\SISCOM-CRM-lan-tools',
  [string]$CertDir = 'D:\SISCOM-CRM-demo-pg\private\lan-certs',
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Say ('[DAT] ' + $m) 'Green' }
function Warn([string]$m) { Say ('[CHUA] ' + $m) 'Yellow' }
function Test-Http([string]$url) {
  # Tra ma HTTP ke ca 4xx/5xx (PS 5.1 nem loi voi 4xx/5xx) de "cong dang co dich vu" khong bi bo sot; 0 = khong ket noi duoc.
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; return $r.StatusCode }
  catch { if ($_.Exception.Response) { try { return [int]$_.Exception.Response.StatusCode } catch { return 0 } }; return 0 }
}
function Test-HttpsNoVerify([string]$url) {
  # Chi de kiem Caddy da len (CA mkcert chua nam trong kho tin cay cua may): bo xac thuc chung chi TAM THOI trong tien trinh nay.
  $old = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
  try { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }; return (Test-Http $url) }
  finally { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $old }
}
function Test-PrivateIp([string]$ip) { return ($ip -match '^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$') }
function Get-LanAddress([string]$want) {
  # IPv4 rieng tren adapter dang Up (khong loopback/APIPA). Nhieu dia chi => bat buoc -LanIp.
  $all = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { (Test-PrivateIp $_.IPAddress) -and $_.PrefixOrigin -ne 'WellKnown' })
  $up = @($all | Where-Object { $a = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; $a -and $a.Status -eq 'Up' })
  if ($want) { $m = $up | Where-Object { $_.IPAddress -eq $want } | Select-Object -First 1; if (-not $m) { Fail ('-LanIp ' + $want + ' khong phai dia chi IPv4 rieng dang Up cua may nay.') }; return $m }
  if ($up.Count -eq 1) { return $up[0] }
  if ($up.Count -eq 0) { Fail 'Khong tim thay dia chi IPv4 rieng nao dang Up (chua noi Wi-Fi?).' }
  Fail ('May co nhieu dia chi rieng (' + (($up | ForEach-Object { $_.IPAddress }) -join ', ') + '): chi ro -LanIp <IP Wi-Fi>.')
}
function Get-Subnet([string]$ip, [int]$prefix) {
  $b = [System.Net.IPAddress]::Parse($ip).GetAddressBytes(); [Array]::Reverse($b); $n = [BitConverter]::ToUInt32($b, 0)
  $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $prefix)); $net = $n -band $mask
  $nb = [BitConverter]::GetBytes([uint32]$net); [Array]::Reverse($nb); return ((New-Object System.Net.IPAddress -ArgumentList (,$nb)).ToString() + '/' + $prefix)
}
try {
  if ($PgPort -eq 5432) { Fail 'Cong 5432 la PostgreSQL hien tai: demo chi dung cum demo rieng.' }
  if ($ApiPort -eq $LanPort -or $LanPort -eq 4173) { Fail 'LanPort phai khac ApiPort va 4173.' }
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $fe = (Resolve-Path (Join-Path $root '..\frontend\siscom-crm-web')).Path
  $priv = 'D:\SISCOM-CRM-demo-pg\private'
  foreach ($p in @($PSScriptRoot, $fe, $ToolsDir, $CertDir)) { if ($p -notmatch '^[A-Za-z0-9 :._()\\-]+$') { Fail ('Duong dan co ky tu dac biet, khong chay duoc an toan: ' + $p) } }
  if (-not $DatabaseName) {
    $cur = Join-Path $priv ('current-' + $PgPort + '.txt')
    if (-not (Test-Path -LiteralPath $cur)) { Fail 'Chua co ban demo (chay demo-setup.bat truoc).' }
    $DatabaseName = (Get-Content -LiteralPath $cur | Select-Object -First 1).Trim()
  }
  if ($DatabaseName -notmatch '^siscom_crm_test_\d{8}_\d{6}$') { Fail ('Ten DB demo khong hop le: ' + $DatabaseName) }

  $addr = Get-LanAddress $LanIp; $ip = $addr.IPAddress; $subnet = Get-Subnet $ip $addr.PrefixLength
  $adapter = Get-NetAdapter -InterfaceIndex $addr.InterfaceIndex -ErrorAction SilentlyContinue
  $profile = Get-NetConnectionProfile -InterfaceIndex $addr.InterfaceIndex -ErrorAction SilentlyContinue
  $origin = 'https://' + $ip + ':' + $LanPort
  $caddy = Join-Path $ToolsDir 'caddy.exe'
  $cert = Join-Path $CertDir ($ip + '.pem'); $key = Join-Path $CertDir ($ip + '-key.pem'); $ca = Join-Path $CertDir 'CA\rootCA.pem'
  $caddyfile = Join-Path $CertDir ('Caddyfile.' + $ip + '.' + $LanPort)
  $ruleName = 'SISCOM demo LAN ' + $LanPort
  # Ho so mang -> -Profile cua quy tac firewall: Private | Public | DomainAuthenticated -> Domain; khong xac dinh => canh bao, in Private.
  $prof = 'Private'
  if ($profile) {
    switch ([string]$profile.NetworkCategory) { 'Public' { $prof = 'Public' }; 'DomainAuthenticated' { $prof = 'Domain' }; 'Private' { $prof = 'Private' }; default { Warn ('Ho so mang khong xac dinh (' + $profile.NetworkCategory + '): kiem lai -Profile truoc khi tao quy tac.') } }
  } else { Warn 'Khong doc duoc ho so mang cua adapter: kiem Get-NetConnectionProfile truoc khi tao quy tac firewall.' }

  Say ('Dia chi Wi-Fi: ' + $ip + '/' + $addr.PrefixLength + ' (' + $(if ($adapter) { $adapter.Name } else { '?' }) + ', ho so mang: ' + $(if ($profile) { $profile.NetworkCategory } else { '?' }) + ') | origin: ' + $origin) 'Cyan'
  if ($profile -and $profile.NetworkCategory -eq 'Public') { Warn 'Ho so mang la Public: quy tac firewall duoi day dung -Profile Public (hoac doi mang sang Private truoc - cai dat he thong, can owner).' }

  # --- Caddyfile (tao/cap nhat trong thu muc private; chi doc o -Step check) ---
  $cf = @(
    '{', "`tadmin off", "`tauto_https off", "`tservers {", "`t`tprotocols h1 h2", "`t}", '}',
    ($origin + ' {'), ("`tbind " + $ip), ("`ttls `"" + $cert.Replace('\', '/') + "`" `"" + $key.Replace('\', '/') + "`""), "`tencode gzip",
    "`thandle /api/* {", ("`t`treverse_proxy 127.0.0.1:" + $ApiPort), "`t}",
    "`thandle {", "`t`treverse_proxy 127.0.0.1:4173 {", "`t`t`theader_up Host 127.0.0.1:4173", "`t`t}", "`t}",
    '}'
  ) -join "`n"

  Say '--- Kiem dieu kien ---' 'Cyan'
  if (Test-Path -LiteralPath (Join-Path $root 'dist\main.js')) { Ok 'backend dist' } else { Warn 'backend chua build (demo-setup.bat -Build)' }
  if (Test-Path -LiteralPath (Join-Path $fe 'dist\index.html')) { Ok 'giao dien dist' } else { Warn 'giao dien chua build (demo-setup.bat -Build)' }
  if (Test-Path -LiteralPath $caddy) { Ok ('caddy.exe: ' + $caddy) } else { Warn ('thieu ' + $caddy + ' (owner tai ban chinh thuc, kiem SHA-256 - runbook muc 2)') }
  if ((Test-Path -LiteralPath $cert) -and (Test-Path -LiteralPath $key)) { Ok ('chung chi: ' + $cert) } else { Warn ('thieu chung chi ' + $cert + ' / ' + $key + ' (mkcert - runbook muc 3)') }
  if (Test-Path -LiteralPath $ca) { Ok ('CA de cai len dien thoai: ' + $ca) } else { Warn ('thieu ' + $ca + ' (CAROOT cua mkcert = ' + (Join-Path $CertDir 'CA') + ')') }
  $fw = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($fw) { Ok ('quy tac firewall "' + $ruleName + '": ' + $fw.Enabled) } else { Warn ('chua co quy tac firewall "' + $ruleName + '" (owner chay bang quyen Administrator - lenh duoi)') }
  Say ''
  Say '--- Caddyfile se dung ---' 'Cyan'; Say $cf
  Say ''
  Say '--- Lenh firewall (OWNER tu chay, PowerShell Administrator; khong tu dong) ---' 'Cyan'
  Say ('New-NetFirewallRule -DisplayName "' + $ruleName + '" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ' + $LanPort + ' -LocalAddress ' + $ip + ' -RemoteAddress ' + $subnet + ' -Profile ' + $prof + ' -Program "' + $caddy + '"')
  Say ('Tat sau buoi thu: Disable-NetFirewallRule -DisplayName "' + $ruleName + '"   | Xoa han: Remove-NetFirewallRule -DisplayName "' + $ruleName + '"')
  if ($Step -eq 'check') { Say ''; Ok 'check xong (khong thay doi gi).'; exit 0 }

  # --- start ---
  foreach ($f in @($caddy, $cert, $key)) { if (-not (Test-Path -LiteralPath $f)) { Fail ('Thieu ' + $f + ' - chay -Step check va lam theo runbook.') } }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\main.js')) -or -not (Test-Path -LiteralPath (Join-Path $fe 'dist\index.html'))) { Fail 'Thieu ban build (demo-setup.bat -Build).' }
  if ((Test-Http ('http://127.0.0.1:' + $ApiPort + '/api/v1/health')) -ne 0) { Fail ('Cong ' + $ApiPort + ' dang co dich vu. Dong cua so backend cu truoc.') }
  if ((Test-Http 'http://127.0.0.1:4173/') -ne 0) { Fail 'Cong 4173 dang co dich vu. Dong cua so giao dien cu truoc.' }
  if ((Test-HttpsNoVerify ($origin + '/')) -ne 0) { Fail ('Cong ' + $LanPort + ' dang co dich vu. Dong cua so Caddy cu truoc.') }
  [System.IO.File]::WriteAllText($caddyfile, $cf + "`n", (New-Object System.Text.UTF8Encoding $false))
  & $caddy validate --config $caddyfile --adapter caddyfile | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'Caddyfile khong hop le (caddy validate).' }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'demo-pg.ps1') -Step start -PgPort $PgPort -DataDir $DataDir | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'Khong khoi dong duoc cum PostgreSQL demo.' }

  Say ('Mo backend (cua so rieng, COOKIE_SECURE=true, TRUST_PROXY=loopback, origin ' + $origin + ') ...') 'Cyan'
  $beArgs = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', ("`$host.UI.RawUI.WindowTitle = 'SISCOM demo backend (LAN)'; & '" + (Join-Path $PSScriptRoot 'auth-demo-stack.ps1') + "' -Step start -DatabaseName " + $DatabaseName + ' -PgPort ' + $PgPort + ' -Port ' + $ApiPort + ' -Origins ' + $origin + ' -CookieSecure -TrustProxy loopback -NonInteractive'))
  Start-Process -FilePath 'powershell.exe' -ArgumentList $beArgs | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) { if ((Test-Http ('http://127.0.0.1:' + $ApiPort + '/api/v1/health/database')) -eq 200) { $ok = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { Fail 'Backend khong len sau 60 giay: xem cua so "SISCOM demo backend (LAN)".' }
  Ok 'Backend len (chi 127.0.0.1).'

  Say 'Mo giao dien (cua so rieng, chi 127.0.0.1:4173) ...' 'Cyan'
  $feCmd = "title SISCOM demo web && cd /d `"" + $fe + "`" && set `"VITE_DEV_API_TARGET=http://127.0.0.1:" + $ApiPort + "`" && npx.cmd vite preview --port 4173 --strictPort --host 127.0.0.1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $feCmd) | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) { if ((Test-Http 'http://127.0.0.1:4173/') -eq 200) { $ok = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { Fail 'Giao dien khong len sau 40 giay: xem cua so "SISCOM demo web".' }

  Say ('Mo Caddy (cua so rieng) nghe ' + $origin + ' ...') 'Cyan'
  # Chay caddy.exe TRUC TIEP (khong qua cmd /k) de giu duoc tien trinh va dung ngay neu tu kiem cong that bai.
  $caddyProc = Start-Process -FilePath $caddy -ArgumentList @('run', '--config', $caddyfile, '--adapter', 'caddyfile') -PassThru
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) { if ($caddyProc.HasExited) { break }; if ((Test-HttpsNoVerify ($origin + '/api/v1/health')) -eq 200) { $ok = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { if (-not $caddyProc.HasExited) { Stop-Process -Id $caddyProc.Id -Force -ErrorAction SilentlyContinue }; Fail 'Caddy khong len sau 30 giay (da dung Caddy). Chay thu tay: caddy run --config <Caddyfile> de xem loi. (Neu Windows hoi "cho phep qua tuong lua": bam HUY - quy tac hep do owner tao rieng.)' }

  # Kiem tra lang nghe: chi Caddy tren IP Wi-Fi; backend/giao dien/PostgreSQL chi loopback. Sai => DUNG CADDY NGAY roi bao loi.
  $listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @($ApiPort, 4173, $PgPort, $LanPort) })
  $bad = @($listen | Where-Object { ($_.LocalPort -ne $LanPort -and $_.LocalAddress -notin @('127.0.0.1', '::1')) -or ($_.LocalPort -eq $LanPort -and $_.LocalAddress -ne $ip) })
  foreach ($l in $listen) { Say ('  nghe ' + $l.LocalAddress + ':' + $l.LocalPort) }
  if ($bad.Count -gt 0) {
    if (-not $caddyProc.HasExited) { Stop-Process -Id $caddyProc.Id -Force -ErrorAction SilentlyContinue }
    Fail 'CO CONG NGHE NGOAI DU KIEN (xem danh sach tren). Da DUNG Caddy; hay dong cua so backend/web va kiem lai cau hinh.'
  }
  Ok ('Chi ' + $ip + ':' + $LanPort + ' mo ra Wi-Fi; cac dich vu con lai chi loopback.')
  Say ''
  Say ('Dien thoai (da cai CA ' + $ca + '): mo ' + $origin) 'Cyan'
  Say ('May tinh nay: cung mo ' + $origin + ' (cookie Secure; http://127.0.0.1:4173 khong dung trong buoi thu).')
  Say ('Tai khoan demo: ' + (Join-Path $priv ('accounts-' + $DatabaseName + '.txt')))
  Say ('Ket thuc: dong cua so Caddy (PID ' + $caddyProc.Id + '), backend, web; Disable-NetFirewallRule -DisplayName "' + $ruleName + '"; roi demo-pg.bat -Step stop.')
  if (-not $NoBrowser) { Start-Process $origin | Out-Null }
} catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
