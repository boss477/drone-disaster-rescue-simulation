<#
.SYNOPSIS
  Starts PX4 or ArduPilot SITL (software-in-the-loop) if you have it installed. SIMULATION ONLY.
.DESCRIPTION
  This script does not install anything. SITL normally runs in a supported Ubuntu WSL2 distribution on Windows.
  Set SITL_WSL_DISTRO to override automatic distribution selection.
  Set one of these environment variables to the SITL checkout path *inside WSL* (the default PX4 path is ~/PX4-Autopilot):
    PX4_AUTOPILOT_DIR   e.g. ~/PX4-Autopilot
    ARDUPILOT_DIR       e.g. ~/ardupilot
  SITL then sends its own MAVLink to QGroundControl (UDP 14550). It simulates the vehicle; no hardware is used.
#>
param(
    [ValidateSet('px4', 'ardupilot')][string]$Flavor = 'px4',
    [string]$Distro = $env:SITL_WSL_DISTRO,
    [switch]$NoWindowsUdpForward
)
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

if (-not $Distro) {
    $installedDistros = @(wsl --list --quiet 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $Distro = @('Ubuntu-24.04-PX4', 'Ubuntu-24.04', 'Ubuntu-22.04', 'Ubuntu') |
        Where-Object { $_ -in $installedDistros } |
        Select-Object -First 1
}
if (-not $Distro) {
    Write-Host 'No supported Ubuntu WSL distribution was found.' -ForegroundColor Yellow
    Show-Help
    exit 1
}

$osRelease = wsl -d $Distro -- cat /etc/os-release 2>$null
$versionLine = $osRelease | Where-Object { $_ -match '^VERSION_ID=' } | Select-Object -First 1
$ubuntuVersion = (($versionLine -replace '^VERSION_ID="?', '') -replace '"$', '').Trim()
if ($ubuntuVersion -and $ubuntuVersion -notin @('22.04', '24.04')) {
    Write-Host "$Distro uses Ubuntu $ubuntuVersion, which is not currently listed as a supported PX4 development host (22.04 and 24.04 are supported)." -ForegroundColor Yellow
    Write-Host 'Use a supported Ubuntu WSL distribution before installing PX4 SITL.' -ForegroundColor Yellow
    exit 1
}

$windowsHostIp = (wsl -d $Distro -- bash -lc "ip route show default | cut -d' ' -f3 | head -n1" 2>$null).Trim()
if (-not $NoWindowsUdpForward -and $windowsHostIp -notmatch '^(?:\d{1,3}\.){3}\d{1,3}$') {
    throw 'Could not determine the Windows host IP from WSL. Use -NoWindowsUdpForward to start SITL without Windows UDP links.'
}

if ($Flavor -eq 'px4') {
    $dir = if ($env:PX4_AUTOPILOT_DIR) { $env:PX4_AUTOPILOT_DIR } else { '~/PX4-Autopilot' }
    if ($dir -notmatch '^~?/[A-Za-z0-9._/-]+$') { throw 'PX4_AUTOPILOT_DIR must be a simple WSL path without spaces.' }
    wsl -d $Distro -e bash -lc "test -d $dir"
    if ($LASTEXITCODE -ne 0) { Show-Help; exit 1 }
    Write-Host "Starting PX4 SITL from $dir in $Distro. Stop with Ctrl+C."
    if ($NoWindowsUdpForward) {
        wsl -d $Distro -e bash -lc "cd $dir && make px4_sitl gz_x500"
    }
    else {
        Write-Host "Routing PX4 telemetry to the Windows dashboard (UDP 14540) and QGroundControl (UDP 14550) via $windowsHostIp."
        $dashboardLink = "mavlink start -x -u 14600 -r 1000000 -m onboard -t $windowsHostIp -o 14540"
        $qgcLink = "mavlink start -x -u 14601 -r 4000000 -t $windowsHostIp -o 14550"
        $launch = "cd $dir; (sleep 8; printf '%s\n' '$dashboardLink' '$qgcLink' | timeout 25 python3 Tools/mavlink_shell.py 0.0.0.0:14540 >/tmp/drone-rescue-px4-links.log 2>&1 || true) & exec make px4_sitl gz_x500"
        wsl -d $Distro -e bash -lc $launch
    }
}
else {
    $dir = $env:ARDUPILOT_DIR
    if (-not $dir) { Show-Help; exit 1 }
    if ($dir -notmatch '^~?/[A-Za-z0-9._/-]+$') { throw 'ARDUPILOT_DIR must be a simple WSL path without spaces.' }
    $destination = if ($NoWindowsUdpForward) { '127.0.0.1' } else { $windowsHostIp }
    Write-Host "Starting ArduCopter SITL from $dir in $Distro, output to $destination on UDP 14550 and 14541. Stop with Ctrl+C."
    wsl -d $Distro -e bash -lc "cd $dir && python3 Tools/autotest/sim_vehicle.py -v ArduCopter --out udp:${destination}:14550 --out udp:${destination}:14541"
}
