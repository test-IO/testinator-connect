# Prepares a Windows VM's desktop so cua-driver can actually drive it, then gets
# out of the way. Run this from an elevated PowerShell inside your RDP session,
# as the last thing you do before disconnecting -- it disconnects you itself.
#
# What it does, and why each step is needed:
#
# 1. tscon ... /dest:console -- moves this live session (with everything running
#    in it, including testinator-connect and cua-driver) onto the "console"
#    session, the only one bound to the persistent virtual display. Without this,
#    cua-driver's screen capture dies the moment RDP disconnects: an ordinary RDP
#    login gets its own session whose display Windows tears down on disconnect,
#    and it never falls back to the virtual display on its own. See
#    docs/vm-windows-cua.md for the full story.
#
#    This is what disconnects your RDP client. The script keeps running anyway,
#    because it is part of the session being moved, not something RDP owns.
#
# 2. Foreground Edge -- so the first thing cua-driver sees is a window it can
#    actually interact with. Uses SetForegroundWindow rather than WScript.Shell's
#    AppActivate, which matches poorly against Edge (Chromium spawns many
#    msedge.exe processes; only one owns the top-level window).
#
# 3. Stop-Process -Id $PID -- kills this PowerShell host so its window genuinely
#    disappears. `exit` alone only ends the *script*, leaving the console window
#    open and in the foreground, which cua-driver then sees and tries to click.
#    It cannot: this window is elevated (High integrity) and cua-driver runs at
#    Medium, so UIPI silently drops every click at it. The window has to be gone
#    before cua-driver looks, and only this script can remove it.
#
# Session IDs are read from this process rather than hardcoded -- they shift
# between reconnects.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

tscon (Get-Process -Id $PID).SessionId /dest:console

# The migration is not instant; foregrounding before it settles lands on the
# session that is on its way out.
Start-Sleep -Seconds 3

$edge = Get-Process msedge -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1

if ($edge) {
    # SW_SHOWMAXIMIZED, not SW_RESTORE: restore un-minimizes a minimized window but also
    # un-maximizes an already-maximized one ("restores it to its original size and
    # position"), leaving Edge in a small window on the virtual display.
    [Win32]::ShowWindow($edge.MainWindowHandle, 3)
    [Win32]::SetForegroundWindow($edge.MainWindowHandle)
}

Start-Sleep -Seconds 1

Stop-Process -Id $PID -Force
