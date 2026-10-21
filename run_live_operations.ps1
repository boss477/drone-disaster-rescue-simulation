# Opens the live OpenStreetMap + hazard operations map. No real drone control is involved.
param([int]$Port = 8765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner
$arguments = @('sim_server.py', '--port', $Port, '--page', 'live_operations.html')
if ($NoBrowser) { $arguments += '--no-browser' }
Invoke-RepoPython @arguments
