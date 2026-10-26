# Leaves RDP without locking the Windows session. Run it from an elevated PowerShell inside the
# RDP session, instead of closing the RDP window.
#
# Closing the RDP window locks the session, and a locked session shows the sign-in screen, which
# cua-driver can't capture or drive. Moving the session to the console while still connected
# never locks it; it also ends the RDP connection.
#
# The window then closes itself: it is elevated, and Windows drops cua-driver's input to elevated
# windows, so it would block cua-driver wherever it covers the screen.
#Requires -RunAsAdministrator

$session = (Get-Process -Id $PID).SessionId
tscon.exe $session /dest:console
if ($LASTEXITCODE -ne 0) {
    Write-Error "tscon failed with exit code $LASTEXITCODE; the session was not moved."
    return
}
Start-Sleep -Seconds 2
Stop-Process -Id $PID -Force
