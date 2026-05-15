$ErrorActionPreference = "Continue"

$deployScript = Join-Path $PSScriptRoot "deploy-update.ps1"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$loopLog = Join-Path $logDir "auto-deploy-loop.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

while ($true) {
    $started = Get-Date -Format s
    Add-Content -Path $loopLog -Value "$started auto deploy check started" -Encoding UTF8
    try {
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File $deployScript
    }
    catch {
        Add-Content -Path $loopLog -Value "$(Get-Date -Format s) $($_.Exception.Message)" -Encoding UTF8
    }
    Start-Sleep -Seconds 600
}
