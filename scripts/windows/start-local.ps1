$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$webRoot = Get-ChildItem -Path $repoRoot -Directory -Recurse -Filter "web_admin" |
    Where-Object { $_.FullName -like "*recruitment_bot*web_admin" } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $webRoot) {
    throw "Could not find recruitment_bot\web_admin under $repoRoot"
}
$logDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logDir "hrassistant-server.pid"
$outLog = Join-Path $logDir "server.out.log"
$errLog = Join-Path $logDir "server.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Write-Host "HRassistant is already running with PID $existingPid"
        exit 0
    }
}

$env:RECRUITMENT_HOST = "0.0.0.0"
$env:RECRUITMENT_PORT = "8787"
$env:RECRUITMENT_DB = Join-Path $webRoot "data\recruitment_history.db"
$env:RECRUITMENT_IP_ALLOWLIST = "127.0.0.1/32,::1/128,10.100.60.0/23"
$env:RECRUITMENT_TRUST_PROXY_HEADERS = "1"
$env:RECRUITMENT_MAX_BODY_BYTES = "2097152"
$env:RECRUITMENT_RATE_LIMIT_PER_MINUTE = "120"
New-Item -ItemType Directory -Force -Path (Split-Path $env:RECRUITMENT_DB) | Out-Null

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pyCommand = Get-Command py -ErrorAction SilentlyContinue
$pythonExe = $null
$pythonArgs = "server.py"
if ($pythonCommand -and $pythonCommand.Source) {
    $pythonExe = $pythonCommand.Source
}
elseif ($pyCommand -and $pyCommand.Source) {
    $pythonExe = $pyCommand.Source
    $pythonArgs = "-3 server.py"
}
else {
    $pythonExe = "C:\Users\udeer\AppData\Local\Python\pythoncore-3.14-64\python.exe"
}

$process = Start-Process -FilePath $pythonExe `
    -ArgumentList $pythonArgs `
    -WorkingDirectory $webRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
Write-Host "HRassistant started on http://127.0.0.1:8787 with PID $($process.Id)"
