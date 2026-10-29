# Bộ TỰ KIỂM của công cụ mvp-kiem-tra-xoa-mem.ps1 trên API GIẢ (fake-api.cjs, 127.0.0.1:3999). Không DB, không tài khoản thật.
# Tái hiện 3 mục FAIL giả ngày 2026-10-29 (tài khoản admin trên backend thật):
#   (1) DELETE 409 nhưng mã lỗi trống  (2) restore 409 nhưng mã lỗi trống  (3) "DELETE không CSRF" trả 409 thay vì 403.
# Nguyên nhân ở công cụ (Windows PowerShell 5.1): body lỗi đã bị Invoke-WebRequest đọc hết (nằm ở $_.ErrorDetails.Message),
# và -Headers bị lưu vào WebSession nên lần gọi "không CSRF" vẫn gửi X-CSRF-Token cũ. Bộ này kiểm cả hai bằng nhật ký của API giả.
# Dùng: powershell -NoProfile -ExecutionPolicy Bypass -File run-selftest.ps1 [-Tool <duong dan .ps1>]   (mặc định: công cụ cùng thư mục cha)
param(
  [string]$Tool = (Join-Path (Split-Path -Parent $PSScriptRoot) 'mvp-kiem-tra-xoa-mem.ps1'),
  [int]$Port = 3999
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$fails = 0
function Check([bool]$ok, [string]$m) { if ($ok) { Write-Host ('[PASS] ' + $m) -ForegroundColor Green } else { Write-Host ('[FAIL] ' + $m) -ForegroundColor Red; $script:fails++ } }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Can node.exe trong PATH.' }
if (-not (Test-Path -LiteralPath $Tool)) { throw ('Khong thay cong cu: ' + $Tool) }
$outDir = Join-Path $env:TEMP ('mvp-buoc3-selftest-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $outDir | Out-Null
$srv = Start-Process -FilePath $node.Source -ArgumentList @((Join-Path $PSScriptRoot 'fake-api.cjs'), [string]$Port) -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 50 -and -not $ready; $i++) { try { Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/__selftest/requests') -UseBasicParsing | Out-Null; $ready = $true } catch { Start-Sleep -Milliseconds 100 } }
  if (-not $ready) { throw 'API gia khong len.' }
  Write-Host ('Cong cu: ' + $Tool)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Tool -Api ('http://127.0.0.1:' + $Port + '/api/v1') -Origin 'http://127.0.0.1:4175' -OutDir $outDir -SelfTest 2>&1 | ForEach-Object { $_.ToString() }
  $code = $LASTEXITCODE
  $text = $out -join "`n"
  Write-Host '--- dau ra cong cu ---'; Write-Host $text; Write-Host '--- het ---'
  $reqs = (ConvertFrom-Json (Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/__selftest/requests') -UseBasicParsing).Content).data
  $deletes = @($reqs | Where-Object { $_.method -eq 'DELETE' })
  $noCsrfDeletes = @($deletes | Where-Object { -not $_.hasCsrf })
  Check ($code -eq 0) ('Ma thoat cong cu = 0 (thuc te ' + $code + ')')
  Check ($text -match 'DELETE => 409 DELETE_LINKS_UNVERIFIED') '(1) DELETE: doc duoc ma loi DELETE_LINKS_UNVERIFIED tu body 409'
  Check ($text -match 'restore .*=> 409 CUSTOMER_NOT_DELETED') '(2) restore: doc duoc ma loi CUSTOMER_NOT_DELETED tu body 409'
  Check ($text -match 'DELETE khong co X-CSRF-Token => 403 CSRF_FAILED') '(3) DELETE khong CSRF: 403 CSRF_FAILED'
  Check ($deletes.Count -eq 2) ('API gia nhan dung 2 DELETE (thuc te ' + $deletes.Count + ')')
  Check ($noCsrfDeletes.Count -eq 1) ('Dung 1 DELETE toi API gia KHONG mang X-CSRF-Token (thuc te ' + $noCsrfDeletes.Count + ') - header khong bi WebSession giu lai')
  Check ($text -match 'KET QUA BUOC 3 \(NV-0002\): PASS') 'Dong ket qua: PASS'
  $ev = Get-ChildItem -LiteralPath $outDir -Filter 'mvp-buoc3-xoa-mem-*.txt' -ErrorAction SilentlyContinue
  Check ($ev.Count -eq 1) 'Ghi dung 1 file bang chung'
  if ($ev.Count -eq 1) { $evText = Get-Content -LiteralPath $ev[0].FullName -Raw; Check (-not ($evText -match 'selftest-gia-khong-dung-that|siscom_sid=|csrfToken')) 'File bang chung khong chua mat khau/cookie/token' }
} finally {
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force }
  Remove-Item -LiteralPath $outDir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
if ($fails -eq 0) { Write-Host 'TU KIEM CONG CU: PASS' -ForegroundColor Green; exit 0 } else { Write-Host ('TU KIEM CONG CU: FAIL ' + $fails + ' muc') -ForegroundColor Red; exit 1 }
