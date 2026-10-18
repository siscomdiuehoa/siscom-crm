@echo off
rem SISCOM CRM - start the dev server on Windows (double-click this file).
chcp 65001 >nul
cd /d "%~dp0"
title SISCOM CRM

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js. Tai ban LTS 20 tai https://nodejs.org roi chay lai file nay.
  echo [ERROR] Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dang cai thu vien lan dau / Installing dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo [LOI] npm install that bai / npm install failed.
    pause
    exit /b 1
  )
)

echo Dang khoi dong SISCOM CRM tai http://localhost:5173 ...
call npm run dev
pause
