$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logDir "cloudflared.pid"
$outLog = Join-Path $logDir "cloudflared.out.log"
$errLog = Join-Path $logDir "cloudflared.err.log"
$urlFile = Join-Path $logDir "public-url.txt"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Write-Host "cloudflared is already running with PID $existingPid"
        if (Test-Path $urlFile) {
            Get-Content $urlFile
        }
        exit 0
    }
}

$command = Get-Command cloudflared -ErrorAction SilentlyContinue
$candidatePaths = @()
if ($command -and $command.Source) {
    $candidatePaths += [string]$command.Source
}
$candidatePaths += Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
$candidates = $candidatePaths |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    ForEach-Object { (Resolve-Path -LiteralPath $_).Path }

if (-not $candidates) {
    throw "cloudflared.exe was not found. Install it with: winget install --id Cloudflare.cloudflared -e"
}

Remove-Item $urlFile -Force -ErrorAction SilentlyContinue

$cloudflared = [string]($candidates | Select-Object -First 1)
$process = Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel --protocol http2 --url http://127.0.0.1:8787" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
Write-Host "cloudflared tunnel started with PID $($process.Id). Waiting for public URL..."

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $combined = @()
    if (Test-Path $outLog) { $combined += Get-Content $outLog -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { $combined += Get-Content $errLog -ErrorAction SilentlyContinue }
    $match = $combined | Select-String -Pattern "https://[-a-zA-Z0-9.]+\.trycloudflare\.com" | Select-Object -First 1
    if ($match) {
        $url = $match.Matches[0].Value
        Set-Content -Path $urlFile -Value $url -Encoding ASCII
        Write-Host "Public URL: $url"
        exit 0
    }
}

Write-Host "Tunnel is running, but the public URL was not found yet. Check $errLog"
