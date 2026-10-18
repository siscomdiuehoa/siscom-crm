@echo off
rem SISCOM CRM backend - kiem tra moi truong Windows. Khong in mat khau/bi mat.
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
set OUT=check-env-result.txt
echo SISCOM CRM - ket qua kiem tra moi truong > %OUT%
echo Thoi gian: %DATE% %TIME% >> %OUT%
echo Thu muc backend: %CD% >> %OUT%
echo %CD% | findstr /i "dropbox onedrive" >nul && echo [CANH BAO] Thu muc nam trong Dropbox/OneDrive. Hay chuyen ra ngoai (vi du C:\dev\siscom-crm\backend). >> %OUT%
echo. >> %OUT%
echo --- Node.js (can 24.x, tu 24.11 tro len) >> %OUT%
where node >nul 2>nul && (node -v >> %OUT%) || echo [THIEU] Chua cai Node.js >> %OUT%
echo --- npm (can 11.6 tro len) >> %OUT%
where npm >nul 2>nul && (call npm -v >> %OUT%) || echo [THIEU] Chua co npm >> %OUT%
echo --- PostgreSQL client (psql) >> %OUT%
where psql >nul 2>nul && (psql --version >> %OUT%) || (dir /b "C:\Program Files\PostgreSQL" >> %OUT% 2>nul || echo [THIEU] Khong thay psql trong PATH hoac C:\Program Files\PostgreSQL >> %OUT%)
echo --- Dich vu PostgreSQL >> %OUT%
sc query type= service state= all | findstr /i /c:"SERVICE_NAME: postgresql" >> %OUT% 2>nul
powershell -NoProfile -Command "Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Format-Table Name,Status -AutoSize | Out-String" >> %OUT% 2>nul
echo --- Cong dang su dung (3000 = backend, 5432 = PostgreSQL, 5173 = frontend) >> %OUT%
netstat -ano | findstr /r /c:":3000 " /c:":5432 " /c:":5173 " | findstr LISTENING >> %OUT%
echo --- Git (tuy chon) >> %OUT%
where git >nul 2>nul && (git --version >> %OUT%) || echo (khong co Git - khong bat buoc) >> %OUT%
echo --- File cau hinh >> %OUT%
if exist .env (echo .env: DA CO) else (echo .env: CHUA CO - hay chay scripts\windows\setup-db.bat) >> %OUT%
if exist node_modules (echo node_modules: DA CO) else (echo node_modules: CHUA CO - chay npm install) >> %OUT%
echo. >> %OUT%
echo Ket qua da luu o %CD%\%OUT% (khong chua mat khau). Co the gui file nay de duoc ho tro.
type %OUT%
pause
