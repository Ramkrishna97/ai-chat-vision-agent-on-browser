$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateFile = Join-Path $project '.litechat-runner.json'
$originFile = Join-Path $project 'bridge-origin.txt'

function Test-Runner($processId, $marker) {
    if (-not $processId -or -not $marker) { return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    return $null -ne $process -and $process.CommandLine -like "*$marker*"
}

function Test-Port($port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { return $client.ConnectAsync('127.0.0.1', $port).Wait(300) }
    catch { return $false }
    finally { $client.Dispose() }
}

try {
    if (Test-Path -LiteralPath $stateFile) {
        $previous = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        if ((Test-Runner $previous.appPid "LiteChatRunner-App-$($previous.runId)") -or
            (Test-Runner $previous.bridgePid "LiteChatRunner-Bridge-$($previous.runId)")) {
            Write-Host 'Lite Chat is already running. Use stop.bat before starting it again.'
            exit 0
        }
        Remove-Item -LiteralPath $stateFile
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js (which includes npm), then run start.bat again.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))) {
        Write-Host 'Installing project dependencies for the first run...'
        Push-Location $project
        try { & npm.cmd install; if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' } }
        finally { Pop-Location }
    }
    if (Test-Port 5173) { throw 'Port 5173 is already in use. Close the other app before starting Lite Chat.' }
    if (Test-Port 3210) { throw 'Port 3210 is already in use. Close the other bridge before starting Lite Chat.' }

    $runId = [guid]::NewGuid().ToString('N')
    $randomBytes = New-Object byte[] 18
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    $pairCode = [System.BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $deployedOrigin = if (Test-Path -LiteralPath $originFile) { (Get-Content -LiteralPath $originFile -Raw).Trim() } else { '' }
    if ($deployedOrigin -and $deployedOrigin -notmatch '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$') {
        throw 'bridge-origin.txt must contain one HTTPS origin, for example https://your-site.netlify.app'
    }
    $app = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title LiteChatRunner-App-$runId && npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort" -WorkingDirectory $project -PassThru
    try {
        $previousToken = $env:BRIDGE_TOKEN
        $previousOrigin = $env:APP_ORIGIN
        $env:BRIDGE_TOKEN = $pairCode
        if ($deployedOrigin) { $env:APP_ORIGIN = $deployedOrigin }
        try { $bridge = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "title LiteChatRunner-Bridge-$runId && npm.cmd run bridge" -WorkingDirectory $project -PassThru }
        finally { $env:BRIDGE_TOKEN = $previousToken; $env:APP_ORIGIN = $previousOrigin }
    } catch {
        & taskkill.exe /PID $app.Id /T /F | Out-Null
        throw
    }
    @{ runId = $runId; appPid = $app.Id; bridgePid = $bridge.Id } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Host 'Lite Chat started. This browser session pairs with the local bridge automatically.'
    if ($deployedOrigin) { Write-Host "Deployed site allowed: $deployedOrigin" }
    Write-Host 'Use stop.bat to close both project windows.'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                try { Start-Process "http://127.0.0.1:5173/#pair=$pairCode" }
                catch { Write-Host 'Open http://127.0.0.1:5173/ in your browser.' }
                break
            }
        } catch { Start-Sleep -Milliseconds 500 }
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
