$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateFile = Join-Path $project '.litechat-runner.json'

if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host 'Lite Chat is not running from start.bat.'
    exit 0
}

try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    foreach ($entry in @(@{ id = $state.appPid; marker = "LiteChatRunner-App-$($state.runId)" },
                       @{ id = $state.bridgePid; marker = "LiteChatRunner-Bridge-$($state.runId)" })) {
        if (-not $entry.id) { continue }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.id)" -ErrorAction SilentlyContinue
        if ($null -ne $process -and $process.CommandLine -like "*$($entry.marker)*") {
            & taskkill.exe /PID $entry.id /T /F | Out-Null
        }
    }
    Remove-Item -LiteralPath $stateFile
    Write-Host 'Lite Chat project windows stopped.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
