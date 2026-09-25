# Registers tvnserver.exe -run as a Scheduled Task that fires at logon, the
# same way install-autostart-task.ps1 registers this repo's own connect
# loop. Run once, from an elevated PowerShell, for the same account that has
# AutoAdminLogon configured (see docs/vm-windows-mcp.md / vm-windows-cua.md).
#
# Confirmed live (2026-09-25) that TightVNC installed as a WINDOWS SERVICE
# (SERVER_REGISTER_AS_SERVICE=1, the vm-windows-mcp.md install command) shows
# a black screen on Windows Server 2022 -- a known upstream bug
# (WTSQueryUserToken failing with ERROR_NO_TOKEN / 1008, see
# https://sourceforge.net/p/vnc-tight/bugs/1579/). A service runs in
# Session-0 isolation and has to explicitly query the console user's token to
# attach to it; on Server 2022 that query fails for tvnserver specifically.
# Running it the same way this repo's own connect loop runs -- an ordinary
# process in the interactive console session, not a service -- sidesteps the
# bug entirely, which is why this script exists instead of just leaving
# SERVER_REGISTER_AS_SERVICE=1 in place.
#
# -LogonType Interactive + -AtLogOn is the same deliberate choice
# install-autostart-task.ps1 makes, for the same reason: a session with an
# actual rendered desktop, not Session-0 isolation. Also confirmed live: an
# ordinary (non-admin/console-mode) RDP session's own virtual display driver
# stops rendering the instant that RDP client disconnects -- Windows swaps it
# to a black placeholder to save resources on a disconnected session. This
# task's interactive session is the auto-login console session, not whatever
# session a plain RDP login happens to create, so it keeps rendering
# regardless of RDP/VNC clients coming and going. If you set this up over
# RDP, use admin/console mode (`mstsc /admin`, or `/console` on older
# clients) so you're configuring the SAME session this task will run in --
# an ordinary RDP login is a different, throwaway session entirely.
#
# Run this AFTER uninstalling the service registration (this script does
# that for you, but see the note below) -- leaving both a service and this
# task registered recreates the "two tvnserver processes fighting over port
# 5900" state observed live when both were active at once.

param(
  [string]$UserName = $env:USERNAME,
  [string]$TvnServerPath = "C:\Program Files\TightVNC\tvnserver.exe",
  [string]$TaskName = "TightVNCServer"
)

if (-not (Test-Path $TvnServerPath)) {
  throw "tvnserver.exe not found at $TvnServerPath -- pass -TvnServerPath if TightVNC is installed elsewhere"
}

# Checked first, not just run unconditionally with errors swallowed:
# tvnserver.exe -remove pops a blocking GUI MessageBox ("Service is not
# registered") when there's nothing to remove, rather than a silent non-zero
# exit -- confirmed live, and 2>$null doesn't touch it since it's a real
# dialog, not stderr output. That dialog blocks this script (and anyone
# re-running it, which is the expected steady state after the first run)
# until a human clicks OK, so the existence check below avoids calling
# -remove at all once there is nothing left to remove.
if (Get-Service -Name tvnserver -ErrorAction SilentlyContinue) {
  Write-Output "Removing existing tvnserver Windows service registration..."
  & $TvnServerPath -remove
} else {
  Write-Output "No tvnserver Windows service registered -- nothing to remove."
}

$action = New-ScheduledTaskAction -Execute $TvnServerPath -Argument "-run"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserName
$principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Force

Write-Output "Registered task $TaskName. It fires at the next logon for $UserName."
Write-Output "To start it now without logging off/on, run: Start-ScheduledTask -TaskName $TaskName"
Write-Output "Confirm afterward with: Get-Process tvnserver -- exactly one process, not fighting an old service instance."
