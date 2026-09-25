# Driving a Windows VM with cua-driver, instead of windows-mcp

Sets up [OpenCUA's `cua-driver`](https://github.com/trycua/cua) on a Windows machine — the
same driver [`vm-opencua.md`](./vm-opencua.md) uses on macOS, here reached natively instead
of over SSH into a separate guest, since testinator-connect runs directly on the Windows box
itself. Use this instead of [`vm-windows-mcp.md`](./vm-windows-mcp.md) when you want cua-driver's
tool vocabulary (`click`, `get_desktop_state`, `launch_app`, ...) on Windows rather than
windows-mcp's (`Click`, `Screenshot`, `Snapshot`, ...) — they are two independent integrations
for the same OS, picked per machine by which server its `config.json` advertises.

Everything in [`vm-windows-mcp.md`](./vm-windows-mcp.md) about **getting a real, unlocked,
console-attached desktop onto a headless cloud VM** (TightVNC install, auto-login + disabled
lock/sleep, the Scheduled Task autostart pattern, UIPI/elevation caveats) applies identically
here — cua-driver needs a live interactive desktop exactly as much as windows-mcp does, for
the same reason (it drives the screen with real OS input, not a debugger). This doc only
covers what's different: installing cua-driver instead of windows-mcp, and the config/recording
specifics that follow from it. Do those steps first, then come back here for steps 4+.

Everything below reflects one live setup (`gcp-windows-test-copy`, verified 2026-09-25) —
treat anything not explicitly confirmed here as unverified on Windows, the same caution
[`vm-opencua.md`](./vm-opencua.md) and this integration's own toolbox package
(`testinator-tooling/src/testinator_tooling/toolboxes/windows_vm_cua/__init__.py`) call out.

## 1–3. Shared Windows VM setup

Follow [`vm-windows-mcp.md`](./vm-windows-mcp.md) steps 1–3 (cloud VM + RDP admin access,
TightVNC console-attached server, auto-login and disabled lock/sleep) unchanged. Confirm over
VNC (not RDP) that it lands on an unlocked desktop by itself before continuing.

## 4. Install cua-driver

From an elevated PowerShell, over the VNC session (not RDP — same reasoning as
`vm-windows-mcp.md`: whatever session installs/launches the driver is the session it inherits
when testinator-connect later spawns it):

```powershell
irm https://cua.ai/driver/install.ps1 | iex
```

Confirm it installed and can reach the desktop:

```powershell
cua-driver doctor
cua-driver list-tools
cua-driver call get_desktop_state
```

Unlike macOS, nothing here hit an explicit TCC-style permission prompt in the one live setup
this doc is based on — `check_permissions` reported UI Automation already available with no
grant step needed (`"uia": true, "elevated": false`). If a future Windows build gates input
differently, that would show up as `check_permissions` reporting `"uia": false` or clicks
silently landing nowhere.

## 5. Get testinator-connect onto the machine

Same as `vm-windows-mcp.md` step 4 — clone and build testinator-connect itself:

```powershell
git clone <testinator-connect-repo-url> C:\tools\testinator-connect
cd C:\tools\testinator-connect
npm install
npm run build
```

**Rebuilding after every `git pull`:** `npm run build` only recompiles the main/preload/renderer
bundles under `out/`; it does not restart a running process. After pulling new commits, fully
quit and relaunch testinator-connect (or re-run the CLI/task) rather than just reconnecting —
this is Electron main-process code, so an in-memory process keeps running whatever build it
already loaded.

## 6. Write config.json

The server entry name is **not** an externally-mandated string the way windows-mcp's literal
`"windows_mcp"` is — it just has to match `WindowsVmCuaMCPAdapter.SERVER_NAME` in
testinator-tooling (`src/testinator_tooling/adapters/windows_vm_cua.py`), currently
`"cua_driver"`. A mismatch surfaces as an empty tool list on the tooling side, not a
config-parse error.

```json
{
  "deployment_url": "https://<your-tooling-instance>",
  "auth_token": "<token>",
  "servers": {
    "cua_driver": {
      "type": "stdio",
      "command": "cua-driver",
      "args": ["mcp"],
      "stateful": true,
      "files": {
        "roots": [
          "C:\\Users\\Public\\testinator-recordings"
        ]
      }
    }
  }
}
```

`files.roots` is required for **both** screen recordings and cua-driver's `install_ffmpeg`
sidecar work — without it, every file read (copying a finished recording off the machine) and
delete (the cleanup step after storing it) is refused with `protected_resource_scope_invalid:
the home directory is unavailable`, even for a call that otherwise succeeds
(`start_recording` itself doesn't hit this the same way `stop_recording`'s read does, so an
apparently-successful start can still leave you unable to retrieve the video). The path above
matches `RECORDINGS_DIR` in
`testinator-tooling/src/testinator_tooling/toolboxes/windows_vm_cua/_recording.py` — if you
use a different directory, update that constant to match, not the other way around. `~/...`
does **not** resolve on Windows the way it does for macOS's Lume guest — use an absolute
path; `C:\Users\Public\...` is writable by any local user without elevation on a standard
install.

Restart testinator-connect after any config.json change — same as macOS/windows-mcp, server
config is read at connect time.

## 7. ffmpeg (needed for recordings)

cua-driver shells out to `ffmpeg` to encode a recorded video; without it on `PATH`,
`start_recording` reports it started but a `Video capture failed` warning follows and no
video ever appears.

```powershell
winget install Gyan.FFmpeg
```

Or, without touching the machine directly, cua-driver exposes its own `install_ffmpeg` tool
(call once to preview, again with `confirm: true` to actually install) — useful for driving
the install through tooling instead of an RDP/VNC session.

## 8. Pair the machine with workflow

Same as `vm-windows-mcp.md` step 8 — Admin → Settings → Agentic QA Connect, Quick Connect or
manual `connect_app_id` approval, paste the resulting handshake token into `config.json`'s
`auth_token`, restart.

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
