# Registers start-connect.ps1 as a Scheduled Task that fires at logon.
# Run once, from an elevated PowerShell, as/for the same account that has
# AutoAdminLogon configured on the VM (see testinator-connect/docs -- the
# windows-mcp VM setup note) -- this task only ever runs in that account's
# session.
#
# -LogonType Interactive + -AtLogOn is the deliberate choice here, not
# ServiceAccount/S4U: the latter ("run whether or not user is logged on")
# executes in a non-interactive session with no desktop, which is exactly
# the Session-0 isolation windows-mcp's UI Automation can't work through.
# This task is only ever "logged on" in the sense of an actual rendered
# desktop existing to drive -- which on a headless cloud VM is what the
# console-attached VNC server + auto-login are for (see the VM setup doc).

param(
  [string]$UserName = $env:USERNAME,
  [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$ConfigPath = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path "config.json"),
  [string]$TaskName = "TestinatorConnectCLI"
)

$scriptPath = Join-Path $PSScriptRoot "start-connect.ps1"
if (-not (Test-Path $scriptPath)) {
  throw "start-connect.ps1 not found at $scriptPath"
}

# Single-quoted format string -- no interpolation or backtick-escaping needed
# at all, since the embedded double-quotes are just literal characters here.
$argument = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoPath "{1}" -ConfigPath "{2}"' -f $scriptPath, $RepoPath, $ConfigPath
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserName

# ExecutionTimeLimit defaults to 3 days if left unset -- Task Scheduler kills
# the task (and this long-lived loop with it) the moment that elapses, with
# nothing in the logs to explain the disconnect. Zero disables the limit.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force

Write-Output "Registered task $TaskName. It fires at the next logon for $UserName."
Write-Output "To start it now without logging off/on, run: Start-ScheduledTask -TaskName $TaskName"
