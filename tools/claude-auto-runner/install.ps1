$ErrorActionPreference = "Stop"
$Repo = "D:\SISCOM-CRM"
$Tool = Join-Path $Repo "tools\claude-auto-runner\runner.mjs"
$Local = Join-Path $env:LOCALAPPDATA "SISCOM-ClaudeRunner"
$Config = Join-Path $Local "config.json"
$TaskName = "SISCOM-Claude-AutoRunner"
$StartupDir = [Environment]::GetFolderPath("Startup")
$StartupCmd = Join-Path $StartupDir "SISCOM-Claude-AutoRunner.cmd"
Write-Host "SISCOM Claude Auto-Runner installer" -ForegroundColor Cyan

function Find-ClaudeExe {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    (Join-Path $env:LOCALAPPDATA "Packages"),
    (Join-Path $env:LOCALAPPDATA "Programs")
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem -Path $root -Filter claude.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\Claude\\claude-code\\" -or $_.FullName -match "\\Claude_" } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
$claudeExe = Find-ClaudeExe
if (-not $nodeCmd) { throw "Khong tim thay node." }
if (-not $gitCmd) { throw "Khong tim thay git." }
if (-not $ghCmd) { throw "Khong tim thay gh." }
if (-not $claudeExe) { throw "Khong tim thay Claude Code CLI tren may." }
Write-Host ("[OK] node -> "+$nodeCmd.Source) -ForegroundColor Green
Write-Host ("[OK] git -> "+$gitCmd.Source) -ForegroundColor Green
Write-Host ("[OK] gh -> "+$ghCmd.Source) -ForegroundColor Green
Write-Host ("[OK] claude -> "+$claudeExe) -ForegroundColor Green

& $ghCmd.Source auth status
if ($LASTEXITCODE -ne 0) { throw "gh chua dang nhap." }

$smoke = & $claudeExe -p "Chi tra loi dung mot tu: OK" --permission-mode auto 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $smoke -match "Not logged in|Please run /login") {
  Write-Host ""
  Write-Host "Claude Code CLI chua dang nhap." -ForegroundColor Yellow
  Write-Host "Trong cua so Claude Code, go /login va hoan tat dang nhap, sau do chay lai installer." -ForegroundColor Yellow
  & $claudeExe
  exit 3
}
Write-Host ("[OK] Claude headless auth: "+$smoke.Trim()) -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $Local | Out-Null
$cfg=@{
  repo="siscomdiuehoa/siscom-crm";repoPath=$Repo;queueIssue=8;trustedLogin="siscomdiuehoa";pollSeconds=10;githubPollSeconds=15;port=45871;
  claudeCommand=$claudeExe;ghCommand=$ghCmd.Source;gitCommand=$gitCmd.Source;
  claudeArgs=@("-p","{prompt}","--permission-mode","auto");maxTaskMinutes=30
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($Config, $cfg, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("[OK] Config -> "+$Config) -ForegroundColor Green

$startupLine = '@echo off' + [Environment]::NewLine +
  'cd /d "' + $Repo + '"' + [Environment]::NewLine +
  'start "" /min "' + $nodeCmd.Source + '" "' + $Tool + '"' + [Environment]::NewLine
Set-Content -LiteralPath $StartupCmd -Value $startupLine -Encoding ASCII
Write-Host ("[OK] Startup fallback -> "+$StartupCmd) -ForegroundColor Green

$registered = $false
try {
  $action=New-ScheduledTaskAction -Execute $nodeCmd.Source -Argument ('"'+$Tool+'"') -WorkingDirectory $Repo
  $trigger=New-ScheduledTaskTrigger -AtLogOn
  $principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  $registered = $true
  Write-Host ("[OK] Scheduled Task: "+$TaskName) -ForegroundColor Green
} catch {
  Write-Host "[WARN] Khong dang ky duoc Scheduled Task. Dung Startup folder thay the, khong can Administrator." -ForegroundColor Yellow
}

$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*claude-auto-runner\runner.mjs*" }
if (-not $existing) {
  $OutLog = Join-Path $Local "runner.out.log"
  $ErrLog = Join-Path $Local "runner.err.log"
  Start-Process -FilePath $nodeCmd.Source -ArgumentList @($Tool) -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
}
$healthy = $false
for($i=0; $i -lt 10; $i++){
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:45871/api/status" -TimeoutSec 2
    if($r.StatusCode -eq 200){$healthy=$true;break}
  } catch {}
}
if(-not $healthy){
  Write-Host "[ERROR] Auto-Runner chua mo duoc cong 45871." -ForegroundColor Red
  $ErrLog = Join-Path $Local "runner.err.log"
  if(Test-Path $ErrLog){ Get-Content -LiteralPath $ErrLog -Tail 20 }
  throw "Auto-Runner health check failed."
}
Write-Host "[OK] Auto-Runner dang chay va health check PASS." -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:45871" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:45871"
