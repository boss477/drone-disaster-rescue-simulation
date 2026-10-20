<#
.SYNOPSIS
  Starts PX4 or ArduPilot SITL (software-in-the-loop) if you have it installed. SIMULATION ONLY.
.DESCRIPTION
  This script does not install anything. SITL normally runs in WSL2 (Ubuntu) on Windows.
  Set one of these environment variables to the SITL checkout path *inside WSL*:
    PX4_AUTOPILOT_DIR   e.g. ~/PX4-Autopilot
    ARDUPILOT_DIR       e.g. ~/ardupilot
  SITL then sends its own MAVLink to QGroundControl (UDP 14550). It simulates the vehicle; no hardware is used.
#>
param([ValidateSet('px4', 'ardupilot')][string]$Flavor = 'px4')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner

function Show-Help {
    Write-Host 'PX4/ArduPilot SITL was not found, so nothing was started (this is optional).' -ForegroundColor Yellow
    Write-Host 'To use SITL:'
    Write-Host '  1. Install WSL2 + Ubuntu:  wsl --install'
    Write-Host '  2. PX4:        https://docs.px4.io/main/en/dev_setup/dev_env_linux_ubuntu.html'
    Write-Host '     ArduPilot:  https://ardupilot.org/dev/docs/building-setup-linux.html'
    Write-Host '  3. Set PX4_AUTOPILOT_DIR (or ARDUPILOT_DIR) to the checkout path inside WSL, then re-run this script.'
    Write-Host 'The 3D simulation and the telemetry bridge work without SITL.'
}

if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { Show-Help; exit 1 }

if ($Flavor -eq 'px4') {
    $dir = $env:PX4_AUTOPILOT_DIR
    if (-not $dir) { Show-Help; exit 1 }
    Write-Host "Starting PX4 SITL from $dir (WSL). Stop with Ctrl+C."
    wsl -e bash -lc "cd $dir && make px4_sitl_default none_iris"
}
else {
    $dir = $env:ARDUPILOT_DIR
    if (-not $dir) { Show-Help; exit 1 }
    Write-Host "Starting ArduCopter SITL from $dir (WSL), output to QGroundControl on UDP 14550. Stop with Ctrl+C."
    wsl -e bash -lc "cd $dir && python3 Tools/autotest/sim_vehicle.py -v ArduCopter --out udp:127.0.0.1:14550"
}
