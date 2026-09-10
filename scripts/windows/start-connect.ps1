# Restart-loop wrapper, meant to be launched by the Scheduled Task
# install-autostart-task.ps1 registers (At-logon trigger, Interactive logon
# type) — not run directly as a one-off. Task Scheduler only restarts a
# *task*, not the process inside it, and a bare invocation would leave the
# machine disconnected until someone notices and re-runs it by hand; this
# loop keeps retrying instead.
#
# Must run in the interactive console session (which is exactly what the
# At-logon/Interactive registration below gives it), not Session 0 — this
# process's child (electron) is what spawns windows-mcp over stdio, and
# windows-mcp's UI Automation/screen-capture calls only work against a real
# interactive desktop.
#
# Invokes the built Electron binary directly instead of `npm run cli` —
# npm's own argv handling on Windows was observed to silently drop the
# literal token `--config` while still forwarding its value, even past a
# `--` separator (not a quoting mistake on the caller's end — reproduced
# with a real npm-on-Windows install). Going straight to electron.cmd
# sidesteps that layer entirely; the config path travels via
# CONNECT_CONFIG_PATH instead of argv for the same reason.

param(
  [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$ConfigPath = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "config.json"),
  [string]$LogDir = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "logs"),
  [int]$RestartDelaySeconds = 10
)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Read by stop-connect.ps1 to find this specific wrapper instance rather than
# guessing by process name — more than one could exist during a manual test.
$pidFile = Join-Path $LogDir "wrapper.pid"
$PID | Out-File -FilePath $pidFile -Encoding ascii -Force

function Write-Log([string]$Message) {
  $line = "[$(Get-Date -Format o)] $Message"
  Write-Output $line
  Add-Content -Path (Join-Path $LogDir "wrapper.log") -Value $line
}

Write-Log "start-connect.ps1 starting — repo=$RepoPath config=$ConfigPath (wrapper pid $PID)"

Set-Location $RepoPath

$buildLog = Join-Path $LogDir "build.log"
Write-Log "Building (electron-vite build) — log: $buildLog"
& npm run build *>> $buildLog
if ($LASTEXITCODE -ne 0) {
  Write-Log "Build failed (exit $LASTEXITCODE) — see $buildLog. Not starting the loop."
  Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
  exit 1
}

$electronPath = Join-Path $RepoPath "node_modules\.bin\electron.cmd"
$mainScript = Join-Path $RepoPath "out\main\index.js"
$env:CONNECT_CONFIG_PATH = $ConfigPath

try {
  while ($true) {
    $runLog = Join-Path $LogDir "connect-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    Write-Log "Launching electron --cli (config: $ConfigPath, log: $runLog)"

    # Routed through cmd.exe so stdout+stderr merge into one file
    # (Start-Process's separate -RedirectStandardOutput/-RedirectStandardError
    # refuse to share a single path). $env:CONNECT_CONFIG_PATH above is
    # inherited by this child process tree automatically.
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c `"$electronPath`" `"$mainScript`" --cli >> `"$runLog`" 2>&1" `
      -WorkingDirectory $RepoPath -NoNewWindow -PassThru

    Wait-Process -Id $proc.Id
    Write-Log "electron --cli exited with code $($proc.ExitCode) — restarting in ${RestartDelaySeconds}s"
    Start-Sleep -Seconds $RestartDelaySeconds
  }
}
finally {
  Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
}
