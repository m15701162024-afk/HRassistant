$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logDir "cloudflared.pid"

if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($pidValue) {
        $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $pidValue -Force
            Write-Host "Stopped cloudflared PID $pidValue"
        }
    }
    Remove-Item $pidFile -Force
}
