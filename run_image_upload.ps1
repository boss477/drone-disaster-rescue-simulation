# Opens the disaster image classifier GUI (AI estimate only).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. "$PSScriptRoot\_common.ps1"
Invoke-RepoPython image_upload_demo.py
