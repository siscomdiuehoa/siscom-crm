param([string]$Script)
$src = Get-Content -Raw -LiteralPath $Script
$m = [regex]::Match($src, '(?s)function Test-Http\(.*?\n\}\r?\nfunction Test-HttpsNoVerify\(.*?\n\}')
if (-not $m.Success) { throw 'khong tim thay ham' }
Invoke-Expression $m.Value
foreach ($p in 'ok','e500','trunc','hang') { $t = [Diagnostics.Stopwatch]::StartNew(); $c = Test-HttpsNoVerify ('http://127.0.0.1:18555/' + $p); '{0,-6} -> {1}  ({2:n1}s)' -f $p, $c, $t.Elapsed.TotalSeconds }
