# vmfarm experiment (Windows VM)

These are prebuilt binaries for trying the VM farm daemon on a Windows VM. The source lives in `testinator-vm-daemon`, and `BUILD.txt` names the build it came from. The plan is in `testinator-dev/docs/vm-farm-plan.md`.

| File | What it is |
|---|---|
| `bin/vmfarmd.exe` | The daemon. It hosts cua-driver and serves `/health`, `/control` and `/mcp`. |
| `bin/vmfarm-relay.exe` | The relay. VMs open a tunnel to it, and tooling calls VMs through it. |
| `config/windows-cua.toml` | Daemon config, local API only (`127.0.0.1:7410`). |
| `config/windows-cua-local-relay.toml` | Daemon config that opens a tunnel to a relay on the same VM. |
| `config/windows-cua-remote-relay.toml` | Daemon config that opens a TLS tunnel to a relay elsewhere, for example your Mac through ngrok. |
| `config/relay-vm.toml` | Relay config for `start-vm-relay.ps1`: tenant API on `0.0.0.0:7420`, tunnel on `127.0.0.1:7443`. |
| `config/relay-dev.toml` | Relay config with dev keys: daemon key `dev-daemon-key`, tenant token `dev-tenant-token`. |
| `install-service.ps1` | Installs, or updates, vmfarmd as a Windows Service that starts at boot. |
| `uninstall-service.ps1` | Removes the service. |
| `diagnose.ps1` | Prints the service status, vmfarmd and cua-driver processes with their parents, the installed config, whether the relay is reachable, and the end of both logs. |
| `start-vm-relay.ps1` | Test setup: runs the relay on this VM and opens TCP 7420 for the EPAM VPN, so a Mac on the VPN can call the VM through the relay. |
| `cleanup-stray-install.ps1` | One-off: removes the service installed under `C:\User\...` by a typo, then reinstalls with the remote-relay config and runs `diagnose.ps1`. |
| `fetch-relay-files.ps1` | Writes `windows-cua-remote-relay.local.toml` (git-ignored) from the template and this VM's GCP metadata: certificate, key, relay address and `vm_id`. |
| `release-to-console.ps1` | Leaves RDP without locking the session: moves it to the console, then closes its own elevated window. Use it instead of closing the RDP window. |
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

**The install folder matters for SentinelOne.** The service runs `vmfarmd.exe` from `-InstallDir`, and that process starts `cua-driver` (and later ffmpeg). `-InstallDir` defaults to `vmfarmd-service` in the checkout root, which on the test VM is the SentinelOne-excluded `C:\Users\jiayi_zheng\Downloads\testinator-connect\testinator-connect-main`.

From an elevated PowerShell:
```powershell
.\experiments\vmfarm\install-service.ps1                       # local API only
.\experiments\vmfarm\install-service.ps1 -Config .\experiments\vmfarm\config\windows-cua-remote-relay.toml
```

What happens:
- `vmfarmd.exe` and the config are copied to `-InstallDir`, along with `relay-cert.pem` and `relay-key.txt` if they sit next to the config. The service runs that copy, so updating this folder never fights a running service.
- The `vmfarmd` service is registered to start at boot as LocalSystem, restart on failure, and it is started now.
- The service waits for the logged-on desktop session and starts `vmfarmd desktop` hidden inside it, as that user. It restarts it whenever it exits.
- **Leave RDP with `.\experiments\vmfarm\release-to-console.ps1`** (elevated) instead of closing the window. It moves your session to the console while you're still connected, so Windows never locks it.
  - If you just close the RDP window, Windows locks the session. The console then shows the sign-in screen, and cua-driver can't capture or drive it until someone signs in over RDP again.
  - The service still moves a disconnected session back to the console, but it can't undo the lock.
- `get_vm_info` and `/health` report `session_locked`. A failed cua-driver call while the session is locked says so in its result.
- `get_frame` (MCP tool) and `GET /frame` return the current screen from vmfarmd's own Windows Graphics Capture, without going through cua-driver.
  - Parameters: `format` (`png`, the default and lossless, or `jpeg`, which is smaller), `quality`, `max_width`, and `since_id` with `wait_ms` to wait for the screen to change.
  - An unchanged screen requested again with the same options is sent from a cache.
  - Capture starts on the first request and stops after 2 minutes without one.
- Stopping the service ends `vmfarmd desktop` and every cua-driver it started.

Check it:
```powershell
.\experiments\vmfarm\diagnose.ps1
.\experiments\vmfarm\smoke.ps1
```

Then reboot the VM and check again without logging in. `smoke.ps1` should work as soon as automatic logon has finished.

If SentinelOne blocks or kills something, check its console for the process path. Is it `vmfarmd.exe`, `cua-driver.exe`, or the service starting a process in the user session? That tells us what the exclusion has to cover.

To update, run `install-service.ps1` again with the same `-InstallDir`. To change the config, edit `vmfarmd.toml` in `-InstallDir`, then run `Restart-Service vmfarmd`.

**Note for later:** a service running as LocalSystem from a folder the user can write to is acceptable on a test VM. For the farm, the binary belongs in an admin-only folder such as `C:\Program Files\VmFarmDaemon`, signed, with the SentinelOne exclusion based on the signature or hash.

## Relay on this VM, called from a Mac on the EPAM VPN

The VM's GCP firewall allows all ports from the EPAM VPN addresses, so a Mac on the VPN can reach a relay running on the VM. From an elevated PowerShell:
```powershell
.\experiments\vmfarm\start-vm-relay.ps1
```
The script:
- opens TCP 7420 in the Windows firewall, for the VPN addresses only;
- reinstalls the service with `windows-cua-local-relay.toml`, which opens a tunnel to `127.0.0.1:7443`;
- runs the relay in that window;
- prints the URLs to call from the Mac.

Every step is tested except the tunnel crossing the internet; that needs a relay on a public server.

## Relay on your Mac, through ngrok

This doesn't work from the EPAM network: it blocks the ngrok agent's connection to ngrok (`ngrok diagnose` reports `ERR_NGROK_8001`).

On the Mac, in `testinator-vm-daemon`, follow the comment at the top of `config/relay-tls.toml`. It makes a certificate and a daemon key, and you paste the key's hash into that file. Then run each of these in its own terminal:
```bash
cargo run -p vmfarm-relay -- serve --config config/relay-tls.toml
ngrok tcp 7443                     # note the "Forwarding tcp://<host>:<port>" line
```

Then hand the files to the VM through its GCP metadata, so nothing has to be copied over RDP. On the Mac, with ngrok's `host:port`:
```bash
gcloud compute instances add-metadata windows-vmfarm --zone europe-west3-c --project hl2-epm-aita-t1iylu \
  --metadata-from-file vmfarm-relay-cert=tmp/relay/relay-cert.pem,vmfarm-relay-key=tmp/relay/relay-key.txt \
  --metadata vmfarm-relay-address=<host>:<port>
```

On the VM:
```powershell
.\experiments\vmfarm\fetch-relay-files.ps1      # writes the cert, the key and config\windows-cua-remote-relay.local.toml
```
Then install the service with `-Config .\experiments\vmfarm\config\windows-cua-remote-relay.local.toml`.

Afterwards, remove the key from the metadata again:
```bash
gcloud compute instances remove-metadata windows-vmfarm --zone europe-west3-c --project hl2-epm-aita-t1iylu \
  --keys vmfarm-relay-cert,vmfarm-relay-key,vmfarm-relay-address
```

Then, on the Mac:
```bash
curl -s localhost:7420/vms -H 'Authorization: Bearer dev-tenant-token'      # your VM: "online": true
curl -s localhost:7420/vms/windows-vmfarm/control -H 'Authorization: Bearer dev-tenant-token' \
  -H 'content-type: application/json' -d '{"op":"call_tool","name":"get_screen_size"}'
```

MCP clients use `http://localhost:7420/vms/windows-vmfarm/mcp` with that token. The free ngrok plan gives a new address on each start; update `address` on the VM and run `Restart-Service vmfarmd`.

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
