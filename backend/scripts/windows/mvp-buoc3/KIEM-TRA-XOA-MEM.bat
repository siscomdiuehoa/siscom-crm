@echo off
rem Nghiem thu MVP buoc 3 - kiem tra xoa mem / khoi phuc qua API that (hoi email + mat khau nhap an; khong ghi mat khau).
rem Nhap dup de chay. Tham so tuy chon: -Api ... -Origin ... -CustomerCode KH-00013 -OutDir <thu muc bang chung>
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mvp-kiem-tra-xoa-mem.ps1" %*
echo.
pause
