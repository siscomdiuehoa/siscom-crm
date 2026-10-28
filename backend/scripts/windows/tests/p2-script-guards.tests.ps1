# Kiem thu OFFLINE: hang rao ten database / user / nguon .env / nhan ban sao / xac nhan cua 6 script Windows
#   run-customers-tests, run-audit-tests, run-search-bench, rehearse-b122, release-b122, lock-p1-baseline
# phai PHAN BIET HOA/THUONG (-cnotmatch/-cne/-ceq/-cmatch), chi chu so ASCII [0-9], ket thuc \z. Dich: D:\SISCOM-CRM\backend\scripts\windows\tests\p2-script-guards.tests.ps1 (file moi).
# KHONG chay cac script tren, KHONG ket noi PostgreSQL, KHONG doc .env that (chi tep tam chua chuoi gia, mat khau gia 'x'), KHONG hoi mat khau.
# Cach lam: dung PowerShell AST de TRICH nguyen van cac cau lenh guard tu ma nguon that roi chay voi ten gia.
# Chung minh "ma cu that bai": chay lai chinh cac cau lenh do nhung doi ve toan tu/regex cu (-notmatch, -ne, \d, $) va yeu cau test PHAT HIEN loi.
# Khong bao gom make-stats-clone (PR #22) va 4 script legacy auth/fold (PR #23).
# Chay: powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\windows\tests\p2-script-guards.tests.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:failed = @()
function Check([string]$name, [bool]$ok) { if ($ok) { $script:pass++ } else { $script:failed += $name; Write-Host ('  FAIL: ' + $name) -ForegroundColor Red } }
function Fail([string]$m) { throw (New-Object System.ApplicationException -ArgumentList $m) }
function Say([string]$m, [string]$c = 'Gray') { }
function Throws([scriptblock]$b) { try { & $b | Out-Null; return $false } catch { return ($_.Exception -is [System.ApplicationException]) } }

function Get-Ast([string]$path) {
  $tok = $null; $err = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tok, [ref]$err)
  if ($err.Count -gt 0) { throw ('Loi cu phap PowerShell trong ' + $path) }
  return $ast
}
# Dua ma ve toan tu/regex truoc khi sua (de chung minh loi cu).
function ConvertTo-Legacy([string]$t) {
  return $t.Replace('-cnotmatch', '-notmatch').Replace('-cmatch', '-match').Replace('-cne', '-ne').Replace('-ceq', '-eq').Replace('[0-9]', '\d').Replace('\z', '$')
}
# Trich cac cau lenh if (theo dieu kien) hoac gan (theo ve trai) khop regex tu ma nguon that.
function Get-IfGuards($ast, [string]$condRe) {
  return @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -match $condRe }, $true) | Sort-Object { $_.Extent.StartOffset } | ForEach-Object { $_.Extent.Text })
}
function Get-Assigns($ast, [string]$leftRe) {
  return @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match $leftRe }, $true) | Sort-Object { $_.Extent.StartOffset } | ForEach-Object { $_.Extent.Text })
}
function New-Block([string[]]$texts, [string]$params, [bool]$legacy) {
  $b = ($texts -join "`n"); if ($legacy) { $b = ConvertTo-Legacy $b }
  return [scriptblock]::Create('param(' + $params + ')' + "`n" + $b)
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
$other = 'siscom_crm_restore_20261001_000001'
$good = 'siscom_crm_restore_20261022_101500'
$ar = [string][char]0x0662 * 8; $fw = [string][char]0xFF12 * 8; $dv = [string][char]0x0967 * 6
# Ten database thu (chi dung mau gia). 'old' = ma cu cung chap nhan (lo hong); '' = ca ma cu cung tu choi.
$badNames = [ordered]@{
  'upper RESTORE name'      = @('SISCOM_CRM_RESTORE_20261022_101500', 'old')
  'mixed case prefix'       = @('Siscom_crm_restore_20261022_101500', 'old')
  'trailing LF'             = @(($good + "`n"), 'old')
  'arabic digits'           = @(('siscom_crm_restore_' + $ar + '_101500'), 'old')
  'fullwidth digits'        = @(('siscom_crm_restore_' + $fw + '_101500'), 'old')
  'devanagari digits'       = @(('siscom_crm_restore_20261022_' + $dv), 'old')
  'trailing CRLF'           = @(($good + "`r`n"), '')
  'siscom_crm_dev'          = @('siscom_crm_dev', '')
  'upper dev'               = @('SISCOM_CRM_DEV', '')
  'sql injection'           = @(($good + "';DROP DATABASE x;--"), '')
  'leading space'           = @((' ' + $good), '')
  'prefix text'             = @(('x' + $good), '')
  'empty'                   = @('', '')
}
$env_cases = [ordered]@{
  'valid'            = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $true, '')
  'upper user'       = @('postgresql://SISCOM_APP:x@127.0.0.1:5432/siscom_crm_dev', $false, 'old')
  'mixed user'       = @('postgresql://Siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $false, 'old')
  'upper source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/SISCOM_CRM_DEV', $false, 'old')
  'other user'       = @('postgresql://postgres:x@127.0.0.1:5432/siscom_crm_dev', $false, '')
  'localhost host'   = @('postgresql://siscom_app:x@localhost:5432/siscom_crm_dev', $false, '')
  'remote host'      = @('postgresql://siscom_app:x@10.0.0.5:5432/siscom_crm_dev', $false, '')
  'wrong port'       = @('postgresql://siscom_app:x@127.0.0.1:5433/siscom_crm_dev', $false, '')
  'other source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_restore_20261015_214948', $false, '')
  'source db %0A'    = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev%0A', $false, '')
  'no password'      = @('postgresql://siscom_app:@127.0.0.1:5432/siscom_crm_dev', $false, '')
  'not a URL'        = @('not a url', $false, '')
}
$legacyAccepted = 0
$names = 'run-customers-tests.ps1', 'run-audit-tests.ps1', 'run-search-bench.ps1', 'rehearse-b122.ps1', 'release-b122.ps1'

foreach ($s in $names + 'lock-p1-baseline.ps1') {
  $path = Join-Path $dir $s
  $src = [System.IO.File]::ReadAllText($path)
  $ast = Get-Ast $path
  $isLock = ($s -eq 'lock-p1-baseline.ps1')

  if (-not $isLock) {
    # 1) Ten database dich (-DatabaseName / $Db): mau ten, hoa/thuong, chu so, \z
    $g = Get-IfGuards $ast '^\$(DatabaseName|Db) -c?notmatch ''\^siscom_crm_'
    Check ($s + ' extracted DB-name guard') ($g.Count -eq 1)
    $cur = New-Block $g '$DatabaseName, $Db' $false; $old = New-Block $g '$DatabaseName, $Db' $true
    Check ($s + ' accepts valid name') (-not (Throws { & $cur $good $good }))
    Check ($s + ' (old) accepts valid name') (-not (Throws { & $old $good $good }))
    foreach ($k in $badNames.Keys) {
      $n = $badNames[$k][0]
      Check ($s + ' rejects name: ' + $k) (Throws { & $cur $n $n })
      if ($badNames[$k][1] -eq 'old') { Check ($s + ' REGRESSION PROOF (old accepts): ' + $k) (-not (Throws { & $old $n $n })); $legacyAccepted++ }
    }
    # 2) Xac nhan go lai ten (-cne) va xac nhan doi chieu current_database()/user/owner
    $gc = Get-IfGuards $ast '^\$c -c?ne \$(DatabaseName|Db)$'
    Check ($s + ' extracted name-confirm guard') ($gc.Count -eq 1)
    $cc = New-Block $gc '$c, $DatabaseName, $Db' $false; $co = New-Block $gc '$c, $DatabaseName, $Db' $true
    Check ($s + ' confirm accepts exact') (-not (Throws { & $cc $good $good $good }))
    Check ($s + ' confirm rejects upper-case retype') (Throws { & $cc $good.ToUpper() $good $good })
    Check ($s + ' REGRESSION PROOF confirm (old accepts upper-case retype)') (-not (Throws { & $co $good.ToUpper() $good $good })); $legacyAccepted++
    $gi = Get-IfGuards $ast '^\$info\[[0-2]\] -c?ne |^\$info\[1\] -c?ne '
    Check ($s + ' extracted info guards (>=2)') ($gi.Count -ge 2)
    $ci = New-Block $gi '$info, $DatabaseName, $Db' $false; $oi = New-Block $gi '$info, $DatabaseName, $Db' $true
    Check ($s + ' info accepts exact') (-not (Throws { & $ci @($good, 'siscom_app', 'siscom_app') $good $good }))
    foreach ($bi in @(@('db upper', @($good.ToUpper(), 'siscom_app', 'siscom_app')), @('user upper', @($good, 'SISCOM_APP', 'siscom_app')), @('owner upper', @($good, 'siscom_app', 'SISCOM_APP')))) {
      Check ($s + ' info rejects: ' + $bi[0]) (Throws { & $ci $bi[1] $good $good })
      Check ($s + ' REGRESSION PROOF info (old accepts): ' + $bi[0]) (-not (Throws { & $oi $bi[1] $good $good })); $legacyAccepted++
    }
    foreach ($bi in @(@('db other', @('siscom_crm_dev', 'siscom_app', 'siscom_app')), @('user other', @($good, 'postgres', 'siscom_app')), @('owner other', @($good, 'siscom_app', 'postgres')))) {
      Check ($s + ' info rejects: ' + $bi[0]) (Throws { & $ci $bi[1] $good $good })
    }
  }

  if ($isLock) {
    # lock-p1-baseline: kiem tra ten database trong bao cao r5-C (khong ket noi DB)
    $chk = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.Extent.Text -match "^Chk 'database la ban sao" }, $true) | ForEach-Object { $_.Extent.Text })
    Check ($s + ' extracted database-name Chk') ($chk.Count -eq 1)
    function Chk([string]$n, [bool]$ok, [string]$d) { $script:lastChk = $ok }
    foreach ($legacy in $false, $true) {
      $t = $chk[0]; if ($legacy) { $t = ConvertTo-Legacy $t }
      $sb = [scriptblock]::Create('param($j)' + "`n" + $t)
      $accepts = { param([string]$nm) $script:lastChk = $null; & $sb ([pscustomobject]@{ database = [pscustomobject]@{ name = $nm } }) | Out-Null; return [bool]$script:lastChk }
      if (-not $legacy) {
        Check ($s + ' accepts valid report db name') (& $accepts $good)
        foreach ($k in $badNames.Keys) { Check ($s + ' rejects report db name: ' + $k) (-not (& $accepts $badNames[$k][0])) }
        Check ($s + ' rejects test-kind/dev baseline name') (-not (& $accepts 'siscom_crm_test_20261022_101500'))
      } else {
        foreach ($k in $badNames.Keys) { if ($badNames[$k][1] -eq 'old') { Check ($s + ' REGRESSION PROOF report (old accepts): ' + $k) (& $accepts $badNames[$k][0]); $legacyAccepted++ } }
      }
    }
    Check ($s + ' no read of .env / no DB connection') (-not ((($src -split "`n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n" -cmatch 'psql|\.env|Read-Host'))
    continue
  }

  # 3) Doc DATABASE_URL tu .env (tep tam, chuoi gia)
  $rd = New-EnvReader $path $false; $rdOld = New-EnvReader $path $true
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('p2-guard-' + [guid]::NewGuid().ToString('N') + '.env')
  try {
    foreach ($k in $env_cases.Keys) {
      $url = $env_cases[$k][0]; $okExpected = $env_cases[$k][1]; $mark = $env_cases[$k][2]
      [System.IO.File]::WriteAllText($tmp, ('DATABASE_URL=' + $url + "`n"))
      if ($okExpected) { Check ($s + ' env accepts: ' + $k) ((& $rd $tmp) -ceq 'x') }
      else {
        Check ($s + ' env rejects: ' + $k) (Throws { & $rd $tmp })
        if ($mark -eq 'old') { Check ($s + ' REGRESSION PROOF env (old accepts): ' + $k) ((& $rdOld $tmp) -ceq 'x'); $legacyAccepted++ }
      }
    }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  Check ($s + ' no case-insensitive compare on user/source guard') (-not ($src -cmatch '\$(user|src) -ne '''))
  Check ($s + ' no \d / $-anchored DB-name regex left') (-not ($src -cmatch "'\^siscom_crm_[^']*(\\d|\`$')"))

  # 4) run-search-bench: -CloneOf, nhan ban sao, -Cases, xac nhan CLONE-HUY-BO-DUOC
  if ($s -eq 'run-search-bench.ps1') {
    $gcl = Get-IfGuards $ast '^\$CloneOf -c?notmatch '
    Check ($s + ' extracted 2 CloneOf guards') ($gcl.Count -eq 2)
    $cl = New-Block $gcl '$CloneOf, $DatabaseName' $false; $clo = New-Block $gcl '$CloneOf, $DatabaseName' $true
    Check ($s + ' CloneOf accepts valid distinct') (-not (Throws { & $cl $tpl $good }))
    foreach ($k in $badNames.Keys) {
      $n = $badNames[$k][0]
      Check ($s + ' CloneOf rejects: ' + $k) (Throws { & $cl $n $other })
      if ($badNames[$k][1] -eq 'old') { Check ($s + ' REGRESSION PROOF CloneOf (old accepts): ' + $k) (-not (Throws { & $clo $n $other })); $legacyAccepted++ }
    }
    Check ($s + ' CloneOf rejects == DatabaseName') (Throws { & $cl $good $good })
    Check ($s + ' CloneOf rejects test-kind source') (Throws { & $cl 'siscom_crm_test_20261022_101500' $good })
    $gl = Get-IfGuards $ast '^\$mk2? -c?ne '
    Check ($s + ' extracted 2 label guards') ($gl.Count -eq 2)
    $lb = New-Block $gl '$mk, $mk2, $CloneOf' $false; $lbo = New-Block $gl '$mk, $mk2, $CloneOf' $true
    $lab = 'SISCOM_STATS_CLONE_OF:' + $tpl
    Check ($s + ' label accepts exact') (-not (Throws { & $lb $lab $lab $tpl }))
    foreach ($bl in @(@('lower prefix', ('siscom_stats_clone_of:' + $tpl)), @('upper source', ('SISCOM_STATS_CLONE_OF:' + $tpl.ToUpper())), @('other source', ('SISCOM_STATS_CLONE_OF:' + $good)), @('empty', ''))) {
      Check ($s + ' label rejects: ' + $bl[0]) (Throws { & $lb $bl[1] $bl[1] $tpl })
      if ($bl[0] -in 'lower prefix', 'upper source') { Check ($s + ' REGRESSION PROOF label (old accepts): ' + $bl[0]) (-not (Throws { & $lbo $bl[1] $bl[1] $tpl })); $legacyAccepted++ }
    }
    $gk = Get-IfGuards $ast '^\$Cases -c?notmatch '
    Check ($s + ' extracted -Cases guard') ($gk.Count -eq 1)
    $ck = New-Block $gk '$Cases' $false; $cko = New-Block $gk '$Cases' $true
    Check ($s + ' Cases accepts safe regex') (-not (Throws { & $ck '^list/all/p(1|100)$' }))
    Check ($s + ' Cases rejects semicolon') (Throws { & $ck 'a;b' })
    Check ($s + ' Cases rejects trailing LF') (Throws { & $ck ("list`n") })
    Check ($s + ' REGRESSION PROOF Cases (old accepts trailing LF)') (-not (Throws { & $cko ("list`n") })); $legacyAccepted++
    Check ($s + ' CLONE-HUY-BO-DUOC confirm is case-sensitive') ($src.Contains("-cne 'CLONE-HUY-BO-DUOC'"))
    Check ($s + ' CloneOf==DatabaseName compare is case-sensitive') ($src -cmatch '\$CloneOf -ceq \$DatabaseName')
  }
  if ($s -eq 'release-b122.ps1') {
    # 5) release: ten database khoi phuc trong dau vet restore-test va ten ban sao luu
    $rm = Get-Assigns $ast '^\$rm$'; $dm = Get-Assigns $ast '^\$dm$'
    Check ($s + ' extracted restored_db/dump regex') (($rm.Count -eq 1) -and ($dm.Count -eq 1))
    $kvGood = @{ restored_db = $good }
    foreach ($legacy in $false, $true) {
      $t = ($rm -join "`n"); if ($legacy) { $t = ConvertTo-Legacy $t }
      $sb = [scriptblock]::Create('param($kv)' + "`n" + $t + "`n" + 'return $rm.Success')
      if (-not $legacy) {
        Check ($s + ' restored_db accepts valid') (& $sb $kvGood)
        Check ($s + ' restored_db rejects arabic digits') (-not (& $sb @{ restored_db = ('siscom_crm_restore_' + $ar + '_101500') }))
        Check ($s + ' restored_db rejects trailing LF') (-not (& $sb @{ restored_db = ($good + "`n") }))
        Check ($s + ' restored_db rejects upper') (-not (& $sb @{ restored_db = $good.ToUpper() }))
      } else {
        Check ($s + ' REGRESSION PROOF restored_db (old accepts arabic digits)') (& $sb @{ restored_db = ('siscom_crm_restore_' + $ar + '_101500') }); $legacyAccepted++
        Check ($s + ' REGRESSION PROOF restored_db (old accepts trailing LF)') (& $sb @{ restored_db = ($good + "`n") }); $legacyAccepted++
      }
      $t2 = ($dm -join "`n"); if ($legacy) { $t2 = ConvertTo-Legacy $t2 }
      $sb2 = [scriptblock]::Create('param($dump)' + "`n" + $t2 + "`n" + 'return $dm.Success')
      $dg = [pscustomobject]@{ Name = 'siscom_crm_dev_20261022_101500.dump' }
      $db = [pscustomobject]@{ Name = ('siscom_crm_dev_' + $ar + '_101500.dump') }
      if (-not $legacy) { Check ($s + ' dump name accepts valid') (& $sb2 $dg); Check ($s + ' dump name rejects arabic digits') (-not (& $sb2 $db)) }
      else { Check ($s + ' REGRESSION PROOF dump name (old accepts arabic digits)') (& $sb2 $db); $legacyAccepted++ }
    }
    Check ($s + ' scratch Db == RehearsedDb compare is case-sensitive') ($src -cmatch '\$Db -ceq \$RehearsedDb')
    Check ($s + ' dev approval phrase still -cne') ($src.Contains("-cne 'TOI PHE DUYET MIGRATION B1.2.2 TREN siscom_crm_dev'"))
  }
  Check ($s + ' prompts preserved') ($src.Contains("Read-Host 'Go lai CHINH XAC ten"))
}
Check 'mutation is real (old ops accepted >= 1 sample overall)' ($legacyAccepted -ge 1)

Write-Host ('Ket qua: ' + $script:pass + ' PASS, ' + $script:failed.Count + ' FAIL')
if ($script:failed.Count -gt 0) { Write-Host 'KHONG DAT' -ForegroundColor Red; exit 1 } else { Write-Host 'DAT (offline, khong database)' -ForegroundColor Green; exit 0 }
