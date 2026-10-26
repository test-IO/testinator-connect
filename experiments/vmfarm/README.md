# vmfarm experiment (Windows VM)

These are prebuilt binaries for trying the VM farm daemon on a Windows VM. The source lives in `testinator-vm-daemon`, and `BUILD.txt` names the build it came from. The plan is in `testinator-dev/docs/vm-farm-plan.md`.

| File | What it is |
|---|---|
| `bin/vmfarmd.exe` | The daemon. It hosts cua-driver and serves `/health`, `/control` and `/mcp`. |
| `bin/vmfarm-relay.exe` | The relay. VMs open a tunnel to it, and tooling calls VMs through it. |
| `config/windows-cua.toml` | Daemon config, local API only (`127.0.0.1:7410`). |
| `config/windows-cua-local-relay.toml` | Daemon config that opens a tunnel to a relay on the same VM. |
| `config/windows-cua-remote-relay.toml` | Daemon config that opens a TLS tunnel to a relay elsewhere, for example your Mac through ngrok. |
| `config/relay-dev.toml` | Relay config with dev keys: daemon key `dev-daemon-key`, tenant token `dev-tenant-token`. |
| `install-service.ps1` | Installs, or updates, vmfarmd as a Windows Service that starts at boot. |
| `uninstall-service.ps1` | Removes the service. |
| `run.ps1` | Starts the daemon by hand in the current session, without the service. |
| `smoke.ps1` | Calls the daemon's local API: starts a session, calls `get_screen_size`, ends the session. |
| `relay-smoke.ps1` | The same check, but through the relay, the way tooling will call it. |
| `udp-probe.ps1` | Checks that outbound UDP works, which WebRTC will need. |

## Before you start

- **Automatic logon must be on** (AutoAdminLogon, as set up in `docs/vm-windows-cua.md`). cua-driver needs a logged-on desktop, and the service waits until one exists.
- **Stop Connect, and its autostart task,** so two cua-driver setups don't run at once:
  ```powershell
  .\scripts\windows\stop-connect.ps1
  Disable-ScheduledTask -TaskName TestinatorConnectCLI
  ```
- **cua-driver must be on the auto-logon user's `PATH`.**

## Run as a service (starts at boot)

**Pick the install folder with SentinelOne in mind.** The service runs `vmfarmd.exe` from `-InstallDir`, and that process starts `cua-driver` (and later ffmpeg). Today only `C:\Users\jiayi_zheng\Downloads\testinator-connect\testinator-connect-main` is excluded in SentinelOne, so install inside it.

From an elevated PowerShell:
```powershell
$dir = 'C:\Users\jiayi_zheng\Downloads\testinator-connect\testinator-connect-main\vmfarmd-service'
.\experiments\vmfarm\install-service.ps1 -InstallDir $dir                       # local API only
.\experiments\vmfarm\install-service.ps1 -InstallDir $dir -Config .\experiments\vmfarm\config\windows-cua-remote-relay.toml
```

What happens:
- `vmfarmd.exe` and the config are copied to `-InstallDir`, along with `relay-cert.pem` and `relay-key.txt` if they sit next to the config. The service runs that copy, so updating this folder never fights a running service.
- The `vmfarmd` service is registered to start at boot as LocalSystem, restart on failure, and it is started now.
- The service waits for the logged-on desktop session and starts `vmfarmd desktop` hidden inside it, as that user. It restarts it whenever it exits.
- After an RDP disconnect, the service moves the session back to the console itself, which replaces the manual `tscon`.
- Stopping the service ends `vmfarmd desktop` and every cua-driver it started.

Check it:
```powershell
Get-Service vmfarmd
Get-Process vmfarmd                     # two processes: the service and the desktop process
.\experiments\vmfarm\smoke.ps1
Get-Content "$dir\logs\vmfarmd-service.*" -Tail 20
```

Then reboot the VM and check again without logging in. `smoke.ps1` should work as soon as automatic logon has finished.

If SentinelOne blocks or kills something, check its console for the process path. Is it `vmfarmd.exe`, `cua-driver.exe`, or the service starting a process in the user session? That tells us what the exclusion has to cover.

To update, run `install-service.ps1` again with the same `-InstallDir`. To change the config, edit `vmfarmd.toml` in `-InstallDir`, then run `Restart-Service vmfarmd`.

**Note for later:** a service running as LocalSystem from a folder the user can write to is acceptable on a test VM. For the farm, the binary belongs in an admin-only folder such as `C:\Program Files\VmFarmDaemon`, signed, with the SentinelOne exclusion based on the signature or hash.

## Relay on your Mac, through ngrok

On the Mac, in `testinator-vm-daemon`, follow the comment at the top of `config/relay-tls.toml`. It makes a certificate and a daemon key, and you paste the key's hash into that file. Then run each of these in its own terminal:
```bash
cargo run -p vmfarm-relay -- serve --config config/relay-tls.toml
ngrok tcp 7443                     # note the "Forwarding tcp://<host>:<port>" line
```

On the VM:
1. Copy `tmp/relay/relay-cert.pem` and `tmp/relay/relay-key.txt` from the Mac into `experiments\vmfarm\config\`. Both are git-ignored there.
2. Set `address` in `config\windows-cua-remote-relay.toml` to ngrok's `<host>:<port>`.
3. Install the service with `-Config ...\windows-cua-remote-relay.toml`, as shown above.

Then, on the Mac:
```bash
curl -s localhost:7420/vms -H 'Authorization: Bearer dev-tenant-token'      # windows-test-copy: "online": true
curl -s localhost:7420/vms/windows-test-copy/control -H 'Authorization: Bearer dev-tenant-token' \
  -H 'content-type: application/json' -d '{"op":"call_tool","name":"get_screen_size"}'
```

MCP clients use `http://localhost:7420/vms/windows-test-copy/mcp` with that token. The free ngrok plan gives a new address on each start; update `address` on the VM and run `Restart-Service vmfarmd`.

## Run by hand (no service)

```powershell
.\experiments\vmfarm\run.ps1        # window 1, in the RDP desktop session; keep it open
.\experiments\vmfarm\smoke.ps1      # window 2
```

Don't run this while the service is installed. Both would use port 7410.

## Through a relay on the same VM

```powershell
# window 1
.\experiments\vmfarm\bin\vmfarm-relay.exe serve --config .\experiments\vmfarm\config\relay-dev.toml
# window 2: the daemon, either the service installed with -Config ...\windows-cua-local-relay.toml, or by hand:
cd .\experiments\vmfarm; .\bin\vmfarmd.exe desktop --config .\config\windows-cua-local-relay.toml
# window 3
.\experiments\vmfarm\relay-smoke.ps1
```

**What a good run looks like:**
- The VM shows as online.
- `session_start` lists cua-driver's tools.
- `get_screen_size` returns the display size and the round-trip time.
- No `cua-driver` process is left after the session ends.

**Logs** are written to a `logs\` folder next to the config in use:
- with the service: `<InstallDir>\logs\`;
- by hand: `experiments\vmfarm\config\logs\`.
