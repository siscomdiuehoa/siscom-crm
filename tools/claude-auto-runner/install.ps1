$ErrorActionPreference = "Stop"
$Repo = "D:\SISCOM-CRM"
$Tool = Join-Path $Repo "tools\claude-auto-runner\runner.mjs"
$Local = Join-Path $env:LOCALAPPDATA "SISCOM-ClaudeRunner"
$Config = Join-Path $Local "config.json"
$TaskName = "SISCOM-Claude-AutoRunner"
Write-Host "SISCOM Claude Auto-Runner installer" -ForegroundColor Cyan
foreach($cmd in @("node","git","gh","claude")){
  $x=Get-Command $cmd -ErrorAction SilentlyContinue
  if(-not $x){throw "Khong tim thay lenh $cmd trong PATH."}
  Write-Host ("[OK] {0} -> {1}" -f $cmd,$x.Source) -ForegroundColor Green
}
& gh auth status
if($LASTEXITCODE -ne 0){throw "gh chua dang nhap."}
New-Item -ItemType Directory -Force -Path $Local | Out-Null
if(-not (Test-Path $Config)){
  $cfg=@{
    repo="siscomdiuehoa/siscom-crm";repoPath=$Repo;queueIssue=8;trustedLogin="siscomdiuehoa";pollSeconds=10;githubPollSeconds=15;port=45871;
    claudeCommand=(Get-Command claude).Source;ghCommand=(Get-Command gh).Source;gitCommand=(Get-Command git).Source;
    claudeArgs=@("-p","{prompt}");maxTaskMinutes=30
  } | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath $Config -Value $cfg -Encoding UTF8
  Write-Host ("[OK] Tao "+$Config) -ForegroundColor Green
} else { Write-Host ("[KEEP] "+$Config) -ForegroundColor Yellow }
$node=(Get-Command node).Source
$action=New-ScheduledTaskAction -Execute $node -Argument ('"'+$Tool+'"') -WorkingDirectory $Repo
$trigger=New-ScheduledTaskTrigger -AtLogOn
$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
Write-Host ("[OK] Scheduled Task: "+$TaskName) -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:45871" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:45871"
