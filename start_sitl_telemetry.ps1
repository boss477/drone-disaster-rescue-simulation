param(
    [string]$Endpoint = '',
    [string]$ServerUrl = ''
)

$ErrorActionPreference = 'Stop'
$arguments = @("$PSScriptRoot\sitl_telemetry_adapter.py")
if ($Endpoint) { $arguments += @('--endpoint', $Endpoint) }
if ($ServerUrl) { $arguments += @('--server-url', $ServerUrl) }

Write-Host 'SIMULATION ONLY: starting receive-only SITL telemetry adapter.' -ForegroundColor Yellow
& py @arguments
exit $LASTEXITCODE
