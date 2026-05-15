$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$deployLog = Join-Path $logDir "deploy-update.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-DeployLog($message) {
    $line = "$(Get-Date -Format s) $message"
    Add-Content -Path $deployLog -Value $line -Encoding UTF8
    Write-Host $line
}

$gitCandidates = @(
    (Get-Command git -ErrorAction SilentlyContinue).Source,
    "C:\Program Files\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if (-not $gitCandidates) {
    throw "git.exe was not found. Install it with: winget install --id Git.Git -e"
}

$git = $gitCandidates[0]
Write-DeployLog "Checking GitHub updates..."
Push-Location $repoRoot
try {
    & $git fetch origin main
    $local = (& $git rev-parse HEAD).Trim()
    $remote = (& $git rev-parse origin/main).Trim()

    if ($local -eq $remote) {
        Write-DeployLog "No update. Current commit $local"
        return
    }

    Write-DeployLog "Updating from $local to $remote"
    & $git pull --ff-only --autostash origin main
}
finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot "stop-local.ps1")
& (Join-Path $PSScriptRoot "start-local.ps1")
& (Join-Path $PSScriptRoot "start-tunnel.ps1")
Write-DeployLog "Deployment refreshed."
