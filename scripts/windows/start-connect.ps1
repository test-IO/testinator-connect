# Restart-loop wrapper, meant to be launched by the Scheduled Task
# install-autostart-task.ps1 registers (At-logon trigger, Interactive logon
# type) -- not run directly as a one-off. Task Scheduler only restarts a
# *task*, not the process inside it, and a bare invocation would leave the
# machine disconnected until someone notices and re-runs it by hand; this
# loop keeps retrying instead.
#
# Must run in the interactive console session (which is exactly what the
# At-logon/Interactive registration below gives it), not Session 0 -- this
# process's child (electron) is what spawns windows-mcp over stdio, and
# windows-mcp's UI Automation/screen-capture calls only work against a real
# interactive desktop.
#
# Invokes the built Electron binary directly instead of "npm run cli" --
# npm's own argv handling on Windows was observed to silently drop the
# literal token --config while still forwarding its value, even past a
# -- separator (not a quoting mistake on the caller's end -- reproduced
# with a real npm-on-Windows install). Going straight to electron.cmd
# sidesteps that layer entirely; the config path travels via
# CONNECT_CONFIG_PATH instead of argv for the same reason.

param(
  [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$ConfigPath = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "config.json"),
  [string]$LogDir = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "logs"),
  [int]$RestartDelaySeconds = 10
)

# fnm (and similar Node version managers) put node/npm on PATH via a hook in
# $PROFILE -- which only loads for interactive shells. Task Scheduler invokes
# this script with -File, and so does a direct manual run of the .ps1 file;
# neither loads a profile, so without this, npm is invisible here even
# though it works fine in an ordinary interactive prompt. Harmless no-op if
# fnm isn't installed.
if (Get-Command fnm -ErrorAction SilentlyContinue) {
  fnm env --use-on-cd | Out-String | Invoke-Expression
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Read by stop-connect.ps1 to find this specific wrapper instance rather than
# guessing by process name -- more than one could exist during a manual test.
$pidFile = Join-Path $LogDir "wrapper.pid"
$PID | Out-File -FilePath $pidFile -Encoding ascii -Force

function Write-Log([string]$Message) {
  $line = "[$(Get-Date -Format o)] $Message"
  Write-Output $line
  Add-Content -Path (Join-Path $LogDir "wrapper.log") -Value $line
}

Write-Log ("start-connect.ps1 starting -- repo={0} config={1} (wrapper pid {2})" -f $RepoPath, $ConfigPath, $PID)

Set-Location $RepoPath

$buildLog = Join-Path $LogDir "build.log"
Write-Log ("Building (electron-vite build) -- log: {0}" -f $buildLog)
& npm run build *>> $buildLog
if ($LASTEXITCODE -ne 0) {
  Write-Log ("Build failed (exit {0}) -- see {1}. Not starting the loop." -f $LASTEXITCODE, $buildLog)
  Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
  exit 1
}

$electronPath = Join-Path $RepoPath "node_modules\.bin\electron.cmd"
$mainScript = Join-Path $RepoPath "out\main\index.js"
$env:CONNECT_CONFIG_PATH = $ConfigPath

try {
  while ($true) {
    $runLog = Join-Path $LogDir ("connect-{0}.out.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    $errLog = Join-Path $LogDir ("connect-{0}.err.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    Write-Log ("Launching electron --cli (config: {0}, log: {1})" -f $ConfigPath, $runLog)

    # electron.cmd invoked directly, not through cmd.exe -- an intermediate
    # shell layer was the actual source of a "system cannot find the path
    # specified" failure here (plus visibly mangling the build log's
    # checkmark characters into garbage, a codepage symptom of the same
    # layer). -ArgumentList as an array needs no manual quoting at all, so
    # there's nothing left to get corrupted between here and the child
    # process. The two-file split (rather than one merged log) is the
    # trade-off: Start-Process's Redirect* parameters refuse to share a
    # single path. $env:CONNECT_CONFIG_PATH above is inherited automatically.
    #
    # -WindowStyle Hidden (not -NoNewWindow) is deliberate: -NoNewWindow
    # shares this script's own console, so a Ctrl+C typed here to get a
    # prompt back for a diagnostic command -- or simply closing this
    # window -- sends a termination signal to every process attached to
    # that console, electron included ("electron.exe exited with signal
    # SIGINT" despite nobody targeting it directly). A hidden window gives
    # the child its own console, decoupled from whatever happens to this
    # one.
    $proc = Start-Process -FilePath $electronPath -ArgumentList @($mainScript, "--cli") `
      -WorkingDirectory $RepoPath -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $runLog -RedirectStandardError $errLog

    Wait-Process -Id $proc.Id
    Write-Log ("electron --cli exited with code {0} -- restarting in {1}s" -f $proc.ExitCode, $RestartDelaySeconds)
    Start-Sleep -Seconds $RestartDelaySeconds
  }
}
finally {
  Remove-Item -Path $pidFile -ErrorAction SilentlyContinue
}
