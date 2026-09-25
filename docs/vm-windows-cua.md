# Driving a Windows VM with cua-driver, instead of windows-mcp

Sets up [OpenCUA's `cua-driver`](https://github.com/trycua/cua) on a Windows machine — the
same driver [`vm-opencua.md`](./vm-opencua.md) uses on macOS, here reached natively instead
of over SSH into a separate guest, since testinator-connect runs directly on the Windows box
itself. Use this instead of [`vm-windows-mcp.md`](./vm-windows-mcp.md) when you want cua-driver's
tool vocabulary (`click`, `get_desktop_state`, `launch_app`, ...) on Windows rather than
windows-mcp's (`Click`, `Screenshot`, `Snapshot`, ...) — they are two independent integrations
for the same OS, picked per machine by which server its `config.json` advertises.

This doc assumes no prior context — follow it top to bottom on a fresh Windows VM and you'll
end up with a working setup. Everything in it reflects what was actually confirmed live on
2026-09-25, including the part that took the longest to get right: **keeping the desktop alive
without needing someone to stay connected to it forever.**

## 1. Provision the VM

A Windows Server 2019/2022 VM (GCP, AWS, Azure — doesn't matter which), with RDP admin access.
Open the firewall for RDP (port 3389) and, later, VNC (port 5900) — restrict both to your own
IP, not the world.

## 2. Set up auto-login

So the machine has an actual logged-in desktop from the moment it boots, not a login screen
waiting for someone to type a password:

```powershell
$key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty $key AutoAdminLogon -Value "1"
Set-ItemProperty $key DefaultUserName -Value "<username>"
Set-ItemProperty $key DefaultPassword -Value "<password>"
```

Reboot once and confirm (over RDP) that it logs in by itself, with nobody typing a password.

## 3. Install cua-driver

From an elevated PowerShell:

```powershell
irm https://cua.ai/driver/install.ps1 | iex
```

Confirm it installed and can reach the desktop:

```powershell
cua-driver doctor
cua-driver list-tools
cua-driver call get_desktop_state
```

Nothing here needs an explicit permission grant on Windows (unlike macOS's Accessibility/
Screen-Recording TCC prompts) — `check_permissions` should already report UI Automation
available (`"uia": true`).

## 4. Install ffmpeg (needed for screen recordings)

```powershell
winget install Gyan.FFmpeg
```

Without this, `start_recording` reports success but a recording never actually appears — see
the "Known caveats" section below for more on recording quirks.

## 5. Install the Parsec virtual display driver

**This is the actual hard part of the whole setup, and the part most worth reading carefully.**

A headless cloud VM's desktop session only renders while *something* is actively displaying
it — an RDP client watching it, or a monitor plugged in. The moment nothing is, Windows tears
the display down, and anything trying to read the screen (`cua-driver`'s `get_desktop_state`,
a VNC server, anything) starts failing with errors like `Desktop screenshot failed: The handle
is invalid. (0x80070006)`. A **virtual display driver** fixes this by giving Windows a fake
monitor that's always "there," so there's always something to render to.

1. Go to https://github.com/nomi-san/parsec-vdd and install:
   - the **parsec-vdd driver** itself
   - the **ParsecDisplay** app (a small GUI for adding/removing a virtual display manually)
2. Open ParsecDisplay and **add a virtual display**.
3. Confirm it actually exists:
   ```powershell
   Get-PnpDevice -Class Display
   Get-CimInstance Win32_DesktopMonitor | Select Name, PNPDeviceID, ScreenWidth, ScreenHeight, Status
   ```
   You should see an entry for the Parsec display, `Status: OK`.

Having the virtual display installed is **necessary but not sufficient** — see step 6, which
is the piece that actually makes it take effect for your session.

## 6. The real fix: move your session onto "console"

Even with the virtual display installed, `cua-driver` will still fail after you disconnect
RDP, unless you do this step. Here's why: Windows keeps a separate session called `console`
that's the one actually bound to whatever display Windows treats as primary (the new virtual
one, once it exists) — but logging in over an ordinary RDP connection does **not** put you in
that session. It creates its own separate session, and whatever's running there (including
`cua-driver`) never gets the benefit of the persistent virtual display, no matter how long it
stays installed.

The fix is to move your live session onto `console`. There's a script for this —
run it from an elevated PowerShell as the **last thing you do** in your RDP session, since it
disconnects you itself:

```powershell
.\scripts\windows\prep-cua-session.ps1
```

It does three things: migrates this session onto `console`, brings Edge to the foreground (so
the first thing `cua-driver` sees is a window it can actually click — see the UIPI note
below), and closes its own PowerShell window.

If you'd rather do it by hand:

1. Find your current session's ID:
   ```powershell
   query session
   ```
   Look at the row starting with `>` — that's your current session. Note its `ID` number
   (commonly `1`, but it can vary).

2. Move it onto `console`:
   ```powershell
   tscon <that ID> /dest:console
   ```
   For example, if your session ID was `1`: `tscon 1 /dest:console`

Either way, this instantly relocates your entire live desktop — browser windows, `cua-driver`,
everything already running — onto the `console` session, which is bound to the virtual display
and keeps rendering regardless of RDP.

**Leave nothing elevated on screen.** `cua-driver` runs at Medium integrity; an elevated
("Run as Administrator") window runs at High. Windows' UIPI blocks input from the former to
the latter, so `cua-driver` can never close an elevated PowerShell window — it will try, the
clicks will be silently dropped, and it will be stuck. That's why the script closes its own
window rather than leaving it open, and why `exit` alone isn't enough (that ends the script
but leaves the console window sitting in the foreground).

## 7. Confirm it worked

- Disconnect RDP entirely (just close the client — don't log off).
- Call `get_desktop_state` (through testinator-tooling, or `cua-driver call get_desktop_state`
  if you have another way in). It should keep working — no black screen, no invalid-handle
  error.

## Important: you have to repeat step 6 every time

This is **not a permanent, one-time fix**. Confirmed live: reconnecting via RDP later, then
disconnecting again, breaks `cua-driver` again — you have to redo step 6 (find the new
session ID with `query session`, run `tscon <id> /dest:console` again) every single time after
reconnecting via RDP. There is no known way yet to make this automatic — an idea was discussed
(a Scheduled Task that runs the migration automatically the moment RDP disconnects, keyed off
Windows Event ID 24 in the `TerminalServices-LocalSessionManager` log) but was **not built or
tested**, so treat it as a lead for next time, not something that exists.

Practical implication: **whenever you've RDP'd into this machine for any reason** (checking
something, doing more setup), remember to redo steps 6–7 before relying on `cua-driver` again.

## Setting up TightVNC (optional — only if you want a human-visible screen)

None of the above needs a VNC server at all — `cua-driver` works fine without one. This is
only for when *you* also want to watch the screen (e.g. via `testinator-workflow`'s optional
`vnc_url` field). Two things confirmed the hard way:

**Don't install TightVNC as a Windows service** (skip the `SERVER_REGISTER_AS_SERVICE=1`
installer flag if you've seen it in other docs). On Windows Server 2022 this hits a real,
known upstream bug — `WTSQueryUserToken` fails with `ERROR_NO_TOKEN` — that shows a solid
black VNC screen even though the service is running. Instead, install TightVNC normally, then
register it to run as an ordinary process via a Scheduled Task:

```powershell
.\scripts\windows\install-tvnserver-task.ps1
```

(from a `testinator-connect` checkout — this script also removes any existing service
registration for you, since leaving both registered causes two `tvnserver` processes to fight
over port 5900.)

**Set the password through the app itself, not the old service config.** TightVNC keeps
completely separate settings for "service mode" (`HKEY_LOCAL_MACHINE\SOFTWARE\TightVNC\Server`)
and "application mode" (`HKEY_CURRENT_USER\Software\TightVNC\Server`) — a password set one way
does not exist for the other. Since the task above runs it in application mode, open
TightVNC's tray icon → config tool and set the password there specifically, even if you
already set one somewhere else before. If you get `Failed to authenticate... Server is not
configured properly`, this mismatch is almost certainly why.

## Known caveats

- **The Windows `\\?\` extended-length path prefix breaks recursive delete, not reads.**
  cua-driver reports its recording path with this prefix intact (e.g.
  `\\?\C:\Users\Public\testinator-recordings\...`). A plain file read tolerates it fine, but
  `fs.rm({recursive: true})` on the same prefixed path completed with **no error and deleted
  nothing** — confirmed live. testinator-connect strips the prefix before any local
  read/delete (`file-reader.ts`); if you're running an older build than that fix, cleanup
  will silently no-op even though everything else looks fine.
- **`get_recording_state`'s `video_active`/`owner` fields don't reflect the driver's real
  global state.** Each `call_tool` invocation opens a fresh MCP connection to cua_driver on
  this platform, and a fresh connection always reports `"owner": null, "video_active":
  false` — even while a real recording, started on a different connection, is still
  running. `stop_recording` still genuinely stops it regardless. Don't gate "should I bother
  stopping/storing" logic on this field on Windows; track it yourself instead (e.g. by
  session id).
- **`stop_recording`/`get_recording_state` never populate `last_video_path`** on this
  platform (always `null`), unlike macOS. The video's name and location has to be recovered
  from `start_recording`'s own success message/`output_dir` instead
  (`<output_dir>\recording.mp4` — confirmed as the fixed filename in the one live setup this
  is based on).
- **Recording appears to be per-turn, not continuous.** A recording left running for several
  seconds with no other tool calls in between came back as a single frame (~0.03–0.07s at
  15fps). What exactly counts as a "turn" that adds a frame is not established — read-only
  calls like `get_desktop_state` do not appear to count (confirmed: 4 such calls during one
  recording window still produced 1 frame). If you need a real multi-frame video, don't
  assume plain waiting/polling is enough.
- **No `scale_factor` mismatch.** Unlike macOS's 2x Retina backing scale (`get_desktop_state`
  returning a 2x pixel buffer against 1x-reported point dimensions — see `vm-opencua.md`'s
  toolbox grounding notes), the one live Windows setup reported `scale_factor: 1` with
  screenshot pixel dimensions exactly matching screen dimensions. Grounding math is simpler
  here, at least on that display configuration.
- **No `launch_app`/`navigate` overrides exist yet.** The macOS toolbox's versions of these
  hardcode macOS-only concepts (bundle ids, Cmd+L, a Netflix-tab workaround tied to macOS's
  `open`) that don't transfer to Windows without verification, so they were deliberately not
  ported. cua-driver's own native `launch_app` and browser tools are still exposed unwrapped
  — use those directly for now.
- **A `config.json` server entry and `files.roots` are still required** for tooling to reach
  this driver at all (recordings and the `install_ffmpeg` sidecar need `files.roots` set to an
  absolute Windows path such as `C:\Users\Public\testinator-recordings` — `~/...` does not
  resolve the way it does on macOS's Lume guest). The server name just needs to match
  `WindowsVmCuaMCPAdapter.SERVER_NAME` in testinator-tooling (currently `"cua_driver"`) — it's
  not an externally-mandated string.
