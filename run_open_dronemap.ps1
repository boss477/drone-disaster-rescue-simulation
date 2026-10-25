<#
.SYNOPSIS
  Runs the official OpenDroneMap Docker image against a local image set. SAMPLE/SURVEY IMAGERY ONLY.
.DESCRIPTION
  Put JPEG/TIFF/DNG survey images in <DatasetRoot>\<ProjectName>\images.
  Results remain in that external dataset directory and are not committed here.
  The dataset root must be OUTSIDE this repository (default: D:\DroneRescueData\odm) so photos
  and generated products can never be committed by accident.
.PARAMETER DatasetRoot
  External folder that contains <ProjectName>\images. Default D:\DroneRescueData\odm.
.PARAMETER ProjectName
  Letters, digits, '.', '_' or '-' only. Default rescue-survey (sample dataset: brighton_beach).
.PARAMETER DetailedModel
  Higher-resolution orthophoto (2 cm/px target).
.PARAMETER DryRun
  Validate the paths and print the Docker command without running it.
#>
param(
    [string]$DatasetRoot = 'D:\DroneRescueData\odm',
    [string]$ProjectName = 'rescue-survey',
    [switch]$DetailedModel,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner

if ($ProjectName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "ProjectName may contain only letters, digits, '.', '_' and '-' (got '$ProjectName')."
}
if (-not (Test-Path -LiteralPath $DatasetRoot -PathType Container)) {
    throw "Dataset root not found: $DatasetRoot. Create it (and the drive must exist) or pass -DatasetRoot."
}
$root = (Resolve-Path -LiteralPath $DatasetRoot).Path.TrimEnd('\')
$repo = $PSScriptRoot.TrimEnd('\')
if ($root -ieq $repo -or $root.StartsWith($repo + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Dataset root '$root' is inside the repository. Use an external folder such as D:\DroneRescueData\odm so photos and outputs are never committed."
}
$images = Join-Path $root "$ProjectName\images"
if (-not (Test-Path -LiteralPath $images -PathType Container)) {
    throw "Expected image directory: $images"
}
$imageCount = @(Get-ChildItem -LiteralPath $images -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|tif|tiff|dng)$' }).Count
if ($imageCount -lt 3) { throw 'OpenDroneMap needs an overlapping survey image set; fewer than 3 supported images were found.' }

$dockerRoot = $root -replace '\\', '/'
# --dsm makes ODM write the elevation GeoTIFF; the orthophoto, point cloud (LAZ) and textured OBJ are default outputs.
$arguments = @('run', '--rm', '-v', "${dockerRoot}:/datasets", 'opendronemap/odm', '--project-path', '/datasets', $ProjectName, '--dsm')
if ($DetailedModel) { $arguments += @('--orthophoto-resolution', '2') }

Write-Host "Dataset: $images ($imageCount images)" -ForegroundColor Green
Write-Host 'Outputs: orthophoto, DSM, georeferenced point cloud and textured 3D model (not committed).'
if ($DryRun) {
    Write-Host ('DRY RUN - would run: docker ' + ($arguments -join ' ')) -ForegroundColor Yellow
    exit 0
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker was not found. Install Docker Desktop, then retry.'
}
& docker @arguments
if ($LASTEXITCODE -eq 0) {
    Write-Host "Verify the products with:  py verify_odm_outputs.py --project-dir `"$root\$ProjectName`"" -ForegroundColor Cyan
}
exit $LASTEXITCODE
