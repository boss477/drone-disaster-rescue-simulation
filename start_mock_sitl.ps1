$ErrorActionPreference = 'Stop'
Write-Host 'MOCK SITL TELEMETRY ONLY - no flight controller or real hardware.' -ForegroundColor Yellow
& py "$PSScriptRoot\mock_sitl_vehicle.py"
exit $LASTEXITCODE
