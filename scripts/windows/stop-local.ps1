$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logDir "hrassistant-server.pid"

if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($pidValue) {
        $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $pidValue -Force
            Write-Host "Stopped HRassistant server PID $pidValue"
        }
    }
    Remove-Item $pidFile -Force
}

Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*recruitment_bot\web_admin*server.py*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "Stopped lingering HRassistant server PID $($_.ProcessId)"
    }
