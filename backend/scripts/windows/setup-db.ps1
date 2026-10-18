# SISCOM CRM - Thiet lap database PostgreSQL cuc bo (B1.1)
# - Chi TAO moi cai chua co. Khong DROP / TRUNCATE / DELETE / RESET. Chay lai nhieu lan an toan.
# - Khong in / khong ghi log mat khau. Khong dung Start-Transcript khi chay script nay.
# - Mat khau role chi bi doi khi ban chu dong dung -ResetAppPassword VA go cum tu xac nhan.
#
# Cach dung:
#   setup-db.bat                       thiet lap binh thuong
#   setup-db.bat -Check                CHI DOC: cho biet se lam gi, khong thay doi gi
#   setup-db.bat -ResetAppPassword     dat lai mat khau siscom_app (can xac nhan ro rang)
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$ResetAppPassword
)
$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $backendRoot '.env'
$appRole = 'siscom_app'
$dbNames = @('siscom_crm_dev', 'siscom_crm_dev_shadow')
$pgHost = '127.0.0.1'
$pgPort = 5432
$script:psql = $null
$script:adminPw = $null
$script:tmpEnv = $null
$script:failed = $false

function Fail([string]$message) {
  throw (New-Object System.ApplicationException -ArgumentList $message)
}
function Info([string]$m) { Write-Host ('[OK] ' + $m) }
function Warn([string]$m) { Write-Host ('[CANH BAO] ' + $m) -ForegroundColor Yellow }

function Confirm-Explicit([string]$question, [string]$phrase) {
  Write-Host $question -ForegroundColor Yellow
  $a = Read-Host ('Go dung cum tu "' + $phrase + '" de dong y (Enter = huy)')
  return ($a -ceq $phrase)
}

function Find-Psql {
  $c = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $dirs = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
  foreach ($d in $dirs) {
    $p = Join-Path $d.FullName 'bin\psql.exe'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function New-StrongPassword {
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
}

# Chay psql, SQL di qua stdin. Loi chi tiet cua psql bi AN (co the chua cau lenh co mat khau).
function Invoke-Psql([string]$user, [string]$pw, [string]$db, [string]$sql, [switch]$Scalar) {
  $env:PGPASSWORD = $pw
  $env:PGCLIENTENCODING = 'UTF8'
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = $null
  $code = 1
  try {
    $a = @('-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', $pgHost, '-p', [string]$pgPort, '-U', $user, '-d', $db)
    if ($Scalar) { $a += @('-t', '-A') }
    $a += @('-f', '-')
    $out = $sql | & $script:psql @a 2>$null
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $prev
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  if ($code -ne 0) {
    Fail ('psql bao loi (ma ' + $code + ') tren database "' + $db + '" voi tai khoan "' + $user + '". Kiem tra mat khau, dich vu PostgreSQL va cong 5432. Chi tiet loi duoc an de khong lo mat khau.')
  }
  return (($out | Out-String).Trim())
}

function Test-Login([string]$user, [string]$pw, [string]$db) {
  try { Invoke-Psql $user $pw $db 'SELECT 1;' -Scalar | Out-Null; return $true }
  catch { return $false }
}

# Doc thong tin dang nhap tu .env. Khong bao gio in noi dung loi (co the chua mat khau).
function Read-EnvCreds([string]$path) {
  try {
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
    if (-not $line) { return $null }
    $u = New-Object System.Uri -ArgumentList $line.Substring(13)
    $parts = $u.UserInfo.Split(':', 2)
    if ($parts.Length -lt 2) { return $null }
    return @{ User = [uri]::UnescapeDataString($parts[0]); Pw = [uri]::UnescapeDataString($parts[1]); Db = $u.AbsolutePath.TrimStart('/') }
  }
  catch { return $null }
}

function Step-Change([string]$desc, [scriptblock]$action) {
  if ($Check) {
    Write-Host ('[SE LAM - che do -Check khong thuc hien] ' + $desc) -ForegroundColor DarkYellow
    return
  }
  & $action
  Info $desc
}

# ---- Bao ve file .env bang icacls theo SID chinh xac cua tai khoan Windows hien tai ----
function Assert-FileProtected([string]$path, $sid) {
  $acl = Get-Acl -LiteralPath $path
  if (-not $acl.AreAccessRulesProtected) { Fail ('Quyen cua "' + $path + '" van con ke thua tu thu muc cha.') }
  $allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
  $hasUser = $false
  foreach ($r in $acl.Access) {
    $v = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($allowed -notcontains $v) { Fail ('File co quyen cho tai khoan khac (SID ' + $v + '). Khong chap nhan.') }
    if ($v -eq $sid.Value -and $r.AccessControlType -eq 'Allow') { $hasUser = $true }
  }
  if (-not $hasUser) { Fail 'Tai khoan Windows hien tai khong con quyen tren file.' }
}

function Protect-File([string]$path) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $null = & icacls.exe $path '/inheritance:r' '/grant:r' ('*' + $sid.Value + ':(F)') 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail ('Khong bao ve duoc file bang icacls (ma ' + $LASTEXITCODE + '). Khong ghi mat khau vao dia. Cach khac phuc: (1) chay lai bang tai khoan Windows thuong, khong dung "Run as administrator" cua tai khoan khac; (2) dam bao thu muc backend nam tren o NTFS (vi du C:\dev), khong phai thu muc dong bo/USB FAT; (3) chuot phai thu muc > Properties > Security de kiem tra quyen ghi.')
  }
  Assert-FileProtected $path $sid
}

# Tao file tam RONG va bao ve TRUOC khi dung toi database, de neu loi thi chua mat gi.
function New-SecureTempFile([string]$target) {
  $tmp = $target + '.tmp'
  if (Test-Path -LiteralPath $tmp) { Fail ('Tep tam "' + $tmp + '" da ton tai (lan chay truoc bi gian doan?). Hay kiem tra va xoa thu cong roi chay lai.') }
  New-Item -ItemType File -Path $tmp | Out-Null
  $script:tmpEnv = $tmp
  Protect-File $tmp
  return $tmp
}

function Save-SecureEnv([string]$tmp, [string]$target, [string]$text) {
  [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $target -Force
  $script:tmpEnv = $null
  Assert-FileProtected $target ([Security.Principal.WindowsIdentity]::GetCurrent().User)
}

try {
  Write-Host '=== SISCOM CRM - thiet lap database phat trien ===' -ForegroundColor Cyan
  if ($Check) { Write-Host 'CHE DO KIEM TRA (-Check): chi doc, KHONG thay doi gi.' -ForegroundColor Cyan }
  if ($backendRoot -match 'Dropbox|OneDrive') { Warn 'Thu muc backend nam trong Dropbox/OneDrive: file .env se bi dong bo len may khac. Nen chuyen ra C:\dev.' }

  $script:psql = Find-Psql
  if (-not $script:psql) { Fail 'Khong tim thay psql.exe. Hay cai PostgreSQL (xem docs\WINDOWS_SETUP.md).' }
  Write-Host ('Dung psql: ' + $script:psql)

  $script:adminPw = Read-Secret 'Nhap mat khau tai khoan postgres (chi doc/tao khi can; khong luu lai)'
  $ver = Invoke-Psql 'postgres' $script:adminPw 'postgres' 'SELECT version();' -Scalar
  Info ('Ket noi PostgreSQL: ' + ($ver -split ',')[0])
  $listen = Invoke-Psql 'postgres' $script:adminPw 'postgres' 'SHOW listen_addresses;' -Scalar
  if ($listen -match '^(localhost|127\.0\.0\.1|::1)(,\s*(localhost|127\.0\.0\.1|::1))*$') { Info ('listen_addresses = ' + $listen + ' (chi may nay)') }
  else { Warn ('listen_addresses = ' + $listen + '. Nen dat localhost trong postgresql.conf va khong mo cong 5432 tren Firewall.') }

  # ===== PREFLIGHT: chi doc, kiem tra het truoc khi thay doi bat ky thu gi =====
  $envExists = Test-Path -LiteralPath $envPath
  $roleRow = Invoke-Psql 'postgres' $script:adminPw 'postgres' ("SELECT rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text FROM pg_roles WHERE rolname='" + $appRole + "';") -Scalar
  $roleExists = [bool]$roleRow
  if ($roleExists) {
    $rf = $roleRow.Split('|')
    if ($rf[0] -eq 'true' -or $rf[1] -eq 'true' -or $rf[2] -eq 'true') {
      Fail ('Tai khoan "' + $appRole + '" da ton tai nhung co quyen qua cao (superuser/createdb/createrole). Script KHONG tu sua. Hay nho quan tri vien PostgreSQL xu ly thu cong.')
    }
  }

  $dbPlan = @()
  foreach ($n in $dbNames) {
    $row = Invoke-Psql 'postgres' $script:adminPw 'postgres' ("SELECT pg_get_userbyid(datdba) || '|' || datallowconn::text || '|' || datistemplate::text || '|' || COALESCE(datacl::text, '<null>') FROM pg_database WHERE datname='" + $n + "';") -Scalar
    if (-not $row) { $dbPlan += @{ Name = $n; Exists = $false; Revoke = $true }; continue }
    $f = $row.Split('|')
    if ($f[0] -ne $appRole) { Fail ('Database "' + $n + '" da ton tai nhung do tai khoan "' + $f[0] + '" so huu, khong phai "' + $appRole + '". Script KHONG thay doi no. Hay doi ten database trong script/.env hoac xu ly thu cong.') }
    if ($f[1] -ne 'true') { Fail ('Database "' + $n + '" khong cho phep ket noi (datallowconn=false). Script KHONG thay doi no.') }
    if ($f[2] -eq 'true') { Fail ('"' + $n + '" la database mau (template). Khong dung.') }
    $publicOpen = ($f[3] -eq '<null>') -or ($f[3] -cmatch '(^|[{,])=[A-Za-z]*c')
    $revoke = $false
    if ($publicOpen) {
      Warn ('Database "' + $n + '" da ton tai va moi nguoi (PUBLIC) van co quyen CONNECT. Day khong phai do script tao nen script khong tu y thay doi.')
      if (-not $Check) { $revoke = Confirm-Explicit ('Thu hoi quyen CONNECT cua PUBLIC tren "' + $n + '" va chi cho "' + $appRole + '" ket noi?') 'THU HOI PUBLIC' }
    }
    else { Info ('Database "' + $n + '" da ton tai, chu so huu dung, quyen truy cap da han che - giu nguyen.') }
    $dbPlan += @{ Name = $n; Exists = $true; Revoke = $revoke }
  }

  # Quyet dinh ve tai khoan + .env
  $needNewCreds = $false
  $resetRole = $false
  $creds = $null
  if (-not $roleExists) { $needNewCreds = $true }
  else {
    if ($envExists) { $creds = Read-EnvCreds $envPath }
    $loginOk = $false
    if ($creds -and $creds.User -eq $appRole) { $loginOk = Test-Login $creds.User $creds.Pw $creds.Db }
    if ($loginOk) { Info 'Tai khoan siscom_app da ton tai va .env hien tai dang nhap duoc - giu nguyen mat khau, khong ghi de .env.' }
    elseif ($ResetAppPassword) { $needNewCreds = $true; $resetRole = $true }
    else {
      if ($envExists) { $why = 'file .env hien co khong dang nhap duoc bang tai khoan siscom_app (sai mat khau hoac thong tin khac)' }
      else { $why = 'chua co file .env de biet mat khau' }
      Fail ('Tai khoan "' + $appRole + '" da ton tai nhung ' + $why + '. Script KHONG tu doi mat khau. Neu ban chac chan muon dat mat khau MOI cho siscom_app (cac noi dang dung mat khau cu se hong), chay lai: setup-db.bat -ResetAppPassword  (se yeu cau xac nhan ro rang). Hoac dung -Check de chi xem.')
    }
  }

  # ===== XAC NHAN + CHUAN BI (truoc khi thay doi database) =====
  $appPw = $null
  $tmp = $null
  if ($needNewCreds -and -not $Check) {
    if ($resetRole -and -not (Confirm-Explicit ('Ban sap DAT LAI mat khau cua tai khoan "' + $appRole + '". Moi ung dung dang dung mat khau cu se khong ket noi duoc nua.') 'DOI MAT KHAU')) { Fail 'Da huy theo yeu cau. Khong co gi bi thay doi.' }
    if ($envExists -and -not (Confirm-Explicit ('File .env hien co se bi GHI DE bang cau hinh moi (cac chinh sua tuy chinh nhu PORT/CORS se mat).') 'GHI DE ENV')) { Fail 'Da huy theo yeu cau. Khong co gi bi thay doi.' }
    $tmp = New-SecureTempFile $envPath
    Info 'Da kiem tra: co the bao ve file .env (chi tai khoan Windows hien tai).'
    $typed = Read-Secret 'Enter = TU SINH mat khau manh (khuyen nghi). Hoac go mat khau rieng (>= 14 ky tu, khong co dau nhay, dau gach cheo nguoc, khoang trang)'
    if ([string]::IsNullOrEmpty($typed)) { $appPw = New-StrongPassword }
    else {
      if ($typed.Length -lt 14 -or $typed -match '[''"\\\s]') { Fail 'Mat khau khong hop le (qua ngan hoac chua ky tu khong cho phep).' }
      $appPw = $typed
    }
  }

  # ===== THUC HIEN (chi them moi) =====
  if ($needNewCreds) {
    if (-not $roleExists) {
      Step-Change ('Tao tai khoan ' + $appRole + ' (khong phai superuser)') {
        Invoke-Psql 'postgres' $script:adminPw 'postgres' ('CREATE ROLE ' + $appRole + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ''' + $appPw + ''';') | Out-Null
      }
    }
    else {
      Step-Change ('Dat lai mat khau tai khoan ' + $appRole + ' (da xac nhan)') {
        Invoke-Psql 'postgres' $script:adminPw 'postgres' ('ALTER ROLE ' + $appRole + ' WITH PASSWORD ''' + $appPw + ''';') | Out-Null
      }
    }
  }

  foreach ($p in $dbPlan) {
    $n = $p.Name
    if (-not $p.Exists) {
      Step-Change ('Tao database ' + $n + ' (chu so huu ' + $appRole + ')') {
        Invoke-Psql 'postgres' $script:adminPw 'postgres' ('CREATE DATABASE ' + $n + ' OWNER ' + $appRole + ';') | Out-Null
      }
    }
    if ($p.Revoke) {
      Step-Change ('Han che quyen truy cap database ' + $n + ' (chi ' + $appRole + ' duoc CONNECT)') {
        Invoke-Psql 'postgres' $script:adminPw 'postgres' ('REVOKE ALL ON DATABASE ' + $n + ' FROM PUBLIC; GRANT CONNECT ON DATABASE ' + $n + ' TO ' + $appRole + ';') | Out-Null
      }
    }
  }

  if (-not $Check -or $dbPlan[0].Exists) {
    $enc = Invoke-Psql 'postgres' $script:adminPw 'postgres' ("SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname='" + $dbNames[0] + "';") -Scalar
    if ($enc -ne 'UTF8') { Fail ('Database dung ma hoa ' + $enc + ', can UTF8 de luu tieng Viet. Script khong thay doi gi them. Xem docs\WINDOWS_SETUP.md muc Su co.') }
    Info 'Ma hoa database: UTF8'
  }

  if ($needNewCreds -and -not $Check) {
    $e = [uri]::EscapeDataString($appPw)
    $nl = [Environment]::NewLine
    $text = '# Tao boi setup-db.ps1. KHONG chia se, KHONG dua len Git.' + $nl +
      'NODE_ENV=development' + $nl + 'HOST=127.0.0.1' + $nl + 'PORT=3000' + $nl +
      ('DATABASE_URL=postgresql://' + $appRole + ':' + $e + '@' + $pgHost + ':' + $pgPort + '/' + $dbNames[0] + '?schema=public') + $nl +
      ('SHADOW_DATABASE_URL=postgresql://' + $appRole + ':' + $e + '@' + $pgHost + ':' + $pgPort + '/' + $dbNames[1] + '?schema=public') + $nl +
      'CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173' + $nl + 'LOG_LEVEL=log' + $nl
    Save-SecureEnv $tmp $envPath $text
    Info 'Da ghi file .env va xac minh: chi tai khoan Windows hien tai (va SYSTEM/Administrators) co quyen.'
  }

  # ===== XAC MINH CUOI =====
  $vpw = $appPw
  if (-not $vpw -and $creds) { $vpw = $creds.Pw }
  if ($vpw -and ($dbPlan[0].Exists -or -not $Check)) {
    $who = Invoke-Psql $appRole $vpw $dbNames[0] "SELECT current_user || ' | superuser=' || (SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user);" -Scalar
    Info ('Dang nhap bang tai khoan ung dung: ' + $who)
    if ($who -match 'superuser=true') { Fail 'Tai khoan ung dung la superuser - khong chap nhan.' }
    if (Test-Login $appRole $vpw $dbNames[1]) { Info 'Ket noi duoc database bong (shadow).' } else { Warn 'Khong ket noi duoc database bong - chua anh huong B1.1.' }
  }

  Write-Host ''
  if ($Check) { Write-Host 'Kiem tra xong - KHONG co gi bi thay doi.' -ForegroundColor Green }
  else { Write-Host 'Xong. Buoc tiep theo: npm install  ->  npm run db:migrate  ->  npm run build  ->  npm run start:dev' -ForegroundColor Green }
}
catch {
  if ($_.Exception -is [System.ApplicationException]) {
    Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  }
  else {
    Write-Host ('[LOI] Loi khong mong doi (' + $_.Exception.GetType().Name + '). Chi tiet bi an de khong lo mat khau. Chay lai voi -Check hoac gui ten loi nay de duoc ho tro.') -ForegroundColor Red
  }
  $script:failed = $true
}
finally {
  if ($script:tmpEnv -and (Test-Path -LiteralPath $script:tmpEnv)) { Remove-Item -LiteralPath $script:tmpEnv -Force -ErrorAction SilentlyContinue }
  $script:adminPw = $null
  $appPw = $null
  $typed = $null
  $vpw = $null
  $creds = $null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if ($script:failed) { exit 1 }
