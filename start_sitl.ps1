<#
.SYNOPSIS
  Starts PX4 or ArduPilot SITL (software-in-the-loop) if you have it installed. SIMULATION ONLY.
.DESCRIPTION
  This script does not install anything. SITL normally runs in WSL2 (Ubuntu) on Windows.
  Set one of these environment variables to the SITL checkout path *inside WSL* (the default PX4 path is ~/PX4-Autopilot):
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
    Write-Host '  3. Set PX4_AUTOPILOT_DIR (or ARDUPILOT_DIR) if the checkout is not in the default home-directory path.'
    Write-Host 'The 3D simulation and the telemetry bridge work without SITL.'
}

if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { Show-Help; exit 1 }

$osRelease = wsl -d Ubuntu -- cat /etc/os-release 2>$null
$versionLine = $osRelease | Where-Object { $_ -match '^VERSION_ID=' } | Select-Object -First 1
$ubuntuVersion = (($versionLine -replace '^VERSION_ID="?', '') -replace '"$', '').Trim()
if ($ubuntuVersion -and $ubuntuVersion -notin @('22.04', '24.04')) {
    Write-Host "Ubuntu $ubuntuVersion is not currently listed as a supported PX4 development host (22.04 and 24.04 are supported)." -ForegroundColor Yellow
    Write-Host 'Use a supported Ubuntu WSL distribution before installing PX4 SITL.' -ForegroundColor Yellow
    exit 1
}

if ($Flavor -eq 'px4') {
    $dir = if ($env:PX4_AUTOPILOT_DIR) { $env:PX4_AUTOPILOT_DIR } else { '~/PX4-Autopilot' }
    if ($dir -notmatch '^~?/[A-Za-z0-9._/-]+$') { throw 'PX4_AUTOPILOT_DIR must be a simple WSL path without spaces.' }
    wsl -e bash -lc "test -d $dir"
    if ($LASTEXITCODE -ne 0) { Show-Help; exit 1 }
    Write-Host "Starting PX4 SITL from $dir (WSL). Stop with Ctrl+C."
    wsl -e bash -lc "cd $dir && make px4_sitl gz_x500"
}
else {
    $dir = $env:ARDUPILOT_DIR
    if (-not $dir) { Show-Help; exit 1 }
    if ($dir -notmatch '^~?/[A-Za-z0-9._/-]+$') { throw 'ARDUPILOT_DIR must be a simple WSL path without spaces.' }
    Write-Host "Starting ArduCopter SITL from $dir (WSL), output to QGroundControl on UDP 14550 and dashboard adapter on 14541. Stop with Ctrl+C."
    wsl -e bash -lc "cd $dir && python3 Tools/autotest/sim_vehicle.py -v ArduCopter --out udp:127.0.0.1:14550 --out udp:127.0.0.1:14541"
}
