param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"

$resolvedImage = (Resolve-Path -LiteralPath $ImagePath -ErrorAction Stop).Path
Invoke-RepoPython payload_app.py --image $resolvedImage --rescue-demo
