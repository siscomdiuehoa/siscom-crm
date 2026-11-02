PR #196 - xu ly gop y Codex (Important): Test-HttpsNoVerify phai kiem exit code cua curl truoc khi tin ma HTTP.
Tai hien: srv.mjs (127.0.0.1:18555) tra /ok 200 day du, /e500 500, /trunc header 200 roi cat ket noi, /hang header 200 roi treo.
run.ps1 trich nguyen van ham Test-Http + Test-HttpsNoVerify tu demo-lan.ps1 va goi 4 duong dan (Windows PowerShell 5.1, curl.exe cua Windows).
TRUOC (a866de5):  ok 200 | e500 500 | trunc 200 | hang 200 (5.0s)   <- loi: vong tu kiem nhan "200" khi luot truyen hong
SAU:              ok 200 | e500 500 | trunc 0   | hang 0   (3.0s)
Sua: kiem $LASTEXITCODE ngay sau curl (khac 0 => tra 0); --connect-timeout 2 -m 3 (vong cho 30 lan x toi da ~4 s).
Parse PowerShell 5.1: OK. Chua chay lai voi Caddy that.
