param(
    [Parameter(Mandatory = $true)]
    [string]$VideoPath
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"

Invoke-RepoPython rescue_laptop.py --video $VideoPath @args
