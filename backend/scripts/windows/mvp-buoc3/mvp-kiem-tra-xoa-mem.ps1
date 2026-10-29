# Nghiem thu MVP - kiem tra XOA MEM / KHOI PHUC qua API that (bien ban docs/B1.3_MVP_ACCEPTANCE.md, buoc 3).
# - Hoi email + mat khau (nhap an, KHONG in, KHONG ghi file). Dang nhap bang cookie phien + CSRF nhu giao dien.
# - DELETE /customers/:id dang KHOA theo quyet dinh N2 (hop dong API §3.4): sau khi qua xac thuc/quyen/pham vi LUON tra 409 DELETE_LINKS_UNVERIFIED.
#   => Ky vong: crm_admin: DELETE 409 DELETE_LINKS_UNVERIFIED; restore khach dang hoat dong 409 CUSTOMER_NOT_DELETED.
#               ketoan/kythuat: DELETE 403 FORBIDDEN; sale: DELETE 403 (khong co customer.delete).
# - Khong tao, khong sua, khong xoa du lieu (moi loi goi ghi deu bi tu choi truoc khi ghi).
# - BANG CHUNG: moi dong ket qua (khong co mat khau, cookie, token) + ten header da gui cua tung lan goi duoc ghi ra
#   <OutDir>\mvp-buoc3-xoa-mem-<ma NV>-<thoi gian UTC>.txt de dua vao bien ban.
# - Sua 2026-10-29 (regression, xem selftest\run-selftest.ps1): tren Windows PowerShell 5.1
#   (a) body cua phan hoi loi da bi Invoke-WebRequest doc het => lay tu $_.ErrorDetails.Message (fallback: tua lai dau luong);
#   (b) -Headers bi luu vao WebSession.Headers va tu dong gui lai o lan sau => xoa truoc moi lan goi, de lan "khong CSRF" that su khong co header.
# - -SelfTest: CHI cho bo tu kiem tren API GIA (selftest\fake-api.cjs): dung tai khoan/mat khau gia, khong hoi gi.
param(
  [string]$Api = 'http://127.0.0.1:3000/api/v1',
  [string]$Origin = 'http://127.0.0.1:4175',
  [string]$CustomerCode = 'KH-00013',
  [string]$OutDir = 'D:\SISCOM-CRM-mvp\docs\evidence',
  [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$script:lines = New-Object System.Collections.Generic.List[string]
$script:fails = 0
$script:who = 'chua-dang-nhap'
$script:stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c; $script:lines.Add($m) }
function Pass([string]$m) { Say ('[PASS] ' + $m) 'Green' }
function Failm([string]$m) { Say ('[FAIL] ' + $m) 'Red'; $script:fails++ }
function Finish() {
  Say ''
  if ($script:fails -eq 0) { Say ('KET QUA BUOC 3 (' + $script:who + '): PASS (xoa mem dang khoa theo N2, khoi phuc tu choi dung, CSRF dung).') 'Green' }
  else { Say ('KET QUA BUOC 3 (' + $script:who + '): FAIL ' + $script:fails + ' muc.') 'Red' }
  try {
    if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
    $f = Join-Path $OutDir ('mvp-buoc3-xoa-mem-' + $script:who + '-' + $script:stamp + '.txt')
    $hdr = @('# MVP BUOC 3 - XOA MEM / KHOI PHUC qua API that - ' + $script:stamp + ' (UTC)', '# API ' + $Api + ' | Origin ' + $Origin + ' | khach thu ' + $CustomerCode + ' | khong ghi mat khau/cookie/token' + $(if ($SelfTest) { ' | SELFTEST (API gia)' } else { '' }), '')
    ($hdr + $script:lines) -join "`n" | Out-File -FilePath $f -Encoding utf8
    Write-Host ('[DAT] Da ghi bang chung: ' + $f) -ForegroundColor Cyan
  } catch { Write-Host ('[LOI] Khong ghi duoc file bang chung: ' + $_.Exception.Message) -ForegroundColor Red }
  exit $(if ($script:fails) { 1 } else { 0 })
}
# Doc body cua phan hoi loi (PS 5.1): Invoke-WebRequest da doc het luong de dien ErrorDetails; neu rong thi tua ve dau luong va doc lai.
function ErrorBody($errRecord) {
  $txt = [string]$errRecord.ErrorDetails.Message
  if ($txt) { return $txt }
  $resp = $errRecord.Exception.Response
  if ($null -eq $resp) { return '' }
  try {
    $st = $resp.GetResponseStream()
    if ($st.CanSeek) { $st.Position = 0 }
    $sr = New-Object System.IO.StreamReader($st); $txt = $sr.ReadToEnd(); $sr.Close()
  } catch { $txt = '' }
  return [string]$txt
}
function Call([string]$method, [string]$path, $body, [string]$csrf) {
  $h = @{ 'Origin' = $Origin; 'Accept' = 'application/json' }
  if ($csrf) { $h['X-CSRF-Token'] = $csrf }
  $script:ws.Headers.Clear()  # PS 5.1 luu -Headers vao WebSession va gui lai o lan sau => chi gui dung header cua lan nay
  $req = @{ Uri = ($Api + $path); Method = $method; Headers = $h; WebSession = $script:ws; UseBasicParsing = $true }
  if ($null -ne $body) { $req['ContentType'] = 'application/json; charset=utf-8'; $req['Body'] = ($body | ConvertTo-Json -Compress) }
  $sent = ($h.Keys | Sort-Object) -join ','
  try { $r = Invoke-WebRequest @req; $res = @{ status = [int]$r.StatusCode; body = $r.Content } }
  catch {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { throw }
    $res = @{ status = [int]$resp.StatusCode; body = (ErrorBody $_) }
  }
  $script:lines.Add('  > ' + $method + ' ' + $path + ' [header: ' + $sent + '] => HTTP ' + $res.status)
  return $res
}
function Code($res) { try { return [string]((ConvertFrom-Json $res.body).error.code) } catch { return '' } }

if ($SelfTest) { $email = 'selftest@siscom.local'; $sec = ConvertTo-SecureString 'selftest-gia-khong-dung-that' -AsPlainText -Force }
else { $email = Read-Host 'Email tai khoan thu (vd admin@siscom.local)'; $sec = Read-Host 'Mat khau (nhap an)' -AsSecureString }
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
$script:ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$r = Call 'POST' '/auth/login' @{ login = $email; password = $pw } $null
$pw = $null; $sec = $null
if ($r.status -ne 200) { Failm ('Dang nhap that bai: HTTP ' + $r.status + ' ' + (Code $r)); Finish }
$login = ConvertFrom-Json $r.body
$csrf = $login.data.csrfToken
$me = $login.data.me
$script:who = [string]$me.code
Pass ('Dang nhap: ' + $me.fullName + ' (' + $me.code + ') vai tro DB ' + (($me.roles) -join ','))
$perm = @{}
if ($me.permissions) { foreach ($p in $me.permissions.PSObject.Properties) { $perm[$p.Name] = $p.Value } }
$hasDelete = $perm.ContainsKey('customer.delete')
Say ('Quyen customer.delete: ' + $(if ($hasDelete) { $perm['customer.delete'] } else { 'KHONG CO' }) + ' | customer.restore: ' + $(if ($perm.ContainsKey('customer.restore')) { $perm['customer.restore'] } else { 'KHONG CO' }))

$r = Call 'GET' ('/customers?search=' + [uri]::EscapeDataString($CustomerCode) + '&pageSize=5') $null $null
if ($r.status -ne 200) { Failm ('GET /customers: HTTP ' + $r.status + ' ' + (Code $r)); Call 'POST' '/auth/logout' $null $csrf | Out-Null; Finish }
$items = (ConvertFrom-Json $r.body).data.items
$target = $items | Where-Object { $_.code -eq $CustomerCode } | Select-Object -First 1
if (-not $target) {
  if ($hasDelete) { Failm ('Khong thay ' + $CustomerCode + ' trong pham vi doc (admin phai thay).') }
  else { Pass ('Khong thay ' + $CustomerCode + ' trong danh sach (ngoai pham vi doc cua vai tro nay) - dung thiet ke.') }
  $r2 = Call 'GET' '/customers?pageSize=1' $null $null
  $target = if ($r2.status -eq 200) { (ConvertFrom-Json $r2.body).data.items | Select-Object -First 1 } else { $null }
  if (-not $target) { Say 'Vai tro nay khong thay khach nao => bo qua DELETE/restore.' 'Yellow'; Call 'POST' '/auth/logout' $null $csrf | Out-Null; Finish }
}
Say ('Khach thu: ' + $target.code + ' (id ' + $target.id + ')')

$d = Call 'DELETE' ('/customers/' + $target.id) $null $csrf
$dc = Code $d
if ($hasDelete) {
  if ($d.status -eq 409 -and $dc -eq 'DELETE_LINKS_UNVERIFIED') { Pass ('DELETE => 409 DELETE_LINKS_UNVERIFIED (xoa mem dang KHOA theo N2, khong xoa gi)') }
  else { Failm ('DELETE => HTTP ' + $d.status + ' ' + $dc + ' (ky vong 409 DELETE_LINKS_UNVERIFIED)') }
} else {
  if ($d.status -eq 403) { Pass ('DELETE => 403 ' + $dc + ' (vai tro khong co customer.delete)') }
  elseif ($d.status -eq 404) { Pass ('DELETE => 404 (ngoai pham vi doc)') }
  else { Failm ('DELETE => HTTP ' + $d.status + ' ' + $dc + ' (ky vong 403/404)') }
}

$g = Call 'GET' ('/customers/' + $target.id) $null $null
if ($g.status -eq 200 -and (-not (ConvertFrom-Json $g.body).data.deletedAt)) { Pass 'Sau DELETE: khach van con (deletedAt trong) - khong co du lieu bi xoa' }
elseif ($g.status -eq 404 -and -not $hasDelete) { Pass 'GET chi tiet => 404 (ngoai pham vi doc)' }
else { Failm ('GET sau DELETE: HTTP ' + $g.status + ' ' + (Code $g)) }

$s = Call 'POST' ('/customers/' + $target.id + '/restore') $null $csrf
$sc = Code $s
if ($perm.ContainsKey('customer.restore')) {
  if ($s.status -eq 409 -and $sc -eq 'CUSTOMER_NOT_DELETED') { Pass 'restore khach dang hoat dong => 409 CUSTOMER_NOT_DELETED' }
  else { Failm ('restore => HTTP ' + $s.status + ' ' + $sc + ' (ky vong 409 CUSTOMER_NOT_DELETED)') }
} else {
  if ($s.status -eq 403 -or $s.status -eq 404) { Pass ('restore => ' + $s.status + ' ' + $sc + ' (khong co quyen/ngoai pham vi)') }
  else { Failm ('restore => HTTP ' + $s.status + ' ' + $sc + ' (ky vong 403/404)') }
}

$n = Call 'DELETE' ('/customers/' + $target.id) $null $null
if ($n.status -eq 403 -and (Code $n) -eq 'CSRF_FAILED') { Pass 'DELETE khong co X-CSRF-Token => 403 CSRF_FAILED' } else { Failm ('DELETE khong CSRF => HTTP ' + $n.status + ' ' + (Code $n) + ' (ky vong 403 CSRF_FAILED)') }

$o = Call 'POST' '/auth/logout' $null $csrf
if ($o.status -eq 200 -or $o.status -eq 204) { Pass 'Dang xuat' } else { Failm ('Dang xuat: HTTP ' + $o.status) }
Finish
