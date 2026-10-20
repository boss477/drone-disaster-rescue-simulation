param(
    [int]$CameraIndex = 0
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"

Invoke-RepoPython payload_app.py --camera usb --camera-index $CameraIndex --rescue-demo @args
