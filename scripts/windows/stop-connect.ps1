# Stops the start-connect.ps1 loop cleanly, including its child process tree
# (cmd.exe -> npm -> node -> electron). Killing just the wrapper's own PID
# leaves the actual connect process running and reconnected, since
# Wait-Process only blocks the wrapper -- it doesn't tie their lifetimes
# together on its own.

param(
  [string]$LogDir = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "logs")
)

$pidFile = Join-Path $LogDir "wrapper.pid"
if (-not (Test-Path $pidFile)) {
  Write-Output ("No wrapper.pid found at {0} -- is start-connect.ps1 running?" -f $pidFile)
  exit 1
}

$wrapperPid = (Get-Content $pidFile -Raw).Trim()
Write-Output ("Stopping wrapper (pid {0}) and its process tree..." -f $wrapperPid)
taskkill /PID $wrapperPid /T /F
Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
