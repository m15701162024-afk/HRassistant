$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$startScript = Join-Path $PSScriptRoot "start-local.ps1"
$tunnelScript = Join-Path $PSScriptRoot "start-tunnel.ps1"
$deployScript = Join-Path $PSScriptRoot "deploy-update.ps1"

$startAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$startTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "HRassistant-Start" -Action $startAction -Trigger $startTrigger -RunLevel Limited -Force | Out-Null

$tunnelAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$tunnelScript`""
$tunnelTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "HRassistant-Tunnel" -Action $tunnelAction -Trigger $tunnelTrigger -RunLevel Limited -Force | Out-Null

$deployAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$deployScript`""
$deployTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "HRassistant-AutoDeploy" -Action $deployAction -Trigger $deployTrigger -RunLevel Limited -Force | Out-Null

Write-Host "Scheduled tasks installed:"
Write-Host "- HRassistant-Start: starts local service at logon"
Write-Host "- HRassistant-Tunnel: starts public tunnel at logon"
Write-Host "- HRassistant-AutoDeploy: pulls GitHub updates every 10 minutes and restarts when changed"
