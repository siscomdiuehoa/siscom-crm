# SISCOM CRM B1.2.3-B2 P1 - KHOA BASELINE: doi chieu bao cao r5-C (scen_*.json) voi tieu chi nghiem thu, roi sao chep + bam SHA256 toan bo bang chung P1.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\lock-p1-baseline.ps1 (file moi). KHONG ket noi database, KHONG doc .env, KHONG xoa/ghi de file nao.
# Chi COPY tu thu muc ket qua sang thu muc bang chung moi (phai chua ton tai hoac rong), tinh SHA256, dat thuoc tinh chi-doc. Dung ngay neu tieu chi nao KHONG DAT (khong khoa).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ScenFile,
  [string]$SourceDir = 'D:\SISCOM-CRM\backups\b123',
  [string]$EvidenceDir = 'D:\SISCOM-CRM\docs\evidence\B1.2.3-B2-P1'
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$script:fail = $false
$checks = New-Object System.Collections.Generic.List[object]
function Chk([string]$n, [bool]$ok, [string]$d) { $checks.Add([pscustomobject]@{ DieuKien = $n; KetQua = $(if ($ok) { 'DAT' } else { 'KHONG DAT' }); ChiTiet = $d }) }
try {
  if (-not (Test-Path -LiteralPath $ScenFile)) { throw ('Khong thay file: ' + $ScenFile) }
  if (-not (Test-Path -LiteralPath $SourceDir)) { throw ('Khong thay thu muc ket qua: ' + $SourceDir) }
  $j = Get-Content -LiteralPath $ScenFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $sm = $j.scenarioSummary
  $g = @($j.scenarioGroups)
  Chk 'ScenariosOnly day du (khong FailedOnly): acceptanceScope = FULL' ([string]$j.acceptanceScope -like 'FULL*') ([string]$j.acceptanceScope)
  Chk 'scenarioSummary.fullSuite = true' ($sm.fullSuite -eq $true) ('fullSuite=' + $sm.fullSuite)
  Chk 'planned = 22 va pass = 22' (($sm.planned -eq 22) -and ($sm.pass -eq 22)) ('planned=' + $sm.planned + ' pass=' + $sm.pass)
  Chk 'fail = skipped = notRunByDesign = neverReached = 0' (($sm.fail -eq 0) -and ($sm.skipped -eq 0) -and ($sm.notRunByDesign -eq 0) -and ($sm.neverReached -eq 0)) ('fail=' + $sm.fail + ' skipped=' + $sm.skipped + ' notRun=' + $sm.notRunByDesign + ' neverReached=' + $sm.neverReached)
  Chk 'so nhom trong bao cao = 22' ($g.Count -eq 22) ('count=' + $g.Count)
  Chk 'moi nhom outcome = PASS' (@($g | Where-Object { $_.outcome -ne 'PASS' }).Count -eq 0) ''
  Chk 'moi nhom rollbackVerified = true' (@($g | Where-Object { $_.rollbackVerified -ne $true }).Count -eq 0) ''
  Chk 'moi nhom fingerprintEqual = true' (@($g | Where-Object { $_.fingerprintEqual -ne $true }).Count -eq 0) ''
  Chk 'moi nhom lingeringSessions = 0' (@($g | Where-Object { $_.lingeringSessions -ne 0 }).Count -eq 0) ''
  $s0 = @($g | Where-Object { $_.group -like 'S0a*' })
  Chk 'S0a: actualStatus = expectedStatus = ERROR' (($s0.Count -eq 1) -and ($s0[0].actualStatus -eq 'ERROR') -and ($s0[0].expectedStatus -eq 'ERROR')) ''
  $sc = @($g | Where-Object { $_.group -notlike 'S0a*' })
  Chk '21 kich ban nghiep vu co mat' ($sc.Count -eq 21) ('count=' + $sc.Count)
  $badVar = @($sc | Where-Object { $v = $_.detail.variants; (-not $v) -or (@($v.PSObject.Properties).Count -ne 8) -or (@($v.PSObject.Properties | Where-Object { $_.Value.ok -ne $true }).Count -gt 0) })
  Chk 'moi kich ban: du 8 bien the, tat ca khop V1 (ok = true)' ($badVar.Count -eq 0) ('nhom loi=' + $badVar.Count)
  $badDiag = @($sc | Where-Object { @($_.detail.diag).Count -gt 0 })
  Chk 'khong co STATEMENT_TIMEOUT / LOCAL_DEADLINE / loi buoc (detail.diag rong)' ($badDiag.Count -eq 0) ('nhom co diag=' + $badDiag.Count)
  Chk 'failures rong' (@($j.failures).Count -eq 0) ('failures=' + @($j.failures).Count)
  Chk 'haltReason rong' (-not $j.haltReason) ([string]$j.haltReason)
  Chk 'khong co vacuumError' (-not $j.vacuumError) ([string]$j.vacuumError)
  Chk 'snapshotBefore = snapshotAfter (fingerprint dau = cuoi)' ((($j.snapshotBefore | ConvertTo-Json -Compress) -eq ($j.snapshotAfter | ConvertTo-Json -Compress)) -and ($null -ne $j.snapshotBefore)) ''
  Chk 'statsPrecheck co mat (ban sao da ANALYZE)' ($null -ne $j.statsPrecheck) (($j.statsPrecheck | ConvertTo-Json -Compress))
  Chk 'database la ban sao siscom_crm_restore_*' ([string]$j.database.name -match '^siscom_crm_restore_\d{8}_\d{6}$') ([string]$j.database.name)
  Chk 'nhom 15 dung so dien thoai that' ($null -ne $j.realPhoneUsed) (($j.realPhoneUsed | ConvertTo-Json -Compress))
  $checks | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
  $bad = @($checks | Where-Object { $_.KetQua -ne 'DAT' })
  if ($bad.Count -gt 0) { throw ('Co ' + $bad.Count + ' dieu kien KHONG DAT -> KHONG khoa baseline.') }
  Write-Host '[DAT] Bao cao r5-C thoa tat ca tieu chi.' -ForegroundColor Green
  if ((Test-Path -LiteralPath $EvidenceDir) -and (@(Get-ChildItem -LiteralPath $EvidenceDir -Force).Count -gt 0)) { throw ('Thu muc bang chung da co noi dung (khong ghi de): ' + $EvidenceDir) }
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  $patterns = @('bench_*.json', 'bench_plans_*.json', 'proof_*.json', 'scen_*.json', 'stats_clone_*.json', 'timeout_probe_*.json', 'search_*.txt', 'timeout_probe_*.txt', 'stats_clone_*.txt', 'make_stats_clone_*.txt')
  $files = @(); foreach ($p in $patterns) { $files += @(Get-ChildItem -LiteralPath $SourceDir -Filter $p -File -ErrorAction SilentlyContinue) }
  $files = @($files | Sort-Object FullName -Unique)
  if ($files.Count -eq 0) { throw 'Khong co file bang chung nao trong thu muc ket qua.' }
  $manifest = @()
  foreach ($f in $files) {
    $dest = Join-Path $EvidenceDir $f.Name
    Copy-Item -LiteralPath $f.FullName -Destination $dest
    $h = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    $manifest += [pscustomobject]@{ name = $f.Name; sizeBytes = $f.Length; sha256 = $h; lastWriteUtc = $f.LastWriteTimeUtc.ToString('o') }
    Set-ItemProperty -LiteralPath $dest -Name IsReadOnly -Value $true
  }
  ($manifest | ForEach-Object { $_.sha256 + '  ' + $_.name }) | Set-Content -LiteralPath (Join-Path $EvidenceDir 'MANIFEST.sha256.txt') -Encoding ASCII
  ($manifest | ConvertTo-Json -Depth 3) | Set-Content -LiteralPath (Join-Path $EvidenceDir 'MANIFEST.json') -Encoding UTF8
  Write-Host ('[DAT] Da khoa baseline: ' + $files.Count + ' file bang chung -> ' + $EvidenceDir + ' (chi-doc, co SHA256).') -ForegroundColor Green
  Write-Host 'Khuyen nghi: sao luu thu muc nay; chep them thu cong cac goi ZIP ma nguon r1..r5-C da giao vao cung thu muc de doi chieu.'
}
catch {
  Write-Host ('[LOI] ' + $_.Exception.Message) -ForegroundColor Red
  $script:fail = $true
}
if ($script:fail) { Write-Host 'KET QUA: KHONG KHOA BASELINE.' -ForegroundColor Red; exit 1 } else { Write-Host 'KET QUA: baseline P1 da khoa.' -ForegroundColor Green }
