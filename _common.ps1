# Shared helpers for the PowerShell scripts in this repository (dot-sourced, not run directly).
$script:RepoRoot = $PSScriptRoot

function Get-RepoPython {
    # Prefer the repository's own virtual environment, then the py launcher, then python on PATH.
    $venv = Join-Path $script:RepoRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venv) { return @($venv) }
    if (Get-Command py -ErrorAction SilentlyContinue) { return @('py', '-3') }
    if (Get-Command python -ErrorAction SilentlyContinue) { return @('python') }
    throw 'Python 3.10+ was not found. Install it from https://www.python.org/downloads/ and run ./setup.ps1'
}

function Invoke-RepoPython {
    $python = Get-RepoPython
    $extra = @()
    if ($python.Count -gt 1) { $extra = $python[1..($python.Count - 1)] }
    & $python[0] @extra @args
}

function Write-SimulationBanner {
    Write-Host '================================================================' -ForegroundColor Yellow
    Write-Host '  SIMULATION ONLY - no real drone, motor or flight controller.' -ForegroundColor Yellow
    Write-Host '================================================================' -ForegroundColor Yellow
}
