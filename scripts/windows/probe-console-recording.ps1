# Probes screen recording on the CONSOLE session, unattended, and writes what it
# finds to a log. A copy of prep-cua-session.ps1 with the probe wedged between the
# session migration and the self-close.
#
# Why it has to work this way: everything you can measure over RDP is the wrong
# environment. An RDP login gets its own session, bound to the Microsoft Remote
# Display Adapter, at whatever resolution the client negotiated -- not the Parsec
# virtual display that production records. And you cannot RDP in to run these
# tests afterwards, because reconnecting creates a new session and undoes the
# migration. So the script migrates itself to console (which disconnects your RDP
# client), keeps running there because it is part of the session being moved, and
# leaves its answers on disk.
#
# Run from an ELEVATED PowerShell, as the last thing you do before disconnecting.
# Then reconnect later and read the log.
#
# What it answers:
#   1. What get_screen_size reports on console, vs the full virtual desktop --
#      i.e. how much the crop is actually saving.
#   2. Whether launch_app grants start_minimized here. Over RDP it is refused
#      (code: background_unavailable), which leaves ffmpeg's console window in
#      frame; this is the environment where the answer counts.
#   3. Where that console window lands, and whether set_window_frame can move it
#      off the recorded rectangle if minimizing stays unavailable.
#   4. Whether kill_app is refused by the protected-resource scope.
#   5. Whether the resulting fragmented mp4 is readable after that hard kill.
#
# The script's own elevated console is on screen throughout, so expect it in the
# captured frame. That is the point: it shows what a visible console costs.

$ErrorActionPreference = 'Continue'

$dir = "C:\Users\Public\testinator-recordings"
$log = "$dir\console-probe.log"
$video = "$dir\console-probe.mp4"
$still = "$dir\console-probe.png"

function Log($m) { $m | Out-File -Append -Encoding utf8 $log }
function Run($label, $json, $tool) {
    Log ""
    Log "=== $label ==="
    # Piped via stdin, not as an argument: PowerShell 5.1 strips the quotes around
    # JSON field names in native-command args, and cua-driver rejects the result.
    $raw = ($json | cua-driver call $tool 2>&1 | Out-String)
    Log $raw.Trim()
    return $raw
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
"@

Remove-Item $log, $video, $still -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dir | Out-Null

tscon (Get-Process -Id $PID).SessionId /dest:console

# The migration is not instant; measuring before it settles reads the session on
# its way out.
Start-Sleep -Seconds 8

Log "probe run $(Get-Date -Format o), session $((Get-Process -Id $PID).SessionId)"

# SM_CXSCREEN/SM_CYSCREEN are the PRIMARY display; SM_CX/CYVIRTUALSCREEN are every
# display combined. cua-driver's recorder captured the latter, which is the defect.
$pw = [Win32]::GetSystemMetrics(0)
$ph = [Win32]::GetSystemMetrics(1)
$vw = [Win32]::GetSystemMetrics(78)
$vh = [Win32]::GetSystemMetrics(79)
Log ""
Log "=== display geometry (console session) ==="
Log "primary        : ${pw}x${ph}"
Log "virtual desktop: ${vw}x${vh}"

Run "get_screen_size" '{}' "get_screen_size" | Out-Null

# libx264 refuses an odd dimension under yuv420p; the recorder rounds down the same way.
$cw = $pw - ($pw % 2)
$ch = $ph - ($ph % 2)
Log "capture rect   : ${cw}x${ch}"

$ffargs = @(
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "gdigrab", "-framerate", "15", "-draw_mouse", "1",
    "-offset_x", "0", "-offset_y", "0", "-video_size", "${cw}x${ch}", "-i", "desktop",
    "-t", "60",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-crf", "23",
    "-pix_fmt", "yuv420p", "-g", "15",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000",
    "-y", $video
)
Log "ffmpeg argv    : $($ffargs -join ' ')"

$minimized = @{ name = "ffmpeg"; additional_arguments = $ffargs; start_minimized = $true } |
             ConvertTo-Json -Compress -Depth 5
$raw = Run "launch_app (start_minimized)" $minimized "launch_app"

$granted = $raw -notmatch 'background_unavailable'
if (-not $granted) {
    Log "start_minimized REFUSED on console as well -- retrying un-minimized, as start_recording does"
    $plain = @{ name = "ffmpeg"; additional_arguments = $ffargs } | ConvertTo-Json -Compress -Depth 5
    $raw = Run "launch_app (un-minimized)" $plain "launch_app"
}

$res = $null
try { $res = $raw | ConvertFrom-Json } catch { Log "could not parse launch_app's reply as JSON" }
$ffPid = $res.pid

if (-not $ffPid) {
    Log "NO PID -- nothing to stop, and nothing further to probe."
    Start-Sleep -Seconds 1
    Stop-Process -Id $PID -Force
}

Log "ffmpeg pid     : $ffPid"

# Only worth trying when the window is on screen: this is the fallback for keeping
# the console out of frame if start_minimized is unavailable. x = primary width
# parks it immediately right of the recorded rectangle.
$wid = $res.windows[0].window_id
if (-not $granted -and $wid) {
    Log "console window : $($res.windows[0].bounds | ConvertTo-Json -Compress)"
    $frame = @{ pid = $ffPid; window_id = $wid; x = [double]$pw; y = 0.0
                width = 900.0; height = 500.0 } | ConvertTo-Json -Compress
    Run "set_window_frame (park console off the recorded rect)" $frame "set_window_frame" | Out-Null
    Run "list_windows (did it move?)" (@{ pid = $ffPid } | ConvertTo-Json -Compress) "list_windows" | Out-Null
}

Start-Sleep -Seconds 15

Run "kill_app" (@{ pid = $ffPid } | ConvertTo-Json -Compress) "kill_app" | Out-Null
Start-Sleep -Seconds 2

Log ""
Log "=== the recording, after a hard kill ==="
Log ((ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height -of default=nw=1 $video 2>&1) | Out-String).Trim()
Log ("frames decoded : " + (((ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 $video 2>&1) | Out-String).Trim()))

# A still is the only way to SEE the result on this box: Windows Server ships no
# Media Foundation codecs, so no player here can open an mp4 however valid it is.
ffmpeg -y -v error -ss 5 -i $video -frames:v 1 $still 2>&1 | Out-Null
Log "still frame    : $still"

Log ""
Log "probe finished $(Get-Date -Format o)"

# Leave the desktop as prep-cua-session.ps1 would: a real window in the foreground
# for cua-driver to see, and no elevated console for it to get stuck on (UIPI drops
# every click from Medium integrity at a High-integrity window).
$edge = Get-Process msedge -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
if ($edge) {
    [Win32]::ShowWindow($edge.MainWindowHandle, 3)
    [Win32]::SetForegroundWindow($edge.MainWindowHandle)
}

Start-Sleep -Seconds 1
Stop-Process -Id $PID -Force
