# Kiem thu OFFLINE: hang rao allowlist ten database + kiem tra .env (user/host/nguon) cua auth-m13-verify.ps1 va run-auth-int-tests.ps1
# phai PHAN BIET HOA/THUONG (-cnotmatch/-cne), chi chu so ASCII [0-9], ket thuc \z. Dich: D:\SISCOM-CRM\backend\scripts\windows\tests\auth-db-guard-case.tests.ps1 (file moi).
# KHONG chay 2 script tren, KHONG ket noi PostgreSQL, KHONG doc .env that (chi tep tam chua chuoi gia, mat khau gia 'x'), KHONG hoi mat khau.
# Cach lam: dung PowerShell AST de TRICH nguyen van cac cau lenh guard tu ma nguon that cua tung script roi chay voi ten gia.
# Chung minh "ma cu that bai": dung chinh cac cau lenh do nhung doi -cnotmatch/-cne ve -notmatch/-ne (hanh vi truoc khi sua) va yeu cau test PHAT HIEN loi.
# Chay: powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\windows\tests\auth-db-guard-case.tests.ps1
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
# Tra ve ham kiem tra ten DB: nhan ($DatabaseName, $TemplateDb), nem ApplicationException neu guard tu choi.
# $legacy = $true: ap dung toan tu KHONG phan biet hoa/thuong nhu truoc khi sua.
function New-NameGuard([string]$path, [bool]$legacy) {
  $ast = Get-Ast $path
  $defs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -in '$DB_ALLOW', '$DB_DENY', '$DB_DENY_WORDS' }, $true) | ForEach-Object { $_.Extent.Text }
  $ifs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and ($n.Clauses[0].Item1.Extent.Text -match '\$DB_ALLOW|\$DB_DENY|-c?notmatch ''\^siscom_crm_restore') }, $true) | ForEach-Object { $_.Extent.Text }
  if (@($defs).Count -ne 3) { throw ('Khong trich du 3 khai bao $DB_* tu ' + $path) }
  if (@($ifs).Count -ne 4) { throw ('Khong trich du 4 cau lenh guard ten DB tu ' + $path + ' (' + @($ifs).Count + ')') }
  $body = (($defs + $ifs) -join "`n")
  if ($legacy) { $body = $body.Replace('-cnotmatch', '-notmatch').Replace('-cne', '-ne').Replace('-ceq', '-eq').Replace('-ccontains', '-contains') }
  return [scriptblock]::Create('param([string]$DatabaseName, [string]$TemplateDb)' + "`n" + $body)
}
function New-EnvReader([string]$path, [bool]$legacy) {
  $ast = Get-Ast $path
  $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-AppPasswordFromEnv' }, $true) | Select-Object -First 1
  if (-not $fn) { throw ('Khong tim thay Get-AppPasswordFromEnv trong ' + $path) }
  $text = $fn.Extent.Text
  if ($legacy) { $text = $text.Replace('-cnotmatch', '-notmatch').Replace('-cne', '-ne') }
  return [scriptblock]::Create($text + "`n" + 'return (Get-AppPasswordFromEnv $args[0])')
}

$tpl = 'siscom_crm_restore_20261015_214948'
$goodRestore = 'siscom_crm_restore_20261022_101500'
$goodTest = 'siscom_crm_test_20261022_101500'
$ar = [string][char]0x0662 * 8; $fw = [string][char]0xFF12 * 8; $dv = [string][char]0x0967 * 6
# ten phai bi TU CHOI boi script da sua. ('case' = nhom bi loi khi dung toan tu cu)
$bad = [ordered]@{
  'upper RESTORE name'     = @('SISCOM_CRM_RESTORE_20261022_101500', $tpl, $true)
  'upper TEST name'        = @('SISCOM_CRM_TEST_20261022_101500', $tpl, $true)
  'mixed case prefix'      = @('Siscom_crm_restore_20261022_101500', $tpl, $true)
  'mixed case kind'        = @('siscom_crm_Test_20261022_101500', $tpl, $true)
  'upper template'         = @($goodRestore, $tpl.ToUpper(), $true)
  'mixed template'         = @($goodRestore, 'Siscom_crm_restore_20261015_214948', $true)
  'template test-kind'     = @($goodRestore, $goodTest, $false)
  'trailing LF target'     = @(($goodRestore + "`n"), $tpl, $false)
  'trailing CRLF target'   = @(($goodTest + "`r`n"), $tpl, $false)
  'trailing LF template'   = @($goodRestore, ($tpl + "`n"), $false)
  'arabic digits target'   = @(('siscom_crm_restore_' + $ar + '_101500'), $tpl, $false)
  'fullwidth digits target'= @(('siscom_crm_test_' + $fw + '_101500'), $tpl, $false)
  'devanagari digits tgt'  = @(('siscom_crm_restore_20261022_' + $dv), $tpl, $false)
  'arabic digits template' = @($goodRestore, ('siscom_crm_restore_' + $ar + '_214948'), $false)
  'siscom_crm_dev target'  = @('siscom_crm_dev', $tpl, $false)
  'upper dev target'       = @('SISCOM_CRM_DEV', $tpl, $false)
  'locked baseline target' = @($tpl, $tpl, $false)
  'deny word suffix'       = @('siscom_crm_restore_20261022_101500_dev', $tpl, $false)
  'target == template'     = @($goodRestore, $goodRestore, $false)
  'sql injection target'   = @(($goodTest + "';DROP DATABASE x;--"), $tpl, $false)
  'quote/arg injection'    = @(($goodTest + '" -c "x'), $tpl, $false)
  'leading space target'   = @((' ' + $goodTest), $tpl, $false)
  'empty template'         = @($goodRestore, '', $false)
}
foreach ($s in 'auth-m13-verify.ps1', 'run-auth-int-tests.ps1') {
  $path = Join-Path $dir $s
  $cur = New-NameGuard $path $false
  $old = New-NameGuard $path $true
  # ten hop le van duoc chap nhan (khong lam hong luong hop le)
  Check ($s + ' accepts restore name') (-not (Throws { & $cur $goodRestore $tpl }))
  Check ($s + ' accepts test name') (-not (Throws { & $cur $goodTest $tpl }))
  Check ($s + ' (old ops) accepts valid names too') (-not (Throws { & $old $goodRestore $tpl }))
  foreach ($k in $bad.Keys) {
    $d = $bad[$k][0]; $t = $bad[$k][1]; $caseOnly = $bad[$k][2]
    Check ($s + ' rejects: ' + $k) (Throws { & $cur $d $t })
    # Bang chung ma cu KHONG dat: voi cac ca chi khac hoa/thuong, toan tu cu CHAP NHAN (guard bi vuot) => test nay se do.
    if ($caseOnly) { Check ($s + ' REGRESSION PROOF (old ops accept): ' + $k) (-not (Throws { & $old $d $t })) }
  }
  # Mutation phai that su khac: neu thay doi khong tac dung thi phep chung minh vo nghia.
  Check ($s + ' source uses case-sensitive guard operators') ((([System.IO.File]::ReadAllText($path)) -cmatch '\$DatabaseName -cnotmatch \$DB_ALLOW') -and (([System.IO.File]::ReadAllText($path)) -cmatch '\$TemplateDb -cnotmatch'))
  Check ($s + ' source uses case-sensitive clone-label compare') (([System.IO.File]::ReadAllText($path)).Contains('if ($info[3] -cne (''SISCOM_STATS_CLONE_OF:'''))
  # DB_DENY_WORDS van khong phan biet hoa/thuong va van chay (khong bi suy yeu)
  Check ($s + ' deny words still case-insensitive') ((([System.IO.File]::ReadAllText($path)) -cmatch "DB_DENY_WORDS = '\(\?i\)"))

  # --- .env (tep tam, chuoi gia): user / host / nguon ---
  $cases = [ordered]@{
    'valid'            = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $true, $false)
    'upper user'       = @('postgresql://SISCOM_APP:x@127.0.0.1:5432/siscom_crm_dev', $false, $true)
    'mixed user'       = @('postgresql://Siscom_app:x@127.0.0.1:5432/siscom_crm_dev', $false, $true)
    'upper source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/SISCOM_CRM_DEV', $false, $true)
    'other user'       = @('postgresql://postgres:x@127.0.0.1:5432/siscom_crm_dev', $false, $false)
    'localhost host'   = @('postgresql://siscom_app:x@localhost:5432/siscom_crm_dev', $false, $false)
    'remote host'      = @('postgresql://siscom_app:x@10.0.0.5:5432/siscom_crm_dev', $false, $false)
    'ipv6 loopback'    = @('postgresql://siscom_app:x@[::1]:5432/siscom_crm_dev', $false, $false)
    'wrong port'       = @('postgresql://siscom_app:x@127.0.0.1:5433/siscom_crm_dev', $false, $false)
    'other source db'  = @('postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_restore_20261015_214948', $false, $false)
    'no password'      = @('postgresql://siscom_app:@127.0.0.1:5432/siscom_crm_dev', $false, $false)
    'not a URL'        = @('not a url', $false, $false)
  }
  $rd = New-EnvReader $path $false; $rdOld = New-EnvReader $path $true
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('auth-guard-case-' + [guid]::NewGuid().ToString('N') + '.env')
  try {
    foreach ($k in $cases.Keys) {
      $url = $cases[$k][0]; $okExpected = $cases[$k][1]; $caseOnly = $cases[$k][2]
      [System.IO.File]::WriteAllText($tmp, ('DATABASE_URL=' + $url + "`n"))
      if ($okExpected) { Check ($s + ' env accepts: ' + $k) ((& $rd $tmp) -ceq 'x') }
      else {
        Check ($s + ' env rejects: ' + $k) (Throws { & $rd $tmp })
        if ($caseOnly) { Check ($s + ' REGRESSION PROOF env (old ops accept): ' + $k) ((& $rdOld $tmp) -ceq 'x') }
      }
    }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

Write-Host ('Ket qua: ' + $script:pass + ' PASS, ' + $script:failed.Count + ' FAIL')
if ($script:failed.Count -gt 0) { Write-Host 'KHONG DAT' -ForegroundColor Red; exit 1 } else { Write-Host 'DAT (offline, khong database)' -ForegroundColor Green; exit 0 }
