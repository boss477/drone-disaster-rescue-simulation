<#
.SYNOPSIS
  Downloads pretrained/evaluation assets to an external drive. No training is performed.
#>
param(
    [Parameter(Mandatory = $true)][string]$AssetRoot,
    [switch]$IncludeFloodNet
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$root = [System.IO.Path]::GetFullPath($AssetRoot)
$models = New-Item -ItemType Directory -Force -Path (Join-Path $root 'models')
$datasets = New-Item -ItemType Directory -Force -Path (Join-Path $root 'datasets')
$registry = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'pretrained_assets.json') -Raw | ConvertFrom-Json

function Get-Asset([string]$Id) {
    $asset = $registry.assets | Where-Object id -eq $Id
    if (-not $asset) { throw "Unknown asset: $Id" }
    $destination = Join-Path $root $asset.filename
    if (-not (Test-Path -LiteralPath $destination)) {
        Write-Host "Downloading $Id..." -ForegroundColor Cyan
        & curl.exe -L --fail --retry 3 -o $destination $asset.download
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Id" }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    if ($asset.sha256 -and $actual -ne $asset.sha256) { throw "Checksum mismatch: $Id" }
    Write-Host "Verified $Id ($actual)" -ForegroundColor Green
}

Get-Asset 'yolo11s-visdrone'
Get-Asset 'visdrone-2019-det-val'

if ($IncludeFloodNet) {
    if (-not (Get-Command kaggle -ErrorAction SilentlyContinue)) {
        throw 'Kaggle CLI is required for FloodNet. Install and authenticate it first.'
    }
    $floodRoot = New-Item -ItemType Directory -Force -Path (Join-Path $datasets 'FloodNet')
    & kaggle datasets download -d 'aletbm/aerial-imagery-dataset-floodnet-challenge' -p $floodRoot.FullName
    if ($LASTEXITCODE -ne 0) { throw 'FloodNet download failed.' }
}

Write-Host "Assets ready under $root" -ForegroundColor Green
