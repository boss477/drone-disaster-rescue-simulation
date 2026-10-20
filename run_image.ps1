param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

$resolvedImage = (Resolve-Path -LiteralPath $ImagePath -ErrorAction Stop).Path
& py payload_app.py --image $resolvedImage --rescue-demo
