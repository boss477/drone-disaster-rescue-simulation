$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process (Join-Path $root 'rescue_simulation.html')
