# SISCOM CRM - cac HAM BAO VE thuan (khong ket noi database, khong doc .env, khong hoi mat khau) cua make-stats-clone.ps1.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\make-stats-clone.guards.ps1 (file moi, dat CUNG thu muc voi make-stats-clone.ps1).
# Duoc make-stats-clone.ps1 nap bang dot-source; cung duoc kiem thu offline bang tests\make-stats-clone.guards.tests.ps1.
# Quy tac: so khop CHI BANG chu so ASCII [0-9], phan biet hoa/thuong (-cmatch/-ceq), neo cuoi chuoi nghiem ngat \z (khong chap nhan xuong dong cuoi).
$script:RESTORE_DB_PATTERN = '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z'
# Cac database da khoa lam baseline: khong bao gio duoc la BAN SAO (dich). Dung lam NGUON (template) thi hop le vi chi doc.
$script:CLONE_DENY = @('siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948')

function Guard-Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }

function Test-RestoreDbName([string]$name) {
  if ([string]::IsNullOrEmpty($name)) { return $false }
  return ($name -cmatch $script:RESTORE_DB_PATTERN)
}

# Ten nguon/ban sao: sai dinh dang, trung nhau, hoac ban sao nam trong danh sach khoa -> that bai (fail-closed).
function Assert-CloneNames([string]$source, [string]$clone) {
  if (-not (Test-RestoreDbName $source)) { Guard-Fail 'Database nguon phai la siscom_crm_restore_YYYYMMDD_HHMMSS (chi chu so ASCII 0-9, chu thuong, khong ky tu thua). siscom_crm_dev bi tu choi.' }
  if (-not (Test-RestoreDbName $clone)) { Guard-Fail 'Ten ban sao phai la siscom_crm_restore_YYYYMMDD_HHMMSS (chi chu so ASCII 0-9, chu thuong, khong ky tu thua).' }
  if ($source -ceq $clone) { Guard-Fail 'Ten ban sao trung database nguon.' }
  if ($script:CLONE_DENY -ccontains $clone) { Guard-Fail ('CAM: "' + $clone + '" la database da khoa/baseline, khong duoc dung lam ban sao.') }
}

# Ten ban sao mac dinh: luon chu so ASCII, khong phu thuoc locale/lich cua may (vd ar-SA, th-TH).
function New-CloneTimestamp() {
  return (Get-Date).ToString('yyyyMMdd_HHmmss', [System.Globalization.CultureInfo]::InvariantCulture)
}

# Phan tich gia tri DATABASE_URL (chuoi da bo dau nhay) va tra mat khau siscom_app. Chi doc chuoi duoc truyen vao.
# Fail-closed: scheme, user, host 127.0.0.1, port 5432, database siscom_crm_dev (chi de doi chieu), co mat khau.
function Get-AppPasswordFromUrl([string]$val) {
  if ([string]::IsNullOrEmpty($val)) { Guard-Fail 'DATABASE_URL rong.' }
  $u = $null
  try { $u = New-Object System.Uri -ArgumentList $val } catch { Guard-Fail 'DATABASE_URL trong .env khong phai URL hop le (noi dung bi an).' }
  if (@('postgresql', 'postgres') -cnotcontains $u.Scheme) { Guard-Fail 'DATABASE_URL khong dung giao thuc postgresql://.' }
  $ui = $u.UserInfo; $ix = $ui.IndexOf(':')
  if ($ix -lt 1) { Guard-Fail 'DATABASE_URL khong co dang user:matkhau.' }
  $user = [uri]::UnescapeDataString($ui.Substring(0, $ix)); $pw = [uri]::UnescapeDataString($ui.Substring($ix + 1))
  $port = $u.Port; if ($port -lt 0) { $port = 5432 }
  $src = [uri]::UnescapeDataString($u.AbsolutePath.TrimStart('/'))
  if ($user -cne 'siscom_app') { Guard-Fail ('DATABASE_URL dung user "' + $user + '", can siscom_app.') }
  if ($u.Host -cne '127.0.0.1') { Guard-Fail ('DATABASE_URL dung host "' + $u.Host + '", can 127.0.0.1.') }
  if ($port -ne 5432) { Guard-Fail ('DATABASE_URL dung port ' + $port + ', can 5432.') }
  if ($src -cne 'siscom_crm_dev') { Guard-Fail ('DATABASE_URL tro toi database "' + $src + '", ky vong siscom_crm_dev (chi de lay mat khau, KHONG dung lam dich).') }
  if (-not $pw) { Guard-Fail 'DATABASE_URL khong co mat khau.' }
  return $pw
}
