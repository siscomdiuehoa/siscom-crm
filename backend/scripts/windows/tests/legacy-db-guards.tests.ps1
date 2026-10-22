# Kiem thu OFFLINE: hang rao ten database / user / host / nguon .env / nhan ban sao cua 4 script legacy
#   auth-m1-verify.ps1, auth-m11-verify.ps1, auth-s1s3-verify.ps1, fold-verify.ps1
# phai PHAN BIET HOA/THUONG (-cnotmatch/-cne/-ceq), chi chu so ASCII [0-9], ket thuc \z. Dich: D:\SISCOM-CRM\backend\scripts\windows\tests\legacy-db-guards.tests.ps1 (file moi).
# KHONG chay 4 script tren, KHONG ket noi PostgreSQL, KHONG doc .env that (chi tep tam chua chuoi gia, mat khau gia 'x'), KHONG hoi mat khau.
# Cach lam: dung PowerShell AST de TRICH nguyen van cac cau lenh guard tu ma nguon that roi chay voi ten gia.
# Chung minh "ma cu that bai": chay lai chinh cac cau lenh do nhung doi ve toan tu/regex cu (-notmatch, -ne, \d, $) va yeu cau test PHAT HIEN loi.
# Chay: powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\windows\tests\legacy-db-guards.tests.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:failed = @()
function Check([string]$name, [bool]$ok) { if ($ok) { $script:pass++ } else { $script:failed += $name; Write-Host ('  FAIL: ' + $name) -ForegroundColor Red } }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Throws([scriptblock]$b) { try { & $b | Out-Null; return $false } catch { return ($_.Exception -is [System.ApplicationException]) } }

function Get-Ast([string]$path) {
  $tok = $null; $err = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tok, [ref]$err)
  if ($err.Count -gt 0) { throw ('Loi cu phap PowerShell trong ' + $path) }
  return $ast
}
# Dua ma ve toan tu/regex truoc khi sua (de chung minh loi cu).
function ConvertTo-Legacy([string]$t) {
  return $t.Replace('-cnotmatch', '-notmatch').Replace('-cne', '-ne').Replace('-ceq', '-eq').Replace('[0-9]', '\d').Replace('\z', '$')
}
# Ham kiem tra: nhan ($DatabaseName, $TemplateDb, $info, $Step), nem ApplicationException neu guard tu choi.
function New-Guard([string]$path, [bool]$legacy) {
  $ast = Get-Ast $path
  $nodes = $ast.FindAll({ param($n)
      ($n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -in '$pat', '$deny', '$owner', '$needOwner') -or
      ($n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -match '^\$DatabaseName -c?notmatch \$pat|^\$deny -contains|^\$TemplateDb -c?notmatch|^\$info\[[0-3]\] -c?ne|^\$owner -c?ne \$needOwner') }, $true) |
    Sort-Object { $_.Extent.StartOffset }
  $body = (($nodes | ForEach-Object { $_.Extent.Text }) -join "`n")
  $ifCount = @($nodes | Where-Object { $_ -is [System.Management.Automation.Language.IfStatementAst] }).Count
  $need = if ((Split-Path $path -Leaf) -eq 'auth-s1s3-verify.ps1') { 7 } else { 6 }
  if ($ifCount -ne $need) { throw ('Trich ' + $ifCount + ' cau lenh guard tu ' + $path + ', ky vong ' + $need) }
  if ($legacy) { $body = ConvertTo-Legacy $body }
  return [scriptblock]::Create('param([string]$DatabaseName, [string]$TemplateDb, $info, [string]$Step)' + "`n" + $body)
}
function New-EnvReader([string]$path, [bool]$legacy) {
  $ast = Get-Ast $path
  $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-AppPasswordFromEnv' }, $true) | Select-Object -First 1
  if (-not $fn) { throw ('Khong tim thay Get-AppPasswordFromEnv trong ' + $path) }
  $text = $fn.Extent.Text
  if ($legacy) { $text = ConvertTo-Legacy $text }
  return [scriptblock]::Create($text + "`n" + 'return (Get-AppPasswordFromEnv $args[0])')
}

$tpl = 'siscom_crm_restore_20261015_214948'
$good = 'siscom_crm_restore_20261022_101500'
$ar = [string][char]0x0662 * 8; $fw = [string][char]0xFF12 * 8; $dv = [string][char]0x0967 * 6
# 'caseOnly' = $true: chi khac hoa/thuong => ma cu chap nhan. 'old' = $true: ma cu cung chap nhan (lo hong chu so Unicode / \n cuoi / hoa-thuong).
$bad = [ordered]@{
  'upper RESTORE name'      = @('SISCOM_CRM_RESTORE_20261022_101500', $tpl, 'old')
  'mixed case prefix'       = @('Siscom_crm_restore_20261022_101500', $tpl, 'old')
  'upper template'          = @($good, $tpl.ToUpper(), 'old')
  'mixed template'          = @($good, 'Siscom_crm_restore_20261015_214948', 'old')
  'trailing LF target'      = @(($good + "`n"), $tpl, 'old')
  'trailing LF template'    = @($good, ($tpl + "`n"), 'old')
  'arabic digits target'    = @(('siscom_crm_restore_' + $ar + '_101500'), $tpl, 'old')
  'fullwidth digits target' = @(('siscom_crm_restore_' + $fw + '_101500'), $tpl, 'old')
  'devanagari digits tgt'   = @(('siscom_crm_restore_20261022_' + $dv), $tpl, 'old')
  'arabic digits template'  = @($good, ('siscom_crm_restore_' + $ar + '_214948'), 'old')
  'trailing CRLF target'    = @(($good + "`r`n"), $tpl, '')
  'test-kind target'        = @('siscom_crm_test_20261022_101500', $tpl, '')
  'siscom_crm_dev target'   = @('siscom_crm_dev', $tpl, '')
  'upper dev target'        = @('SISCOM_CRM_DEV', $tpl, '')
  'upper locked baseline'   = @($tpl.ToUpper(), $tpl, '')
  'locked baseline target'  = @($tpl, $tpl, '')
  'locked P1 baseline'      = @('siscom_crm_restore_20261014_214105', $tpl, '')
  'target == template'      = @($good, $good, '')
  'sql injection target'    = @(($good + "';DROP DATABASE x;--"), $tpl, '')
  'arg injection target'    = @(($good + '" -c "x'), $tpl, '')
  'leading space target'    = @((' ' + $good), $tpl, '')
  'prefix text target'      = @(('x' + $good), $tpl, '')
  'empty template'          = @($good, '', '')
}
$goodInfo = @($good, 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl))
$badInfo = [ordered]@{
  'info db upper'          = @(@($good.ToUpper(), 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl)), 'old')
  'info user upper'        = @(@($good, 'SISCOM_APP', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl)), 'old')
  'info owner upper'       = @(@($good, 'siscom_app', 'SISCOM_APP', ('SISCOM_STATS_CLONE_OF:' + $tpl)), 'old')
  'info label lower'       = @(@($good, 'siscom_app', 'siscom_app', ('siscom_stats_clone_of:' + $tpl)), 'old')
  'info label template up' = @(@($good, 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl.ToUpper())), 'old')
  'info other db'          = @(@('siscom_crm_dev', 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl)), '')
  'info other user'        = @(@($good, 'postgres', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $tpl)), '')
  'info other owner'       = @(@($good, 'siscom_app', 'postgres', ('SISCOM_STATS_CLONE_OF:' + $tpl)), '')
  'info empty label'       = @(@($good, 'siscom_app', 'siscom_app', ''), '')
  'info label other tpl'   = @(@($good, 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $good)), '')
}
function Get-Info([string]$d, [string]$t) { return @($d, 'siscom_app', 'siscom_app', ('SISCOM_STATS_CLONE_OF:' + $t)) }
$script:user = 'siscom_app'

$cases = [ordered]@{
  'valid'            = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $true, '')
  'upper user'       = @('postgresql://SISCOM_APP:x@127.0.0.1:5432/siscom_crm_dev', $false, 'old')
  'mixed user'       = @('postgresql://Siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $false, 'old')
  'upper source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/SISCOM_CRM_DEV', $false, 'old')
  'other user'       = @('postgresql://postgres:x@127.0.0.1:5432/siscom_crm_dev', $false, '')
  'localhost host'   = @('postgresql://siscom_app:x@localhost:5432/siscom_crm_dev', $false, '')
  'remote host'      = @('postgresql://siscom_app:x@10.0.0.5:5432/siscom_crm_dev', $false, '')
  'ipv6 loopback'    = @('postgresql://siscom_app:x@[::1]:5432/siscom_crm_dev', $false, '')
  'wrong port'       = @('postgresql://siscom_app:x@127.0.0.1:5433/siscom_crm_dev', $false, '')
  'other source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_restore_20261015_214948', $false, '')
  'source db suffix' = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev_x', $false, '')
  'source db %0A'    = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev%0A', $false, '')
  'user %0A'         = @('postgresql://siscom_app%0A:x@127.0.0.1:5432/siscom_crm_dev', $false, '')
  'no password'      = @('postgresql://siscom_app:@127.0.0.1:5432/siscom_crm_dev', $false, '')
  'not a URL'        = @('not a url', $false, '')
}

$scripts = 'auth-m1-verify.ps1', 'auth-m11-verify.ps1', 'auth-s1s3-verify.ps1', 'fold-verify.ps1'
$legacyAccepted = 0
foreach ($s in $scripts) {
  $path = Join-Path $dir $s
  $src = [System.IO.File]::ReadAllText($path)
  $cur = New-Guard $path $false
  $old = New-Guard $path $true
  Check ($s + ' accepts valid names') (-not (Throws { & $cur $good $tpl $goodInfo 'apply' }))
  Check ($s + ' (old ops) accepts valid names too') (-not (Throws { & $old $good $tpl $goodInfo 'apply' }))
  foreach ($k in $bad.Keys) {
    $d = $bad[$k][0]; $t = $bad[$k][1]; $mark = $bad[$k][2]
    Check ($s + ' rejects: ' + $k) (Throws { & $cur $d $t (Get-Info $d $t) 'apply' })
    if ($mark -eq 'old') { Check ($s + ' REGRESSION PROOF (old ops accept): ' + $k) (-not (Throws { & $old $d $t (Get-Info $d $t) 'apply' })); $legacyAccepted++ }
    else { Check ($s + ' (old ops) also rejects: ' + $k) (Throws { & $old $d $t (Get-Info $d $t) 'apply' }) }
  }
  foreach ($k in $badInfo.Keys) {
    $i = $badInfo[$k][0]; $mark = $badInfo[$k][1]
    Check ($s + ' rejects: ' + $k) (Throws { & $cur $good $tpl $i 'apply' })
    if ($mark -eq 'old') { Check ($s + ' REGRESSION PROOF (old ops accept): ' + $k) (-not (Throws { & $old $good $tpl $i 'apply' })); $legacyAccepted++ }
  }
  # Mau da duoc sua: khong con regex/toan tu cu o dong guard; danh sach cam van khong phan biet hoa/thuong.
  Check ($s + ' pat uses [0-9] and \z') ($src.Contains('$pat = ''^siscom_crm_restore_[0-9]{8}_[0-9]{6}\z'''))
  Check ($s + ' no \d or $ -anchored pat') (-not ($src -cmatch '\$pat = ''[^'']*(\\d|\$'')'))
  Check ($s + ' case-sensitive DatabaseName/TemplateDb') (($src -cmatch '\$DatabaseName -cnotmatch \$pat') -and ($src -cmatch '\$TemplateDb -cnotmatch \$pat -or \$TemplateDb -ceq \$DatabaseName'))
  Check ($s + ' deny list still case-insensitive -contains') ($src.Contains('if ($deny -contains $DatabaseName)') -and $src.Contains('$deny = @(''siscom_crm_dev'', ''siscom_crm_restore_20261014_214105'', ''siscom_crm_restore_20261015_214948'')'))
  Check ($s + ' no case-insensitive compare left on guard lines') (-not ($src -cmatch '\$(user|src|u\.Host) -ne ''') -and -not ($src -cmatch '\$info\[[0-3]\] -ne') -and -not ($src -cmatch '\$owner -(ne|eq) '))
  Check ($s + ' confirmation prompt still present') ($src.Contains('Read-Host ''Go lai CHINH XAC ten ban sao de xac nhan'''))

  # --- .env (tep tam, chuoi gia): user / host / nguon ---
  $rd = New-EnvReader $path $false; $rdOld = New-EnvReader $path $true
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('legacy-guard-' + [guid]::NewGuid().ToString('N') + '.env')
  try {
    foreach ($k in $cases.Keys) {
      $url = $cases[$k][0]; $okExpected = $cases[$k][1]; $mark = $cases[$k][2]
      [System.IO.File]::WriteAllText($tmp, ('DATABASE_URL=' + $url + "`n"))
      if ($okExpected) { Check ($s + ' env accepts: ' + $k) ((& $rd $tmp) -ceq 'x') }
      else {
        Check ($s + ' env rejects: ' + $k) (Throws { & $rd $tmp })
        if ($mark -eq 'old') { Check ($s + ' REGRESSION PROOF env (old ops accept): ' + $k) ((& $rdOld $tmp) -ceq 'x'); $legacyAccepted++ }
      }
    }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
Check 'mutation is real (old ops accepted >= 1 sample overall)' ($legacyAccepted -ge 1)

Write-Host ('Ket qua: ' + $script:pass + ' PASS, ' + $script:failed.Count + ' FAIL')
if ($script:failed.Count -gt 0) { Write-Host 'KHONG DAT' -ForegroundColor Red; exit 1 } else { Write-Host 'DAT (offline, khong database)' -ForegroundColor Green; exit 0 }
