@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title SISCOM CRM Backend
where node >nul 2>nul || (echo [LOI] Chua cai Node.js 24 LTS. & pause & exit /b 1)
if not exist .env (echo [LOI] Chua co file .env. Hay chay scripts\windows\setup-db.bat truoc. & pause & exit /b 1)
if not exist node_modules (
  echo Dang cai thu vien lan dau...
  if exist package-lock.json (call npm ci) else (call npm install)
  if errorlevel 1 (echo [LOI] Cai thu vien that bai. & pause & exit /b 1)
)
echo Khoi dong backend tai http://127.0.0.1:3000/api/v1/health  (Ctrl+C de dung)
call npm run start:dev
pause
