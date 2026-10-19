$ErrorActionPreference = "SilentlyContinue"
Stop-ScheduledTask -TaskName "SISCOM-Claude-AutoRunner"
Unregister-ScheduledTask -TaskName "SISCOM-Claude-AutoRunner" -Confirm:$false
Write-Host "Da go Scheduled Task SISCOM-Claude-AutoRunner. Du lieu local trong %LOCALAPPDATA%\SISCOM-ClaudeRunner duoc giu lai de audit." -ForegroundColor Yellow
