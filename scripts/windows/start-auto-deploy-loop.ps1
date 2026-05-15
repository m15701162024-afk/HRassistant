$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logDir "auto-deploy-loop.pid"
$outLog = Join-Path $logDir "auto-deploy-loop.out.log"
$errLog = Join-Path $logDir "auto-deploy-loop.err.log"
$loopScript = Join-Path $PSScriptRoot "auto-deploy-loop.ps1"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Write-Host "Auto deploy loop is already running with PID $existingPid"
        exit 0
    }
}

$process = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$loopScript`"" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
Write-Host "Auto deploy loop started with PID $($process.Id)"
