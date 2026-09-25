# Driving a Windows VM with windows-mcp, over a persistent VNC console session

Sets up a cloud Windows Server VM so [windows-mcp](https://github.com/CursorTouch/Windows-MCP)
can drive it via UI Automation, reached over `testinator-connect` the same way any
MCP-server-under-test is. The non-obvious part isn't windows-mcp itself — it's keeping a real,
rendered, unlocked desktop present on a headless cloud VM, since windows-mcp's screenshot/UI-tree
calls only work against an actual interactive desktop, not Session 0 or a blank RDP-disconnected
console.

## 1. Host prerequisites

RDP admin access to an already-provisioned Windows Server 2022/2019 VM.

**Connect in admin/console mode, not a plain RDP login** —
`mstsc /admin /v:<VM_IP>` (older clients: `/console` instead of `/admin`). Confirmed live
(2026-09-25): an ordinary RDP session creates its own throwaway virtual session with its own
display driver, and Windows swaps that driver to a black placeholder the instant the RDP
client disconnects — this is true regardless of what's set up in step 2 below, since it's RDP
session behavior, not anything TightVNC controls. `/admin`/`/console` mode instead attaches
you to the real console session, so whatever you configure there (auto-login, the VNC task)
is the same session that keeps rendering after you disconnect. Set up everything below from
an admin-mode session, or it'll look broken even when it isn't.

## 2. Install a console-attached VNC server

From an elevated PowerShell inside the RDP session:

```powershell
Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.85/tightvnc-2.8.85-gpl-setup-64bit.msi" -OutFile "$env:TEMP\tightvnc.msi"
Start-Process msiexec.exe -Wait -ArgumentList "/i `"$env:TEMP\tightvnc.msi`" /quiet ADDLOCAL=Server SERVER_ADD_FIREWALL_EXCEPTION=1 SET_USEVNCAUTHENTICATION=1 VALUE_OF_USEVNCAUTHENTICATION=1 SET_PASSWORD=1 VALUE_OF_PASSWORD=<strong-password>"
```

Note **no `SERVER_REGISTER_AS_SERVICE=1`** — earlier versions of this doc installed TightVNC
as a Windows service on the (reasonable-sounding, but wrong) assumption that the service binds
to the active console session the way the desktop itself does. Confirmed live instead: on
Windows Server 2022, TightVNC as a service hits a known upstream bug
([sourceforge.net/p/vnc-tight/bugs/1579](https://sourceforge.net/p/vnc-tight/bugs/1579/)) —
`WTSQueryUserToken` fails with `ERROR_NO_TOKEN` (1008), and the VNC session shows solid
black. A service runs in Session-0 isolation and has to explicitly query the console user's
token to attach to it; that query fails for tvnserver specifically on Server 2022.

Instead, run `tvnserver.exe -run` as an ordinary process in the interactive console session —
the same "At logon, Interactive logon type" Scheduled Task pattern step 7 below uses for
testinator-connect itself, which sidesteps Session-0 isolation entirely rather than fighting
it. Register it with:

```powershell
.\scripts\windows\install-tvnserver-task.ps1
```

(Run from a `testinator-connect` checkout — see step 4 for getting the repo onto the VM if
you haven't yet. The script also removes any existing service registration for you; leaving
both a service and this task registered recreates a real observed failure mode, two
`tvnserver` processes fighting over port 5900.)

This IS what actually gives the "closing your VNC viewer doesn't stop the desktop from
rendering" property the service approach was meant to provide — it's the *interactive console
session* that keeps rendering regardless of client connects/disconnects, not the specific
mechanism (service vs. scheduled task) that launches tvnserver into it. RDP's own session is
the exception (see step 1): its display driver deliberately stops rendering on disconnect,
which is why setup must happen in admin/console mode.

Restrict port 5900 to your own IP/VPN in the cloud provider's security group/NSG — raw VNC auth is
weak, don't expose it broadly.

## 3. Auto-login + disable lock/sleep

Without this, VNC just shows the Windows lock screen forever, and windows-mcp can't drive anything
behind it.

```powershell
$key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty $key AutoAdminLogon -Value "1"
Set-ItemProperty $key DefaultUserName -Value "<username>"
Set-ItemProperty $key DefaultPassword -Value "<password>"

powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
```

Reboot once, then confirm over **VNC, not RDP** that it lands on an unlocked desktop by itself —
RDP disconnect/reconnect behaves differently from the console and can mask a failure here.

## 4. Get testinator-connect and windows-mcp onto the VM

```powershell
git clone <testinator-connect-repo-url> C:\tools\testinator-connect
cd C:\tools\testinator-connect
npm install
npm run build

git clone https://github.com/CursorTouch/Windows-MCP.git C:\tools\Windows-MCP
```

Clone windows-mcp from source rather than relying on `uvx windows-mcp serve` from PyPI — there's
an open, unresolved upstream bug where that path silently fails to connect on Windows
([CursorTouch/Windows-MCP#85](https://github.com/CursorTouch/Windows-MCP/issues/85)).

## 5. Write config.json

At `C:\tools\testinator-connect\config.json`. The server entry name **must be exactly**
`"windows_mcp"` — that's the literal string `WindowsAppSetupInstruction#driver` builds
`server_names: [driver]` from in testinator-workflow, and tooling filters on that exact name.

```json
{
  "deployment_url": "https://<your-tooling-instance>",
  "auth_token": "<token>",
  "installation_id": "<pinned-id-if-preapproved>",
  "servers": {
    "windows_mcp": {
      "type": "stdio",
      "command": "uv",
      "args": ["--directory", "C:\\tools\\Windows-MCP", "run", "windows-mcp", "serve"],
      "stateful": true
    }
  }
}
```

Validate it's actually valid JSON before moving on — a syntax error here surfaces as a misleading
"no config found", not a parse error:

```powershell
Get-Content config.json -Raw | ConvertFrom-Json
```

`installation_id` is optional: it pins the machine's `connect_app_id` instead of letting one be
generated on first run, for scripted provisioning where the id must match a pre-approval in
workflow's admin panel. Omit it to let one auto-generate as usual.

`auth_token` lives in this same file — treat it as a secret (restrictive file ACLs, never checked
into a repo or baked into a shared VM image template).

## 6. Test the CLI once, manually, over VNC

```powershell
cd C:\tools\testinator-connect
npm run cli -- --config .\config.json
```

If that reports "No config found" despite `config.json` clearly existing and being valid, npm on
this machine is silently dropping the literal `--config` token during argv forwarding (a real
observed Windows npm quirk, not a typo on your end) — use the environment-variable form instead,
which bypasses npm's argv handling entirely:

```powershell
$env:CONNECT_CONFIG_PATH = ".\config.json"
npm run cli
```

Do this from the VNC session, not RDP — the interactive desktop windows-mcp needs must actually be
the one visible. Confirm it logs `Connected to Agentic QA tooling` and discovers `windows_mcp`'s
tools (`Click`, `Move`, `Shortcut`, `Wait`, `DisplayInventory`, ...). First run can take a minute
or two while `uv` provisions windows-mcp's own dependencies — if it looks like it hung, restart it
once (windows-mcp's own README calls this out as expected). Ctrl+C to stop once confirmed.

## 7. Register autostart

Still elevated:

```powershell
.\scripts\windows\install-autostart-task.ps1
```

Registers a Scheduled Task (`TestinatorConnectCLI`) with an **At-logon trigger + Interactive logon
type** — deliberately not "run whether or not user is logged on." That alternative executes in a
non-interactive Session 0 with no desktop, which is exactly the isolation that breaks windows-mcp's
UI Automation, since `testinator-connect` spawns it as a stdio child and inherits whatever session
`testinator-connect` itself runs in. This task only ever has a desktop to inherit because of steps
2–3 above.

Also disables the default 3-day `ExecutionTimeLimit` — Task Scheduler silently kills long-running
tasks at that mark otherwise, with nothing in the logs to explain the disconnect.

```powershell
Start-ScheduledTask -TaskName TestinatorConnectCLI   # start now, or just log off/on
```

`start-connect.ps1` (what the task runs) is a restart loop around `npm run cli`, not a bare
invocation — Task Scheduler only restarts the *task*, not a process that exits inside it. Logs land
in `logs\wrapper.log` (the loop) and `logs\connect-<timestamp>.log` (per attempt), both under the
repo root.

To stop it cleanly (before a config change or `git pull`):

```powershell
.\scripts\windows\stop-connect.ps1
```

This kills the full process tree (`cmd.exe -> npm -> node -> electron`) — killing only the
wrapper's own PID would leave the actual connect process running underneath it.

## 8. Pair the machine with workflow

In `testinator-workflow` → **Admin → Settings → Agentic QA Connect** tab: use Quick Connect, or
copy the live session's `connect_app_id` and approve it manually. Either way you get back a
handshake token — paste it into `config.json`'s `auth_token`, then restart the task
(`stop-connect.ps1`, then `Start-ScheduledTask -TaskName TestinatorConnectCLI`).

## 9. Set up the check

Create a `desktop_app_windows` test session in workflow: pick the paired connect client session
(must show connected), `driver: windows_mcp`, and the Start-Menu app name to launch as
`app_target`.

## Known caveats to check once live

- **PATH at logon** — the Scheduled Task runs in the auto-login user's logon environment, not an
  interactive shell's. If Node/npm were installed via something that only updates PATH for
  interactive shells, confirm it's actually visible at logon, not just inside a terminal you opened
  by hand.
- **UIPI / elevation mismatch** — if the app under test runs elevated, a non-elevated automation
  driver can't click into it (User Interface Privilege Isolation blocks cross-elevation input). The
  task installer defaults to `-RunLevel Limited`; if clicks are silently ignored against a specific
  app, bump it to `-RunLevel Highest` in `install-autostart-task.ps1` and re-register.
