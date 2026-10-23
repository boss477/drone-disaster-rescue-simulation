<#
.SYNOPSIS
  Runs the official OpenDroneMap Docker image against a local image set.
.DESCRIPTION
  Put JPEG/TIFF/DNG survey images in <DatasetRoot>\<ProjectName>\images.
  Results remain in that external dataset directory and are not committed here.
#>
param(
    [Parameter(Mandatory = $true)][string]$DatasetRoot,
    [string]$ProjectName = 'rescue-survey',
    [switch]$DetailedModel
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker was not found. Install Docker Desktop, then retry.'
}
$root = (Resolve-Path -LiteralPath $DatasetRoot).Path
$images = Join-Path $root "$ProjectName\images"
if (-not (Test-Path -LiteralPath $images -PathType Container)) {
    throw "Expected image directory: $images"
}
$imageCount = @(Get-ChildItem -LiteralPath $images -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|tif|tiff|dng)$' }).Count
if ($imageCount -lt 3) { throw 'OpenDroneMap needs an overlapping survey image set; fewer than 3 supported images were found.' }

$dockerRoot = $root -replace '\\', '/'
$arguments = @('run', '--rm', '-it', '-v', "${dockerRoot}:/datasets", 'opendronemap/odm', '--project-path', '/datasets', $ProjectName)
if ($DetailedModel) { $arguments += @('--dsm', '--orthophoto-resolution', '2') }

Write-Host "Running official OpenDroneMap on $imageCount images." -ForegroundColor Green
Write-Host 'Outputs include an orthophoto, point cloud and textured 3D model.'
& docker @arguments
exit $LASTEXITCODE
