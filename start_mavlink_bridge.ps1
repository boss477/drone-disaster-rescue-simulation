<#
.SYNOPSIS
  Starts the MAVLink telemetry bridge for QGroundControl. SIMULATION ONLY.
.PARAMETER DryRun
  Print telemetry to the console; open no network connection (no pymavlink needed).
.PARAMETER Standalone
  Ignore the browser and run the built-in mission model.
.PARAMETER EnableSitlCommands
  Allow arm/takeoff/land to a LOCAL SITL. Also requires mode=sitl and sitl.enabled=true in mavlink_config.json.
#>
param([switch]$DryRun, [switch]$Standalone, [switch]$EnableSitlCommands)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner
$arguments = @('mavlink_bridge.py')
if ($DryRun) { $arguments += '--dry-run' }
if ($Standalone) { $arguments += '--standalone' }
if ($EnableSitlCommands) { $arguments += '--enable-sitl-commands' }
Invoke-RepoPython @arguments
