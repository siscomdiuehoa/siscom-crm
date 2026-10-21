# Kiem thu OFFLINE cho make-stats-clone.guards.ps1 + kiem tra tinh (static) make-stats-clone.ps1.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\tests\make-stats-clone.guards.tests.ps1 (file moi).
# KHONG ket noi PostgreSQL, KHONG doc .env, KHONG chay make-stats-clone.ps1, KHONG hoi mat khau. Chi dung chuoi gia (mat khau gia 'x').
# Chay: powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\windows\tests\make-stats-clone.guards.tests.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
. (Join-Path $dir 'make-stats-clone.guards.ps1')
$script:pass = 0; $script:failed = @()
function Check([string]$name, [bool]$ok) { if ($ok) { $script:pass++ } else { $script:failed += $name; Write-Host ('  FAIL: ' + $name) -ForegroundColor Red } }
function Throws([scriptblock]$b) { try { & $b | Out-Null; return $false } catch { return ($_.Exception -is [System.ApplicationException]) } }

$good = 'siscom_crm_restore_20261014_214105'
$good2 = 'siscom_crm_restore_20261022_101500'
$arabic = 'siscom_crm_restore_' + ([string][char]0x0662 * 8) + '_214105'      # chu so Arabic-Indic (\d cu khop)
$fullwidth = 'siscom_crm_restore_' + ([string][char]0xFF12 * 8) + '_214105'    # chu so full-width
$devanagari = 'siscom_crm_restore_20261014_' + ([string][char]0x0967 * 6)
$bad = [ordered]@{
  'trailing LF'         = $good + "`n"
  'trailing CRLF'       = $good + "`r`n"
  'trailing space'      = $good + ' '
  'trailing tab'        = $good + "`t"
  'leading space'       = ' ' + $good
  'uppercase'           = $good.ToUpper()
  'mixed case'          = 'Siscom_crm_restore_20261014_214105'
  'arabic-indic digits' = $arabic
  'fullwidth digits'    = $fullwidth
  'devanagari digits'   = $devanagari
  'siscom_crm_dev'      = 'siscom_crm_dev'
  'test prefix'         = 'siscom_crm_test_20261014_214105'
  'embedded newline'    = "siscom_crm_restore_20261014`n_214105"
  'sql injection'       = "siscom_crm_restore_20261014_214105'; DROP DATABASE siscom_crm_dev;--"
  'quote'               = "siscom_crm_restore_20261014_214105'"
  'semicolon'           = 'siscom_crm_restore_20261014_214105;'
  'double quote'        = 'siscom_crm_restore_20261014_214105"'
  'too short'           = 'siscom_crm_restore_2026101_214105'
  'too long'            = 'siscom_crm_restore_202610145_214105'
  'extra suffix'        = $good + '_x'
  'empty'               = ''
  'whitespace only'     = '   '
}
Check 'accept ASCII name' (Test-RestoreDbName $good)
Check 'reject $null' (-not (Test-RestoreDbName $null))
foreach ($k in $bad.Keys) { Check ('Test-RestoreDbName rejects: ' + $k) (-not (Test-RestoreDbName $bad[$k])) }

# Assert-CloneNames: hop le
Check 'Assert ok (distinct ASCII)' (-not (Throws { Assert-CloneNames $good $good2 }))
# Assert-CloneNames: nguon xau / ban sao xau
foreach ($k in $bad.Keys) {
  Check ('Assert rejects bad SOURCE: ' + $k) (Throws { Assert-CloneNames $bad[$k] $good2 })
  Check ('Assert rejects bad CLONE: ' + $k) (Throws { Assert-CloneNames $good $bad[$k] })
}
# nguon == ban sao (ke ca khac hoa/thuong va khac xuong dong cuoi -> van bi chan, boi ten dinh dang)
Check 'Assert rejects source == clone' (Throws { Assert-CloneNames $good $good })
Check 'Assert rejects source == clone (2nd name)' (Throws { Assert-CloneNames $good2 $good2 })
Check 'Assert rejects source == clone + LF' (Throws { Assert-CloneNames $good ($good + "`n") })
Check 'Assert rejects source == clone upper' (Throws { Assert-CloneNames $good $good.ToUpper() })
# ban sao la baseline khoa
Check 'Assert rejects locked baseline as CLONE (1)' (Throws { Assert-CloneNames $good2 'siscom_crm_restore_20261014_214105' })
Check 'Assert rejects locked baseline as CLONE (2)' (Throws { Assert-CloneNames $good2 'siscom_crm_restore_20261015_214948' })
Check 'Assert allows locked baseline as SOURCE (read-only template)' (-not (Throws { Assert-CloneNames 'siscom_crm_restore_20261014_214105' $good2 }))
# Thong bao loi la ApplicationException (script chinh bat va in thong diep, khong lo chi tiet)
Check 'Guard-Fail throws ApplicationException' (Throws { Guard-Fail 'x' })

# New-CloneTimestamp: ASCII ke ca khi locale/lich la ar-SA, th-TH, fa-IR
$orig = [System.Threading.Thread]::CurrentThread.CurrentCulture
try {
  foreach ($c in 'ar-SA', 'th-TH', 'fa-IR', 'en-US') {
    [System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo($c)
    $ts = New-CloneTimestamp
    Check ('timestamp ASCII under ' + $c) ($ts -cmatch '^[0-9]{8}_[0-9]{6}\z')
    Check ('default clone name valid under ' + $c) (Test-RestoreDbName ('siscom_crm_restore_' + $ts))
    Check ('timestamp year is Gregorian under ' + $c) ($ts.Substring(0, 4) -eq (Get-Date).Year.ToString([System.Globalization.CultureInfo]::InvariantCulture))
  }
} finally { [System.Threading.Thread]::CurrentThread.CurrentCulture = $orig }

# Get-AppPasswordFromUrl (chuoi gia, mat khau gia 'x')
$okUrl = 'postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev'
Check 'URL ok returns password' ((Get-AppPasswordFromUrl $okUrl) -ceq 'x')
Check 'URL ok default port' ((Get-AppPasswordFromUrl 'postgresql://siscom_app:x@127.0.0.1/siscom_crm_dev') -ceq 'x')
Check 'URL ok scheme postgres://' ((Get-AppPasswordFromUrl 'postgres://siscom_app:x@127.0.0.1:5432/siscom_crm_dev') -ceq 'x')
$badUrls = [ordered]@{
  'wrong host localhost'  = 'postgresql://siscom_app:x@localhost:5432/siscom_crm_dev'
  'wrong host remote'     = 'postgresql://siscom_app:x@10.0.0.5:5432/siscom_crm_dev'
  'wrong host ::1'        = 'postgresql://siscom_app:x@[::1]:5432/siscom_crm_dev'
  'host suffix trick'     = 'postgresql://siscom_app:x@127.0.0.1.evil.example:5432/siscom_crm_dev'
  'userinfo host trick'   = 'postgresql://siscom_app:x@evil.example:5432@127.0.0.1/siscom_crm_dev'
  'wrong user'            = 'postgresql://postgres:x@127.0.0.1:5432/siscom_crm_dev'
  'user case'             = 'postgresql://SISCOM_APP:x@127.0.0.1:5432/siscom_crm_dev'
  'wrong port'            = 'postgresql://siscom_app:x@127.0.0.1:5433/siscom_crm_dev'
  'wrong scheme'          = 'mysql://siscom_app:x@127.0.0.1:5432/siscom_crm_dev'
  'http scheme'           = 'http://siscom_app:x@127.0.0.1:5432/siscom_crm_dev'
  'other database'        = 'postgresql://siscom_app:x@127.0.0.1:5432/other_db'
  'no password'           = 'postgresql://siscom_app@127.0.0.1:5432/siscom_crm_dev'
  'empty password'        = 'postgresql://siscom_app:@127.0.0.1:5432/siscom_crm_dev'
  'not a url'             = 'not a url'
  'empty'                 = ''
}
foreach ($k in $badUrls.Keys) { Check ('URL rejects: ' + $k) (Throws { Get-AppPasswordFromUrl $badUrls[$k] }) }
# Thong diep loi khong chua mat khau
$leak = $false
try { Get-AppPasswordFromUrl 'postgresql://siscom_app:SECRETPW@evil.example:5432/siscom_crm_dev' | Out-Null } catch { if ($_.Exception.Message -match 'SECRETPW') { $leak = $true } }
Check 'error message does not contain password' (-not $leak)

# Static: make-stats-clone.ps1 phai dung guard, khong con regex/so sanh yeu
$main = [IO.File]::ReadAllText((Join-Path $dir 'make-stats-clone.ps1'))
Check 'static: dot-sources guards' ($main -match [regex]::Escape("make-stats-clone.guards.ps1"))
Check 'static: no \d in name patterns' (-not ($main -match "siscom_crm_restore_\\d"))
Check 'static: no -notmatch $pat' (-not ($main -match '-notmatch\s+\$pat'))
Check 'static: no locale-dependent Get-Date -Format yyyyMMdd...' (-not ($main -match "Get-Date\s+-Format\s+'yyyy"))
Check 'static: confirmations are case-sensitive' (([regex]::Matches($main, "Read-Host '[^']*'\)\s+-cne")).Count -eq 3)
Check 'static: no case-insensitive -ne on Read-Host' (-not ($main -match "Read-Host '[^']*'\)\s+-ne"))
$iAssert = $main.LastIndexOf('Assert-CloneNames $SourceDatabase $CloneDatabase')
$iSecret = $main.IndexOf("= Read-Secret 'Mat khau")
$iCreate = $main.IndexOf("'CREATE DATABASE '")
Check 'static: Assert-CloneNames appears twice' (([regex]::Matches($main, 'Assert-CloneNames \$SourceDatabase \$CloneDatabase')).Count -eq 2)
Check 'static: last Assert before password prompt and CREATE' ($iAssert -gt 0 -and $iAssert -lt $iSecret -and $iSecret -lt $iCreate)
Check 'static: first Assert before first interactive prompt' (($main.IndexOf('Assert-CloneNames')) -lt ($main.IndexOf('(Read-Host ''Go lai')))
Check 'static: interactive confirmations preserved' ($main.Contains("'TAO-BAN-SAO'") -and $main.Contains('Read-Secret'))
Check 'static: password never in Say/log' (-not ($main -match 'Say\s*\(?[^\r\n]*\$(adminPw|appPw)'))
Check 'static: no DROP/TRUNCATE/DELETE statements executed' (-not ($main -match "Run-Psql[^\r\n]*(DROP|TRUNCATE|DELETE)\s"))
Check 'static: template used read-only (no write against source)' (-not ($main -match "Run-Psql 'siscom_app' \$appPw \$SourceDatabase [^\r\n]*(INSERT|UPDATE|ALTER|CREATE)"))

Write-Host ('PASS: ' + $script:pass + ' | FAIL: ' + $script:failed.Count)
if ($script:failed.Count -gt 0) { Write-Host 'KET QUA: KHONG DAT.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: DAT (offline, khong ket noi database).' -ForegroundColor Green }