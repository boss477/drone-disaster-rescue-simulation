# Opens the operator-controlled Cesium rescue mission. Basic map mode needs no API key.
param([int]$Port = 8765, [switch]$NoBrowser, [string]$OdmRoot = $env:DRONE_ODM_ROOT)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner
$arguments = @('sim_server.py', '--port', $Port, '--page', 'earth_rescue.html')
if ($NoBrowser) { $arguments += '--no-browser' }
if (-not $OdmRoot -and (Test-Path -LiteralPath 'D:\DroneRescueData\odm')) { $OdmRoot = 'D:\DroneRescueData\odm' }
if ($OdmRoot) { $arguments += @('--odm-root', $OdmRoot) }
Invoke-RepoPython @arguments
