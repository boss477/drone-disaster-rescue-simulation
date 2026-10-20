<#
.SYNOPSIS
  One-time setup for a fresh clone (Windows).
.DESCRIPTION
  Creates a local .venv, installs requirements-demo.txt, checks that the dependencies import,
  and reports whether the pretrained CLIP model is cached.
.PARAMETER Mavlink
  Also install requirements-mavlink.txt (QGroundControl telemetry bridge).
.PARAMETER DownloadModel
  Download the CLIP model now (about 600 MB) instead of on first use.
#>
param(
    [switch]$Mavlink,
    [switch]$DownloadModel
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"

Write-Host '== Checking Python ==' -ForegroundColor Cyan
if (Get-Command py -ErrorAction SilentlyContinue) { $bootstrap = @('py', '-3') }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $bootstrap = @('python') }
else { throw 'Python 3.10+ was not found. Install it from https://www.python.org/downloads/ then re-run ./setup.ps1' }
$extra = @(); if ($bootstrap.Count -gt 1) { $extra = $bootstrap[1..($bootstrap.Count - 1)] }
$version = & $bootstrap[0] @extra -c "import sys; print('%d.%d' % sys.version_info[:2])"
Write-Host "Found Python $version"
& $bootstrap[0] @extra -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }

if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    Write-Host '== Creating .venv ==' -ForegroundColor Cyan
    & $bootstrap[0] @extra -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment.' }
}
$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

Write-Host '== Installing dependencies (first run downloads several hundred MB) ==' -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements-demo.txt
if ($LASTEXITCODE -ne 0) { throw 'Installing requirements-demo.txt failed. See the messages above.' }
if ($Mavlink) {
    & $venvPython -m pip install -r requirements-mavlink.txt
    if ($LASTEXITCODE -ne 0) { throw 'Installing requirements-mavlink.txt failed.' }
}

Write-Host '== Checking installation ==' -ForegroundColor Cyan
& $venvPython disaster_zero_shot.py --check
if ($LASTEXITCODE -ne 0) { throw 'Dependency check failed. See the messages above.' }
if ($Mavlink) {
    & $venvPython -c "import pymavlink; print('pymavlink OK')"
}

if ($DownloadModel) {
    Write-Host '== Downloading the CLIP model (one time) ==' -ForegroundColor Cyan
    & $venvPython disaster_zero_shot.py --download-model
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check your internet connection and re-run.' }
}

Write-Host ''
Write-Host 'Setup complete. Try:' -ForegroundColor Green
Write-Host '  ./run_image_upload.ps1                               (GUI classifier)'
Write-Host '  .\.venv\Scripts\python disaster_zero_shot.py samples/flood_street.jpg   (CLI classifier)'
Write-Host '  ./run_rescue_simulation.ps1                          (3D simulation)'
Write-Host '  ./run_all_demo.ps1                                   (simulation + QGroundControl telemetry)'
Write-Host 'Note: the .ps1 scripts use .venv automatically; plain "py" uses your global Python instead.'
