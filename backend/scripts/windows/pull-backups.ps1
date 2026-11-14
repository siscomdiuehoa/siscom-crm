# SISCOM CRM - KEO ban sao luu MA HOA tu VPS ve Google Drive (chay tren may Windows, Task Scheduler hang ngay).
# Ket noi bang tai khoan CHI DOC `backup-pull` (tao bang backend/scripts/linux/setup-backup-pull.sh): khoa SSH cua may nay chi chay
# duoc `sftp-server -R` (chi tai xuong). VPS KHONG giu mat khau/token Google nao.
# Moi bo sao luu (4 tep: <stem>.dump.age, .dump.age.sha256, .manifest, .manifest.sig) chi vao Drive SAU KHI kiem:
#   chu ky manifest (ssh-keygen -Y verify, allowed_signers tren Drive) + db dung + encrypted=1 + file= dung ten + SHA-256 dung.
# KHONG BAO GIO tai tep .dump (khong ma hoa). KHONG xoa gi tren Drive. KHONG ghi de tep da co tren Drive.
# Ma thoat: 0 = xong (co the khong co bo moi); 1 = co loi (ket noi, kiem that bai, bo moi nhat qua cu...). Log: <WorkDir>\pull-backups.log
#
# Dung (vd Task Scheduler 8:00 sang):
#   powershell -NoProfile -ExecutionPolicy Bypass -File pull-backups.ps1
# Tham so mac dinh theo may cua Owner. Khoa host VPS phai co san trong known_hosts (StrictHostKeyChecking=yes; -KnownHostsFile de chon file khac).
# -SourceDir <thu muc> thay sftp bang thu muc cuc bo (chi de kiem thu).
[CmdletBinding()]
param(
  [string]$VpsHost = '42.96.15.235',
  [ValidateRange(1, 65535)][int]$Port = 26266,
  [string]$User = 'backup-pull',
  [string]$KeyFile = (Join-Path $HOME '.ssh\siscom_backup_pull'),
  [ValidatePattern('^siscom_crm_(staging|prod)$')][string]$Database = 'siscom_crm_staging',
  [string]$DriveDir = 'G:\My Drive\SISCOM-CRM-Backup',
  [string]$WorkDir = (Join-Path $HOME 'SISCOM-CRM-PR178\backup'),
  [ValidateRange(1, 720)][int]$MaxAgeHours = 26,
  [string]$SshBin = '',
  [string]$KnownHostsFile = '',
  [string]$SourceDir = ''
)
$ErrorActionPreference = 'Stop'
$script:errors = 0
$ns = 'siscom-crm-backup'

function Write-Log([string]$level, [string]$msg) {
  $line = ('{0} [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $level, $msg)
  Write-Host $line
  try { [System.IO.File]::AppendAllText((Join-Path $WorkDir 'pull-backups.log'), $line + [Environment]::NewLine) } catch { }
  if ($level -eq 'LOI') { $script:errors++ }
}
function Find-Tool([string]$name) {
  if ($SshBin) { $p = Join-Path $SshBin $name; if (Test-Path -LiteralPath $p) { return $p } }
  foreach ($cand in @("$env:WINDIR\System32\OpenSSH\$name.exe")) { if ($env:WINDIR -and (Test-Path -LiteralPath $cand)) { return $cand } }
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}
# Chay lenh ngoai voi chuoi tham so (giu dung tham so rong/co dau cach tren ca Windows PowerShell 5.1 va pwsh 7).
function Invoke-Native([string]$exe, [string]$argString, [string]$stdinFile = '') {
  $o = [System.IO.Path]::GetTempFileName(); $e = [System.IO.Path]::GetTempFileName()
  try {
    $sp = @{ FilePath = $exe; ArgumentList = $argString; NoNewWindow = $true; Wait = $true; PassThru = $true; RedirectStandardOutput = $o; RedirectStandardError = $e }
    if ($stdinFile) { $sp.RedirectStandardInput = $stdinFile }
    $p = Start-Process @sp
    return [pscustomobject]@{ Code = $p.ExitCode; Out = (Get-Content -LiteralPath $o -Raw); Err = (Get-Content -LiteralPath $e -Raw) }
  } finally { Remove-Item -LiteralPath $o, $e -Force -ErrorAction SilentlyContinue }
}
function Q([string]$s) { return '"' + $s + '"' }

$stemRe = '^(' + [regex]::Escape($Database) + ')_(\d{8})_(\d{6})$'
$fileRe = '^(' + [regex]::Escape($Database) + '_\d{8}_\d{6})\.(dump\.age|dump\.age\.sha256|manifest|manifest\.sig)$'
$parts = @('.dump.age', '.dump.age.sha256', '.manifest', '.manifest.sig')

try {
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $incoming = Join-Path $WorkDir 'incoming'; $bad = Join-Path $incoming 'loi'
  $staging = Join-Path $DriveDir ($Database -replace '^siscom_crm_', '')
  $signers = Join-Path $DriveDir 'backup-signing.allowed_signers'
  Write-Log 'INFO' ("Bat dau: DB {0}, Drive {1}, nguon {2}" -f $Database, $staging, $(if ($SourceDir) { "thu muc $SourceDir (kiem thu)" } else { "sftp ${User}@${VpsHost}:$Port" }))
  if (-not (Test-Path -LiteralPath $DriveDir)) { throw "Khong thay thu muc Drive: $DriveDir (Google Drive for Desktop chua chay?)" }
  if (-not (Test-Path -LiteralPath $signers)) { throw "Thieu $signers (khoa cong khai ky sao luu)." }
  New-Item -ItemType Directory -Force -Path $staging, $incoming | Out-Null
  $keygen = Find-Tool 'ssh-keygen'; if (-not $keygen) { throw 'Khong tim thay ssh-keygen (OpenSSH).' }

  # --- 1. Liet ke nguon: CHI ten dung mau 4 loai tep ma hoa/kem theo; .dump va moi ten khac bi bo qua ---
  if ($SourceDir) {
    $names = @(Get-ChildItem -LiteralPath $SourceDir -File | ForEach-Object { $_.Name })
  } else {
    $sftp = Find-Tool 'sftp'; if (-not $sftp) { throw 'Khong tim thay sftp (OpenSSH).' }
    if (-not (Test-Path -LiteralPath $KeyFile)) { throw "Thieu khoa SSH: $KeyFile" }
    $batch = Join-Path $incoming 'ls.sftp'; [System.IO.File]::WriteAllText($batch, "ls -1`n")
    $kh = $(if ($KnownHostsFile) { ' -o UserKnownHostsFile={0}' -f (Q $KnownHostsFile) } else { '' })
    $sftpBase = '-b {0} -P {1} -i {2} -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o ConnectTimeout=20{5} {3}@{4}' -f (Q $batch), $Port, (Q $KeyFile), $User, $VpsHost, $kh
    $r = Invoke-Native $sftp $sftpBase
    Remove-Item -LiteralPath $batch -Force -ErrorAction SilentlyContinue
    if ($r.Code -ne 0) { throw ("Khong liet ke duoc tren VPS (sftp ma {0}): {1}" -f $r.Code, (($r.Err -split "`n") | Select-Object -First 3) -join ' | ') }
    $names = @(($r.Out -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('sftp>') } | ForEach-Object { Split-Path -Leaf $_ })
  }
  $sets = @{}
  foreach ($n in $names) { if ($n -match $fileRe) { if (-not $sets.ContainsKey($Matches[1])) { $sets[$Matches[1]] = @() }; $sets[$Matches[1]] += $n } }
  $stems = @($sets.Keys | Sort-Object)
  Write-Log 'INFO' ("Nguon co {0} bo cua {1}." -f $stems.Count, $Database)

  # --- 2. Bo moi nhat qua cu => timer tren VPS co the khong chay ---
  if ($stems.Count -eq 0) { Write-Log 'LOI' "Nguon khong co bo sao luu nao cua $Database." }
  else {
    $last = $stems[-1]; $null = $last -match $stemRe
    $t = [datetime]::ParseExact($Matches[2] + $Matches[3], 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AssumeUniversal,AdjustToUniversal')
    $age = ((Get-Date).ToUniversalTime() - $t).TotalHours
    if ($age -gt $MaxAgeHours) { Write-Log 'LOI' ("Bo moi nhat {0} da {1:N1} gio (> {2} gio): timer sao luu tren VPS co the KHONG chay." -f $last, $age, $MaxAgeHours) }
  }

  # --- 3. Tai + kiem tung bo chua co tren Drive ---
  $new = 0
  foreach ($stem in $stems) {
    if (Test-Path -LiteralPath (Join-Path $staging "$stem.dump.age")) { continue }
    $missing = @($parts | Where-Object { $sets[$stem] -notcontains ($stem + $_) })
    if ($missing.Count -gt 0) { Write-Log 'CANH BAO' ("Bo {0} chua du tep (thieu {1}) - co the dang sao luu; bo qua lan nay." -f $stem, ($missing -join ', ')); continue }
    $dir = Join-Path $incoming $stem
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ($SourceDir) {
      foreach ($p in $parts) { Copy-Item -LiteralPath (Join-Path $SourceDir ($stem + $p)) -Destination $dir }
    } else {
      $gb = Join-Path $incoming 'get.sftp'
      $lines = foreach ($p in $parts) { 'get "{0}" "{1}"' -f ($stem + $p), ((Join-Path $dir ($stem + $p)) -replace '\\', '/') }
      [System.IO.File]::WriteAllText($gb, (($lines -join "`n") + "`n"))
      $r = Invoke-Native $sftp ($sftpBase -replace [regex]::Escape((Q $batch)), (Q $gb))
      Remove-Item -LiteralPath $gb -Force -ErrorAction SilentlyContinue
      if ($r.Code -ne 0) { Write-Log 'LOI' ("Tai bo {0} that bai (sftp ma {1})." -f $stem, $r.Code); continue }
    }
    # Kiem: chu ky + noi dung manifest + SHA-256
    $man = Join-Path $dir "$stem.manifest"; $sig = "$man.sig"; $agef = Join-Path $dir "$stem.dump.age"
    $why = $null
    $v = Invoke-Native $keygen ('-Y verify -f {0} -I {1} -n {1} -s {2}' -f (Q $signers), $ns, (Q $sig)) $man
    if ($v.Code -ne 0) { $why = 'chu ky manifest KHONG hop le' }
    else {
      $ml = @(Get-Content -LiteralPath $man)
      $get = { param($k) $x = @($ml | Where-Object { $_ -like "$k=*" }); if ($x.Count -ne 1) { return $null }; return $x[0].Substring($k.Length + 1) }
      $hash = (Get-FileHash -LiteralPath $agef -Algorithm SHA256).Hash.ToLowerInvariant()
      if ((& $get 'db') -ne $Database) { $why = 'manifest thuoc DB khac' }
      elseif ((& $get 'encrypted') -ne '1') { $why = 'manifest khong ghi encrypted=1' }
      elseif ((& $get 'file') -ne "$stem.dump.age") { $why = 'manifest mo ta file khac' }
      elseif ((& $get 'file_sha256') -ne $hash) { $why = 'SHA-256 file khac manifest' }
      else {
        $side = (Get-Content -LiteralPath "$agef.sha256" -Raw).Trim().Split(' ')[0].ToLowerInvariant()
        if ($side -ne $hash) { $why = 'tep .sha256 khong khop' }
      }
    }
    if ($why) {
      New-Item -ItemType Directory -Force -Path $bad | Out-Null
      $dest = Join-Path $bad ('{0}-{1}' -f $stem, (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))
      Move-Item -LiteralPath $dir -Destination $dest
      Write-Log 'LOI' ("Bo {0} KHONG dat ({1}) - KHONG dua vao Drive, giu o {2}." -f $stem, $why, $dest)
      continue
    }
    foreach ($p in $parts) {
      $target = Join-Path $staging ($stem + $p)
      if (Test-Path -LiteralPath $target) { Write-Log 'LOI' "Da co $target - khong ghi de."; continue }
      Move-Item -LiteralPath (Join-Path $dir ($stem + $p)) -Destination $target
    }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    $new++
    Write-Log 'OK' ("Da dua bo {0} vao Drive (chu ky + SHA-256 dat)." -f $stem)
  }
  Write-Log 'INFO' ("Xong: {0} bo moi; {1} loi." -f $new, $script:errors)
} catch {
  Write-Log 'LOI' $_.Exception.Message
}
if ($script:errors -gt 0) { exit 1 } else { exit 0 }
