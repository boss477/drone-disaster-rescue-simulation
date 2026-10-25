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
.PARAMETER WslDistro
  Optional Docker Desktop-integrated WSL distribution. Auto-detected when available; useful for removable drives.
#>
param(
    [string]$DatasetRoot = $env:DRONE_ODM_ROOT,
    [string]$ProjectName = 'rescue-survey',
    [switch]$DetailedModel,
    [switch]$DryRun,
    [string]$WslDistro = $env:DRONE_ODM_WSL_DISTRO
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Write-SimulationBanner

if (-not $DatasetRoot -and (Test-Path -LiteralPath 'D:\DroneRescueData\odm' -PathType Container)) {
    $DatasetRoot = 'D:\DroneRescueData\odm'
}
if (-not $DatasetRoot) {
    throw 'Pass -DatasetRoot or set DRONE_ODM_ROOT. Example: -DatasetRoot D:\DroneRescueData\odm'
}

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

if (-not $DryRun -and -not $WslDistro -and (Get-Command wsl -ErrorAction SilentlyContinue)) {
    $distros = @(& wsl -l -q 2>$null) | ForEach-Object { $_ -replace "`0", '' }
    foreach ($candidate in @('Ubuntu', 'Ubuntu-24.04-PX4')) {
        if ($distros -contains $candidate) {
            & wsl -d $candidate -- docker info --format '{{.ServerVersion}}' *> $null
            if ($LASTEXITCODE -eq 0) { $WslDistro = $candidate; break }
        }
    }
}

$dockerRoot = $root -replace '\\', '/'
if ($WslDistro -and $root -match '^([A-Za-z]):\\(.*)$') {
    $drive = $Matches[1].ToLowerInvariant()
    $tail = $Matches[2] -replace '\\', '/'
    $dockerRoot = "/mnt/$drive/$tail"
    if (-not $DryRun) {
        & wsl -d $WslDistro -u root -- bash -lc "mkdir -p /mnt/$drive; mountpoint -q /mnt/$drive || mount -t drvfs $($drive.ToUpperInvariant()): /mnt/$drive"
        if ($LASTEXITCODE -ne 0) { throw "Could not mount drive $($drive.ToUpperInvariant()): in WSL distro $WslDistro." }
    }
}
# Generate the raw survey products plus browser-ready imagery and 3D Tiles used by the dashboard.
$arguments = @('run', '--rm', '-v', "${dockerRoot}:/datasets", 'opendronemap/odm', '--project-path', '/datasets', $ProjectName, '--dsm', '--tiles', '--3d-tiles', '--gltf')
if ($DetailedModel) { $arguments += @('--orthophoto-resolution', '2') }

Write-Host "Dataset: $images ($imageCount images)" -ForegroundColor Green
Write-Host 'Outputs: orthophoto, DSM, point cloud, textured model, map tiles and Cesium 3D Tiles (not committed).'
if ($DryRun) {
    $prefix = if ($WslDistro) { "wsl -d $WslDistro -- docker" } else { 'docker' }
    Write-Host ('DRY RUN - would run: ' + $prefix + ' ' + ($arguments -join ' ')) -ForegroundColor Yellow
    exit 0
}
if (-not $WslDistro -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker was not found. Install Docker Desktop, then retry.'
}
if ($WslDistro) { & wsl -d $WslDistro -- docker @arguments } else { & docker @arguments }
if ($LASTEXITCODE -eq 0) {
    Write-Host "Verify the products with:  py verify_odm_outputs.py --project-dir `"$root\$ProjectName`"" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath (Join-Path $root "$ProjectName\3d_tiles\pointcloud\tileset.json")) -and
        -not (Test-Path -LiteralPath (Join-Path $root "$ProjectName\pointcloud_tiles\tileset.json"))) {
        Write-Warning 'ODM did not generate point-cloud 3D Tiles. Install requirements-odm-pointcloud.txt and run convert_odm_pointcloud.py for the browser layer.'
    }
}
exit $LASTEXITCODE
