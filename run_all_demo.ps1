<#
.SYNOPSIS
  Starts the 3D simulation and the MAVLink telemetry bridge together. SIMULATION ONLY.
.PARAMETER WithSitl
  Also try to start PX4/ArduPilot SITL (needs it installed; see start_sitl.ps1).
#>
param([switch]$WithSitl, [ValidateSet('px4', 'ardupilot')][string]$SitlFlavor = 'px4')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner

$shell = (Get-Process -Id $PID).Path
Start-Process $shell -ArgumentList '-NoExit', '-File', "$PSScriptRoot\start_visual_sim.ps1"
Start-Sleep -Seconds 2
Start-Process $shell -ArgumentList '-NoExit', '-File', "$PSScriptRoot\start_mavlink_bridge.ps1"
if ($WithSitl) {
    Start-Process $shell -ArgumentList '-NoExit', '-File', "$PSScriptRoot\start_sitl.ps1", '-Flavor', $SitlFlavor
}

Write-Host ''
Write-Host 'Started: 3D simulation window, MAVLink bridge window.' -ForegroundColor Green
Write-Host '1. In the browser page click "Start mission".'
Write-Host '2. Open QGroundControl: it listens on UDP 14550 and shows "Vehicle 42" automatically.'
Write-Host '   (No QGroundControl? Download it from https://qgroundcontrol.com - optional.)'
Write-Host 'Close the opened windows (or press Ctrl+C in each) to stop. See the README section "QGroundControl".'
