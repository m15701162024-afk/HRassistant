$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$startup = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startup "HRassistant-start.cmd"
$startLocal = Join-Path $PSScriptRoot "start-local.ps1"
$startTunnel = Join-Path $PSScriptRoot "start-tunnel.ps1"
$startLoop = Join-Path $PSScriptRoot "start-auto-deploy-loop.ps1"

$content = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$startLocal"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$startTunnel"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$startLoop"
"@

Set-Content -Path $startupFile -Value $content -Encoding ASCII
Write-Host "Startup shortcut installed: $startupFile"
