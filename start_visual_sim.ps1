# Starts the 3D visual simulation (local web server + browser). SIMULATION ONLY.
param([int]$Port = 8765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner
$arguments = @('sim_server.py', '--port', $Port)
if ($NoBrowser) { $arguments += '--no-browser' }
Invoke-RepoPython @arguments
