@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Mac dinh: D:\SISCOM-CRM\db-backups. Doi thu muc: backup-db.bat -BackupDir "E:\Sao-luu"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-db.ps1" %*
pause
