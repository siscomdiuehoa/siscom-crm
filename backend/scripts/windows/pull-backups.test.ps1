# SISCOM CRM - kiem thu OFFLINE cho pull-backups.ps1 (khong can VPS, khong can Google Drive): dung -SourceDir thay sftp,
# tao bo sao luu GIA ky bang khoa ed25519 tam. Chay duoc tren Windows PowerShell 5.1 va pwsh 7 (CI Ubuntu).
# Dung: powershell -NoProfile -ExecutionPolicy Bypass -File pull-backups.test.ps1   |   pwsh -NoProfile -File pull-backups.test.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'pull-backups.ps1'
$psExe = (Get-Process -Id $PID).Path
$pass = 0; $fail = 0
function Ok([string]$m) { $script:pass++; Write-Host "  ok   $m" }
function Bad([string]$m) { $script:fail++; Write-Host "  FAIL $m" }
function Check([bool]$c, [string]$m) { if ($c) { Ok $m } else { Bad $m } }

$keygen = $null
foreach ($c in @("$env:WINDIR\System32\OpenSSH\ssh-keygen.exe")) { if ($env:WINDIR -and (Test-Path -LiteralPath $c)) { $keygen = $c } }
if (-not $keygen) { $keygen = (Get-Command ssh-keygen).Source }
function Run([string]$exe, [string]$argString) {
  $p = Start-Process -FilePath $exe -ArgumentList $argString -NoNewWindow -Wait -PassThru -RedirectStandardOutput ([IO.Path]::GetTempFileName()) -RedirectStandardError ([IO.Path]::GetTempFileName())
  return $p.ExitCode
}
function Sha([string]$f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() }

$root = Join-Path ([IO.Path]::GetTempPath()) ('pbtest-' + [guid]::NewGuid().ToString('N'))
$src = Join-Path $root 'vps'; $drive = Join-Path $root 'Drive With Space'; $work = Join-Path $root 'work'
New-Item -ItemType Directory -Force -Path $src, $drive, $work | Out-Null
try {
  $key = Join-Path $root 'sign'; $evil = Join-Path $root 'evil'
  if ((Run $keygen ('-q -t ed25519 -N "" -C siscom-crm-backup -f "{0}"' -f $key)) -ne 0) { throw 'khong tao duoc khoa ky' }
  if ((Run $keygen ('-q -t ed25519 -N "" -C attacker -f "{0}"' -f $evil)) -ne 0) { throw 'khong tao duoc khoa la' }
  $pub = (Get-Content -LiteralPath "$key.pub" -Raw).Trim().Split(' ')
  [IO.File]::WriteAllText((Join-Path $drive 'backup-signing.allowed_signers'), ('siscom-crm-backup namespaces="siscom-crm-backup" {0} {1}' -f $pub[0], $pub[1]) + "`n")

  function New-Set([string]$db, [datetime]$utc, [string]$signKey = $key, [string]$dbInManifest = '', [switch]$NoSig, [switch]$Plain) {
    $stem = '{0}_{1}' -f $db, $utc.ToString('yyyyMMdd_HHmmss')
    $ext = $(if ($Plain) { '.dump' } else { '.dump.age' })
    $f = Join-Path $src ($stem + $ext)
    [IO.File]::WriteAllText($f, 'du lieu ' + $stem + ' ' + [guid]::NewGuid())
    $h = Sha $f
    [IO.File]::WriteAllText("$f.sha256", "$h  $stem$ext`n")
    $m = Join-Path $src "$stem.manifest"
    $dbm = $(if ($dbInManifest) { $dbInManifest } else { $db })
    [IO.File]::WriteAllText($m, ("db={0}`nrows|customer|3`nencrypted={1}`nfile={2}{3}`nfile_sha256={4}`n" -f $dbm, $(if ($Plain) { 0 } else { 1 }), $stem, $ext, $h))
    if (-not $NoSig) { if ((Run $keygen ('-Y sign -f "{0}" -n siscom-crm-backup "{1}"' -f $signKey, $m)) -ne 0) { throw "ky $m that bai" } }
    return $stem
  }
  function Pull() {
    $p = Start-Process -FilePath $psExe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -SourceDir "{1}" -DriveDir "{2}" -WorkDir "{3}"' -f $script, $src, $drive, $work) -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $root 'out.txt') -RedirectStandardError (Join-Path $root 'err.txt')
    $script:out = (Get-Content -LiteralPath (Join-Path $root 'out.txt') -Raw) + (Get-Content -LiteralPath (Join-Path $root 'err.txt') -Raw)
    foreach ($l in ($script:out -split "`r?`n")) { if ($l) { Write-Host "    | $l" } }
    return $p.ExitCode
  }
  $stg = Join-Path $drive 'staging'
  $now = (Get-Date).ToUniversalTime()

  Write-Host '== 1. Hai bo hop le moi => vao Drive, thoat 0 =='
  $a = New-Set 'siscom_crm_staging' $now.AddHours(-30)
  $b = New-Set 'siscom_crm_staging' $now.AddHours(-2)
  $rc = Pull
  Check ($rc -eq 0) "thoat 0 (rc=$rc)"
  foreach ($s in @($a, $b)) { foreach ($p in @('.dump.age', '.dump.age.sha256', '.manifest', '.manifest.sig')) { Check (Test-Path -LiteralPath (Join-Path $stg ($s + $p))) "Drive co $s$p" } }
  Check ((Sha (Join-Path $stg "$b.dump.age")) -eq (Sha (Join-Path $src "$b.dump.age"))) 'noi dung .dump.age tren Drive trung nguon'
  Check (@(Get-ChildItem -LiteralPath (Join-Path $work 'incoming') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'loi' }).Count -eq 0) 'khong de lai thu muc tam'

  Write-Host '== 2. Chay lai => khong them, khong ghi de =='
  $before = (Get-ChildItem -LiteralPath $stg | ForEach-Object { $_.Name + ':' + $_.LastWriteTimeUtc.Ticks }) -join ','
  $rc = Pull
  Check ($rc -eq 0) "chay lai thoat 0 (rc=$rc)"
  Check (((Get-ChildItem -LiteralPath $stg | ForEach-Object { $_.Name + ':' + $_.LastWriteTimeUtc.Ticks }) -join ',') -eq $before) 'Drive khong doi'

  Write-Host '== 3. Bo bi sua / ky khoa la / thieu chu ky / DB khac / plaintext =='
  $t1 = New-Set 'siscom_crm_staging' $now.AddMinutes(-90)
  Add-Content -LiteralPath (Join-Path $src "$t1.manifest") -Value 'rows|customer|4'          # sua SAU khi ky
  $t2 = New-Set 'siscom_crm_staging' $now.AddMinutes(-80) $evil                             # ky bang khoa la
  $t3 = New-Set 'siscom_crm_staging' $now.AddMinutes(-70) -NoSig                             # chua du tep (dang sao luu)
  $t4 = New-Set 'siscom_crm_staging' $now.AddMinutes(-60) $key 'siscom_crm_prod'            # manifest ghi DB khac
  $t5 = New-Set 'siscom_crm_staging' $now.AddMinutes(-50)
  [IO.File]::AppendAllText((Join-Path $src "$t5.dump.age"), 'X')                             # sua file sau khi ky
  $t6 = New-Set 'siscom_crm_staging' $now.AddMinutes(-40) -Plain                             # bo KHONG ma hoa
  $t7 = New-Set 'siscom_crm_prod' $now.AddMinutes(-30)                                       # DB khac (khong phai -Db)
  $rc = Pull
  Check ($rc -eq 1) "co bo loi => thoat 1 (rc=$rc)"
  foreach ($s in @($t1, $t2, $t4, $t5)) { Check (-not (Test-Path -LiteralPath (Join-Path $stg "$s.dump.age"))) "bo loi $s KHONG vao Drive"; Check ($out -match [regex]::Escape($s)) "log nhac $s" }
  Check (@(Get-ChildItem -LiteralPath (Join-Path (Join-Path $work 'incoming') 'loi') -Directory).Count -eq 4) '4 bo loi giu o incoming\loi'
  Check (-not (Test-Path -LiteralPath (Join-Path $stg "$t3.dump.age"))) 'bo chua du tep: chua vao Drive'
  Check ($out -match 'chua du tep') 'bo chua du tep: chi canh bao'
  Check (@(Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.dump' | Where-Object { $_.DirectoryName -ne $src }).Count -eq 0) 'KHONG tai tep .dump (khong ma hoa) o bat ky dau'
  Check (-not (Test-Path -LiteralPath (Join-Path $stg "$t7.dump.age"))) 'bo cua DB khac bi bo qua'

  Write-Host '== 4. Bo moi nhat qua cu (> 26 gio) => thoat 1, bao timer co the khong chay =='
  Remove-Item -LiteralPath $src -Recurse -Force; New-Item -ItemType Directory -Force -Path $src | Out-Null
  $null = New-Set 'siscom_crm_staging' $now.AddHours(-40)
  $rc = Pull
  Check ($rc -eq 1) "qua cu => thoat 1 (rc=$rc)"
  Check ($out -match 'KHONG chay') 'log bao timer co the khong chay'

  Write-Host '== 5. Thieu allowed_signers / thu muc Drive => thoat 1, khong tai gi =='
  Remove-Item -LiteralPath (Join-Path $drive 'backup-signing.allowed_signers') -Force
  $null = New-Set 'siscom_crm_staging' $now.AddMinutes(-5)
  $rc = Pull
  Check ($rc -eq 1) "thieu allowed_signers => thoat 1 (rc=$rc)"
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "Ket qua: $pass dat, $fail loi."
if ($fail -gt 0) { exit 1 } else { exit 0 }
