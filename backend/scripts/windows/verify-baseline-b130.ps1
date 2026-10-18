# SISCOM CRM B1.3 - DOI CHIEU MA NGUON BACKEND THAT (CHI DOC) truoc khi khoa thiet ke B1.3.1 / bat dau B1.3.2.
# Dich: D:\SISCOM-CRM\backend\scripts\windows\verify-baseline-b130.ps1 (file moi). KHONG doc/ghi .env, KHONG ket noi PostgreSQL, KHONG sua file nao. Chi ghi 1 log vao D:\SISCOM-CRM\backups\b130.
# Danh sach ky vong = trang thai cong don cac goi da giao (B1.1 -> B1.2.3-B1 -> B2 -> patch1 -> fix1 -> P2-1 -> P2-2 -> P2-3B0). Chua kiem chung tren may that; ket qua [KHAC] la thong tin, khong phai loi.
# rev.2 (2026-10-18): 3 file Jest (jest-unit/jest-customers-e2e/jest-perf .json) cap nhat theo ban hien co sau doi chieu (tuong duong ngu nghia, xem docs\B1.3.0_BASELINE_JEST_RECONCILIATION.md).
# SHA-256 tinh sau khi bo BOM dau file va doi CRLF -> LF.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path (Split-Path $root -Parent) 'backups\b130'
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
  @{ P = 'package.json'; H = 'C038ACA0102B7548DF6D7B05397D111970472ACB5426AE530C11055103E52C7C' }
  @{ P = 'prisma.config.ts'; H = '58FF11A5DB83446522E8A526EA63CE42B94231E81ABD683623FBA492F1A10DF9' }
  @{ P = 'prisma/migrations/20261011000000_init/migration.sql'; H = 'C41E574BFA36DAC32F46AA742D1C5301413B5630DED3CBB0B8BF84C6CCE8EAFB' }
  @{ P = 'prisma/migrations/migration_lock.toml'; H = '99836963713B4F5B269AD49AF0ED3D7B0B2E336115C2F92DC9AC683D139D0900' }
  @{ P = 'prisma/schema.prisma'; H = 'BE6DCE77B02022A9F970D5AF6C17CB6802890645ECB8C0E293A1E9DCC8687D5E' }
  @{ P = 'src/app.module.ts'; H = 'BCACB47AAF0D074BC7F5EE586BE94F931C05BEE401380617EF704CFA3CD55686' }
  @{ P = 'src/app.setup.ts'; H = 'BF4A2D240DDCD958E1C59DF20EA074DE6545507737F65A9BBCE398B530141C13' }
  @{ P = 'src/common/audit/audit.port.ts'; H = 'A748B5540E5F1F045A99A4F5E1BE898A4B1EEE09E6F99067AFE1970EAC533BF7' }
  @{ P = 'src/common/auth/actor.decorator.ts'; H = '6ADCB4B6EF7458D247356E7526904768E38253CAF2D40AD2F0CA3161528A2AC3' }
  @{ P = 'src/common/auth/actor.guard.ts'; H = 'E9ADC64166A64F2ED441CA9A3224242054FED65F6F9B9F29A39F0533FC22D6F2' }
  @{ P = 'src/common/auth/actor.ts'; H = 'E381ECC43A2899C6A19303E99BE0B728D82D979EEE77214EFF62D2C3E855CAFF' }
  @{ P = 'src/common/auth/auth.module.ts'; H = '1F45E34A50B6180E5489300706F4258FE483E5244196FE862605DE4DFA5D6C55' }
  @{ P = 'src/common/auth/deny-all-actor.provider.ts'; H = 'D8B0741F175834EEDA01D629D5DF1A52C5D45A1FE45B9B256B414CEFFB3BB8EC' }
  @{ P = 'src/common/auth/scope.spec.ts'; H = 'B801D14B33E00BA30259D4B787882A24673CB5E61CD075F04A3C4424CA1C2763' }
  @{ P = 'src/common/auth/scope.ts'; H = 'CC5D0EE180688DFA4D3B7BCB186F7FC108A8F97783EF21F328F33900682BAC01' }
  @{ P = 'src/common/errors/domain.exception.ts'; H = '9AFF2C63541A82B0B6260D635B4489152C0153D33AE95DA69F4FF01FF4A2065C' }
  @{ P = 'src/common/errors/prisma-error.mapper.spec.ts'; H = 'EF229B9C120B7E5275C150309EC2591DCAA1EF8FF91A343574C0E0702EADFA21' }
  @{ P = 'src/common/errors/prisma-error.mapper.ts'; H = '633315F8EAACDA23B8DCCF17AD4BAD3050F327EABFCF164AE55E02861E225EBE' }
  @{ P = 'src/common/filters/all-exceptions.filter.spec.ts'; H = '58F30B9E068735F398A9F4891CA046658BAA2810B9D36D69BC74D5922EDC7FE3' }
  @{ P = 'src/common/filters/all-exceptions.filter.ts'; H = 'E09C2DA7D2580791E4C744F5486D78E1B671CBCF7CEB632D8359B892F4304149' }
  @{ P = 'src/common/middleware/request-context.middleware.ts'; H = 'C18764C5750B71333159D4B4BF5BFD341AFC01AE830D268C9C61800A4336EC7C' }
  @{ P = 'src/config/env.validation.ts'; H = 'C6A887EB6D8C80BE68B9CA60C7DA5B8E44A19481291543851739FD91CD708177' }
  @{ P = 'src/health/health.controller.ts'; H = '432E8FD8DA08AFB114A12249D9E114B842A27F5F380B1D6EF9EEBCEE18FB549F' }
  @{ P = 'src/health/health.module.ts'; H = 'BF4033948A55D92DB1ECE7CB444900866C2C4A14A0F65E1FC71A1C35CABA266F' }
  @{ P = 'src/health/health.service.ts'; H = 'DA269AF181C5DC4E6690F13D5C90B11502BD0239EB09284EAA50906F68D51FAB' }
  @{ P = 'src/main.ts'; H = '14CD6B658C95D8A2D9214E2B5CA2AC8A00E79937B7AF4A072B91679707878072' }
  @{ P = 'src/modules/customers/contacts.controller.ts'; H = '74EE4DE607EB21241022EDDC9194CFB74D35C18B0A602235B86B6E296DA5C3FE' }
  @{ P = 'src/modules/customers/customers.contacts.service.spec.ts'; H = '1EBA6E0540ABC95D7444BF95F887A67660E49087C1AD60F3B5DD79C4E46C8065' }
  @{ P = 'src/modules/customers/customers.contacts.service.ts'; H = '7EE68D8AAC12E5E3A714C1CBEE4EC874A6A262A0C6B8E362DF44DAEE4BC9BF47' }
  @{ P = 'src/modules/customers/customers.controller.ts'; H = 'BC80BDF8E6341C19188A1F45C6F0A16418E73B519E6E0DA8EA131672A89C6B61' }
  @{ P = 'src/modules/customers/customers.defaults.ts'; H = 'BC991C4CD505BA6732E0C01FF90454C64F00672FC3BC74FF676BDB4D9C7C83BA' }
  @{ P = 'src/modules/customers/customers.deletion-guard.ts'; H = '054AAEF58EC9E01947E8C4B80013CBD3FE08A2E28BBF214945352433B00CC6E4' }
  @{ P = 'src/modules/customers/customers.errors.ts'; H = '83C7BA46028BE9DF791682638D455B358C19361810A80FB04458E328BD17D4A9' }
  @{ P = 'src/modules/customers/customers.http.spec.ts'; H = '905AE3B61E7E7C3F052B469E17A757A2EEADDBC9B0B62AFA312A082B535243B5' }
  @{ P = 'src/modules/customers/customers.mapper.ts'; H = '29852A9585B7EAEFC36D28D1EF927FB6B89DD3350AFBF3CA5B57200856EEE50C' }
  @{ P = 'src/modules/customers/customers.module.ts'; H = 'FA4D0265549BE20708DC29B063A970F39DB9E3ED0CB69B9EA5DAB994A8CB964A' }
  @{ P = 'src/modules/customers/customers.queries.ts'; H = '11C7DA470DEAF328F82DDE377480AF877E32FF8B9586C5F1C552B84D942D546C' }
  @{ P = 'src/modules/customers/customers.search.spec.ts'; H = '48EAAC1B617FE8AFDEEBD80D040D24085AEA8A2DE476783647DB5D5528F3D6E3' }
  @{ P = 'src/modules/customers/customers.search.ts'; H = '070B1EE420FFA2B0A016ED7B0D6514FF7E8C180EAA78B107BB0C8AA3B87BFAA6' }
  @{ P = 'src/modules/customers/customers.service.spec.ts'; H = '47E09B01F7D4BEF4B76E68D93F7C5612CACEF78D56F1FF20B1EF24BC40048766' }
  @{ P = 'src/modules/customers/customers.service.ts'; H = 'D37DC6FE064A61C363390CABA6DAEC8CAD8D13B7ACB65BF42389C862D81EB10D' }
  @{ P = 'src/modules/customers/dto/create-contact.dto.ts'; H = '406E985B106694C4A73894F57BA77000A8E6B065E5B22F9BF2F287CF76F9D8E7' }
  @{ P = 'src/modules/customers/dto/create-customer.dto.ts'; H = '056AA196086B19417A918264D6E6F5E691EB1F3B8F37EBD4F1E7B8426F0D939B' }
  @{ P = 'src/modules/customers/dto/customer-dto.spec.ts'; H = '70B41330D7C311B396D7726E7E64FF9D599B2E076683684E375B056C37A3B4C7' }
  @{ P = 'src/modules/customers/dto/dto-helpers.ts'; H = 'AD6EE8BBC19EA15070BD74ECBF541F374CC5CCFCEA0C8CAFB0569E98A33AD77C' }
  @{ P = 'src/modules/customers/dto/query-customers.dto.ts'; H = 'E02AE2BCE25447E8DD4AF178B7F354367D55B8A24F610E040DC0E864FA2C14CC' }
  @{ P = 'src/modules/customers/dto/update-customer.dto.ts'; H = '1570970B0CC448DAB5ED811D6B7083E59C5B6A89A8822808383846E9D318DBD2' }
  @{ P = 'src/modules/customers/static-guards.spec.ts'; H = 'B492A7CC71E0F4349D4F92B1DB385E79B7C2DF0B29FB5F1FE5B05F6EF50A66C9' }
  @{ P = 'src/modules/customers/validators/make-decorator.ts'; H = 'C466F77AB2B8358E050FC46F9FACEEDC37DB2D988AD4E7DB94009A5AFB4B0DF3' }
  @{ P = 'src/modules/customers/validators/vn-email.ts'; H = 'F7F71AE4E14D4E4A24F63E8435E76F1100B032D110312174D18C20D72EA28AFA' }
  @{ P = 'src/modules/customers/validators/vn-phone.ts'; H = '8DD1505A119B5DD709E13479F4FA945169B184BDE23B17B208E8F9EC9514C649' }
  @{ P = 'src/modules/customers/validators/vn-rules.spec.ts'; H = '54C666635AA41C00680A967730C56ADAF1E594E56486453CF7B927B6D1F3A317' }
  @{ P = 'src/modules/customers/validators/vn-tax-id.ts'; H = '4EBD848EF1E7BA5B3FE3EA88929B05DCE0BD374D25464F113D4843CBE7EF94C8' }
  @{ P = 'src/modules/customers/validators/vn-website.ts'; H = '726D0BECD69D2202F19D9358DAC87ED5C0A9DF0E4BCF23BD3DAE8080B20393C7' }
  @{ P = 'src/modules/lookups/dto/query-lookups.dto.ts'; H = 'F24BC66E08CB75D9DE6616F94E57833DC59CF16C9C5A6F1A6034EAC6169780C5' }
  @{ P = 'src/modules/lookups/lookups.controller.ts'; H = '2D26DF4D8DC8E73C793BB2F985D5BF7BBB185A1A61AF85B1CBC76A8D6232D868' }
  @{ P = 'src/modules/lookups/lookups.module.ts'; H = '59AC361FE125794F95FB8FD73B37D5E7CD8E9B722428A24138A7514F489C76C7' }
  @{ P = 'src/modules/lookups/lookups.service.spec.ts'; H = '9CEE5B4948418A75E5D3101D483F7B57E35EF0340E6DB1100D545612B7A221A2' }
  @{ P = 'src/modules/lookups/lookups.service.ts'; H = 'F87BF8BCF032F068C7A83366DF4184FF7B6B1FB02B7E62804FE391F38D2BD178' }
  @{ P = 'src/prisma/prisma.module.ts'; H = '0CDED004A66F8E902920BC1762ED229B6514E581D5C6AB601F42691A223EB167' }
  @{ P = 'src/prisma/prisma.service.ts'; H = '44DE7C7021CF7D02FBCAD2FEB45DC80C1FA70C8342BA329FA193D165C6D4CAE9' }
  @{ P = 'test/concurrency.int-spec.ts'; H = '01724B49D9E89F7B7BC6F53BE279F394742B6439A77BB9D1DD8BF191FF2556CD' }
  @{ P = 'test/contacts.int-spec.ts'; H = 'DC84814631DD2F305079104D262C14DBC20F6FC8EC9BA04FC36DA86634E4A06D' }
  @{ P = 'test/customers.int-spec.ts'; H = 'D373B4692232714D46F666619D53D22D74FF1B427B3C0BA40DC017860598B287' }
  @{ P = 'test/customers.list-pagination.int-spec.ts'; H = '287C294C8D34F54E61195F7D4C247BC690A3C4C86C7EA899DC131853A17D43E0' }
  @{ P = 'test/customers.search-equivalence.int-spec.ts'; H = '676394C14C7DE273E69DB4B03A977B90C136E785E490D7E5B086635BDC9DA6A8' }
  @{ P = 'test/db-errors.int-spec.ts'; H = '6BB80851AC5C2E9BC40234A24E2B108D4B68BEC8B2EF58DA4C7F8BC32DF3D5E0' }
  @{ P = 'test/health.e2e-spec.ts'; H = '2E496627C1AC8F733811037856E138CB29867CFE95EEDE5D4808CA739759BD93' }
  @{ P = 'test/helpers/fixtures.ts'; H = '8D596296E39C74BE940019172971CE5CA998946428E6DAB4F2F0E9BC8DEFABE4' }
  @{ P = 'test/helpers/test-app.ts'; H = '98E7DCAF428B5454E302B117D299C19E938CD1E8FF82AF9379BE2BD489F7D1E0' }
  @{ P = 'test/helpers/test-db.ts'; H = '1FF9477E4603E22E003E3183675B66BE71B57223D183EE723BD2B41557EEB30D' }
  @{ P = 'test/jest-customers-e2e.json'; H = 'A7B20A7645F131872D24AC101977602BC195802BB45736D0A71BE48A2FBF85AA' }
  @{ P = 'test/jest-e2e.json'; H = 'D3257B229F3D7248DD3880043FCB6CB4F7C2675EB31293D7BCEE1053085C6EED' }
  @{ P = 'test/jest-perf.json'; H = 'D9EFA55E7E88A9610DCE7849E2D2D43488BE21D8AE019C9F2348A89E358A1239' }
  @{ P = 'test/jest-unit.json'; H = 'F3F9977C92C9D26AC79A0A1B1619B18923D63CF0356E9160546E4ED818DF6246' }
  @{ P = 'test/lookups.int-spec.ts'; H = '0C93B8E59AC8705C44ECF9958995CFEE6D5B29853C93606F4C76300D86443AD6' }
  @{ P = 'test/perf/search.perf-spec.ts'; H = '25DA415DC724F4D1622D1D8978A82AF7376816A0DE844F27E3F3F47969D76033' }
  @{ P = 'test/search.int-spec.ts'; H = '73B9CF8B3FB540606123F9D2C62D72B93F9D3E7D9D9A37045033A828E4404499' }
)
Say ('Thu muc backend: ' + $root)
$same = 0; $diff = @(); $miss = @()
foreach ($e in $expected) {
  $p = Join-Path $root ($e.P -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p)) { $miss += $e.P; Say ('[THIEU]  ' + $e.P) 'Red'; continue }
  if ((NormHash $p) -eq $e.H) { $same++; Say ('[KHOP]   ' + $e.P) 'Green' } else { $diff += $e.P; Say ('[KHAC]   ' + $e.P + '  sha256=' + (NormHash $p)) 'Red' }
}
Say ''
$known = $expected | ForEach-Object { $_.P }
foreach ($d in 'src', 'test') {
  $dir = Join-Path $root $d
  if (Test-Path -LiteralPath $dir) {
    $extra = Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.FullName -notmatch '\\generated(\\|$)' -and $_.Extension -in '.ts', '.json' } | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
    $unk = $extra | Where-Object { $known -notcontains $_ }
    if ($unk) { Say ('File ngoai danh sach trong ' + $d + ' (khong sao neu la bench/test dien tu goi P1/P2):') 'Yellow'; $unk | ForEach-Object { Say ('  ' + $_) 'Yellow' } }
  }
}
$mig = Join-Path $root 'prisma\migrations'
if (Test-Path -LiteralPath $mig) { Say ('prisma\migrations: ' + ((Get-ChildItem -LiteralPath $mig | ForEach-Object { $_.Name } | Sort-Object) -join ', ')) }
try { $pj = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json; foreach ($k in '@nestjs/core', '@nestjs/jwt', '@nestjs/throttler', 'argon2', '@prisma/client', 'prisma', 'typescript', 'jest') { $v = $null; if ($pj.dependencies.PSObject.Properties[$k]) { $v = $pj.dependencies.$k } elseif ($pj.devDependencies.PSObject.Properties[$k]) { $v = $pj.devDependencies.$k }; Say ('  ' + $k + ' = ' + $(if ($v) { $v } else { '(khong co)' })) } } catch { Say 'Khong doc duoc package.json.' 'Red' }
try { Say ('node ' + (& node -v)) } catch { Say 'Khong chay duoc node -v.' 'Yellow' }
Say ''
Say ('Tong ket: KHOP ' + $same + ' / ' + $expected.Count + ' ; KHAC ' + $diff.Count + ' ; THIEU ' + $miss.Count)
if ($diff.Count -eq 0 -and $miss.Count -eq 0) { Say 'KET QUA: ma nguon that KHOP trang thai da giao.' 'Green' } else { Say 'KET QUA: CO KHAC BIET. Gui log va noi dung cac file [KHAC]/[THIEU] truoc khi khoa thiet ke.' 'Red' }
Write-Host ('Log: ' + $log)
