$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$pidFile = Join-Path $repoRoot "logs\auto-deploy-loop.pid"

if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $pidValue -Force
        Write-Host "Stopped auto deploy loop PID $pidValue"
    }
    Remove-Item $pidFile -Force
}
