param([string]$InstallDir, [int]$Port=4173, [int]$RescuePort=8877, [switch]$InstallOnly)
$ErrorActionPreference='Stop'
$metadata=Get-Content -LiteralPath "$PSScriptRoot\integrations\gods_eye_view.json" -Raw | ConvertFrom-Json
if(-not $InstallDir){$InstallDir=Join-Path $env:USERPROFILE 'PROJECTS\gods-eye-view'}
$InstallDir=[IO.Path]::GetFullPath($InstallDir)
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw 'Install Node.js 24.14+ (24.x) or 26.x, then retry.'}
$nodeVersion=[version](& node -p 'process.versions.node')
if(-not (($nodeVersion.Major -eq 24 -and $nodeVersion.Minor -ge 14) -or $nodeVersion.Major -eq 26)){throw "Node.js $nodeVersion is unsupported. Use 24.14+ (24.x) or 26.x."}
if(-not (Get-Command git -ErrorAction SilentlyContinue)){throw 'Install Git, then retry.'}
if(-not (Test-Path -LiteralPath $InstallDir)){
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  git -C $InstallDir init
  if($LASTEXITCODE -ne 0){throw 'Gods Eye View checkout initialisation failed.'}
  git -C $InstallDir remote add origin $metadata.repository
  git -C $InstallDir fetch --depth 1 origin $metadata.commit
  if($LASTEXITCODE -ne 0){throw 'Gods Eye View download failed.'}
  git -C $InstallDir checkout --detach FETCH_HEAD
  if($LASTEXITCODE -ne 0){throw 'Gods Eye View checkout failed.'}
}
$actual=& git -C $InstallDir rev-parse HEAD
if($LASTEXITCODE -ne 0 -or $actual -ne $metadata.commit){throw "Expected upstream commit $($metadata.commit). Use a separate checkout at that commit; existing files were not changed."}
if(-not (Test-Path -LiteralPath (Join-Path $InstallDir 'node_modules\vite'))){
  Push-Location $InstallDir
  $previousDownload=$env:PUPPETEER_SKIP_DOWNLOAD
  try{$env:PUPPETEER_SKIP_DOWNLOAD='true';npm ci --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Upstream dependency installation failed.'}}
  finally{$env:PUPPETEER_SKIP_DOWNLOAD=$previousDownload;Pop-Location}
}
if($InstallOnly){Write-Host "Gods Eye View ready at $InstallDir";return}
$env:GODS_EYE_VIEW_ROOT=$InstallDir
$env:GODS_EYE_VIEW_PORT="$Port"
$env:DRONE_RESCUE_ORIGIN="http://127.0.0.1:$RescuePort"
Write-Host "Gods Eye View: http://127.0.0.1:$Port - rescue dashboard must be running on $RescuePort."
& node "$PSScriptRoot\scripts\start_gods_eye_rescue.mjs"
if($LASTEXITCODE -ne 0){throw 'Gods Eye View stopped with an error.'}
