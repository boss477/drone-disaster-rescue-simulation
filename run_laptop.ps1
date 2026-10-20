param(
    [int]$CameraIndex = 0
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Python launcher (py) was not found. Install Python 3.10+ first.'
}

& py payload_app.py --camera usb --camera-index $CameraIndex --rescue-demo @args
