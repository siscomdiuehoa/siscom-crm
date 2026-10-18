# SISCOM CRM B1.2.3 - DOI CHIEU MA NGUON BACKEND THAT voi ban thiet ke (CHI DOC).
# Dich: D:\SISCOM-CRM\backend\scripts\windows\verify-baseline-b123.ps1 (file moi)
# Khong ket noi PostgreSQL, KHONG doc/ghi .env, khong sua bat ky file nao. Chi ghi 1 file log vao D:\SISCOM-CRM\backups\b123.
# SHA-256 duoc tinh sau khi: bo BOM dau file, doi CRLF -> LF (de Windows khong gay khac biet gia).
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path (Split-Path $root -Parent) 'backups\b123'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ('baseline_check_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c; Add-Content -LiteralPath $log -Value $m -Encoding UTF8 }
function NormHash([string]$p) {
  $t = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($p))
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  $t = $t.Replace("`r`n", "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($t)))).Replace('-', '') } finally { $sha.Dispose() }
}
$expected = @(
  @{ P = 'src/app.module.ts'; H = '93C6176EAC300F437181B5EE2F4CF5852BE999103FF6FB7D65A1FD631E520874' }
  @{ P = 'src/app.setup.ts'; H = 'BF4A2D240DDCD958E1C59DF20EA074DE6545507737F65A9BBCE398B530141C13' }
  @{ P = 'src/main.ts'; H = '14CD6B658C95D8A2D9214E2B5CA2AC8A00E79937B7AF4A072B91679707878072' }
  @{ P = 'src/common/filters/all-exceptions.filter.ts'; H = 'B630E9F36508D9877832E2B553A48FCFC30A2D147AB185B84237A966DF65975D' }
  @{ P = 'src/common/middleware/request-context.middleware.ts'; H = 'C18764C5750B71333159D4B4BF5BFD341AFC01AE830D268C9C61800A4336EC7C' }
  @{ P = 'src/config/env.validation.ts'; H = 'C6A887EB6D8C80BE68B9CA60C7DA5B8E44A19481291543851739FD91CD708177' }
  @{ P = 'src/health/health.controller.ts'; H = '432E8FD8DA08AFB114A12249D9E114B842A27F5F380B1D6EF9EEBCEE18FB549F' }
  @{ P = 'src/health/health.module.ts'; H = 'BF4033948A55D92DB1ECE7CB444900866C2C4A14A0F65E1FC71A1C35CABA266F' }
  @{ P = 'src/health/health.service.ts'; H = 'DA269AF181C5DC4E6690F13D5C90B11502BD0239EB09284EAA50906F68D51FAB' }
  @{ P = 'src/prisma/prisma.module.ts'; H = '0CDED004A66F8E902920BC1762ED229B6514E581D5C6AB601F42691A223EB167' }
  @{ P = 'src/prisma/prisma.service.ts'; H = '44DE7C7021CF7D02FBCAD2FEB45DC80C1FA70C8342BA329FA193D165C6D4CAE9' }
  @{ P = 'test/health.e2e-spec.ts'; H = '2E496627C1AC8F733811037856E138CB29867CFE95EEDE5D4808CA739759BD93' }
  @{ P = 'test/jest-e2e.json'; H = 'D3257B229F3D7248DD3880043FCB6CB4F7C2675EB31293D7BCEE1053085C6EED' }
  @{ P = 'package.json'; H = 'C98548FBBC8172E306715E867CC3BC6C0182E4087D27FB0F4998F6ABBD0963A7' }
  @{ P = 'prisma.config.ts'; H = '58FF11A5DB83446522E8A526EA63CE42B94231E81ABD683623FBA492F1A10DF9' }
  @{ P = 'prisma/migrations/20261011000000_init/migration.sql'; H = 'C41E574BFA36DAC32F46AA742D1C5301413B5630DED3CBB0B8BF84C6CCE8EAFB' }
  @{ P = 'prisma/migrations/migration_lock.toml'; H = '99836963713B4F5B269AD49AF0ED3D7B0B2E336115C2F92DC9AC683D139D0900' }
  @{ P = 'prisma/schema.prisma'; H = 'BE6DCE77B02022A9F970D5AF6C17CB6802890645ECB8C0E293A1E9DCC8687D5E' }
)
Say ('Thu muc backend: ' + $root)
if ((Split-Path $root -Leaf) -ne 'backend') { Say '[CANH BAO] Thu muc cha khong ten "backend" - kiem tra vi tri script.' 'Yellow' }
$same = 0; $diff = @(); $miss = @()
foreach ($e in $expected) {
  $p = Join-Path $root ($e.P -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p)) { $miss += $e.P; Say ('[THIEU]  ' + $e.P) 'Red'; continue }
  if ((NormHash $p) -eq $e.H) { $same++; Say ('[KHOP]   ' + $e.P) 'Green' } else { $diff += $e.P; Say ('[KHAC]   ' + $e.P) 'Red' }
}
Say ''
Say 'Cau truc thuc te (chi liet ke ten):'
$src = Join-Path $root 'src'
if (Test-Path -LiteralPath $src) {
  $dirs = Get-ChildItem -LiteralPath $src -Directory -Recurse | Where-Object { $_.FullName -notmatch '\\generated(\\|$)' } | ForEach-Object { $_.FullName.Substring($root.Length + 1) } | Sort-Object
  $dirs | ForEach-Object { Say ('  ' + $_) }
  $mods = $dirs | Where-Object { $_ -like 'src\modules*' }
  if ($mods) { Say '[LUU Y] Da co src\modules (khac ban thiet ke, can doc lai).' 'Yellow' } else { Say '[DAT] Chua co src\modules (dung gia dinh cua ban thiet ke).' 'Green' }
  $extra = Get-ChildItem -LiteralPath $src -Recurse -File -Filter *.ts | Where-Object { $_.FullName -notmatch '\\generated(\\|$)' } | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
  $known = $expected | ForEach-Object { $_.P }
  $unk = $extra | Where-Object { $known -notcontains $_ }
  if ($unk) { Say 'File .ts ngoai danh sach da doi chieu:' 'Yellow'; $unk | ForEach-Object { Say ('  ' + $_) 'Yellow' } } else { Say '[DAT] Khong co file .ts nao ngoai danh sach da doi chieu.' 'Green' }
} else { Say '[THIEU] Khong thay thu muc src.' 'Red' }
$mig = Join-Path $root 'prisma\migrations'
if (Test-Path -LiteralPath $mig) { Say ('prisma\migrations: ' + ((Get-ChildItem -LiteralPath $mig | ForEach-Object { $_.Name } | Sort-Object) -join ', ')) }
$gen = Join-Path $root 'src\generated\prisma'
if (Test-Path -LiteralPath $gen) {
  $hit = Get-ChildItem -LiteralPath $gen -Recurse -File -Filter *.ts | Select-String -Pattern 'phoneE164' -List | Select-Object -First 1
  if ($hit) { Say '[DAT] Prisma Client da sinh tu schema B1.2.2 (co truong phoneE164).' 'Green' } else { Say '[KHONG DAT] Prisma Client trong src\generated\prisma khong co phoneE164: chay npx prisma generate.' 'Red' }
} else { Say '[THIEU] Chua co src\generated\prisma (chay npx prisma generate).' 'Red' }
try { $pj = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json; foreach ($k in '@nestjs/core', '@prisma/client', '@prisma/adapter-pg', 'prisma', 'class-validator', 'class-transformer', 'typescript') { $v = $null; if ($pj.dependencies.PSObject.Properties[$k]) { $v = $pj.dependencies.$k } elseif ($pj.devDependencies.PSObject.Properties[$k]) { $v = $pj.devDependencies.$k }; Say ('  ' + $k + ' = ' + $(if ($v) { $v } else { '(khong co)' })) } } catch { Say 'Khong doc duoc package.json.' 'Red' }
try { Say ('node ' + (& node -v)) } catch { Say 'Khong chay duoc node -v.' 'Yellow' }
Say ''
Say ('Tong ket: KHOP ' + $same + ' / ' + $expected.Count + ' ; KHAC ' + $diff.Count + ' ; THIEU ' + $miss.Count)
if ($diff.Count -eq 0 -and $miss.Count -eq 0) { Say 'KET QUA: ma nguon that KHOP ban thiet ke.' 'Green' } else { Say 'KET QUA: CO KHAC BIET. Gui toi file log va noi dung cac file [KHAC]/[THIEU]; thiet ke se duoc doi chieu lai truoc khi lap trinh.' 'Red' }
Write-Host ('Log: ' + $log)
