# vmfarmd experiment

`vmfarmd` is a headless Rust daemon that runs cua-driver on a farm VM. This folder lets us try it on a Windows VM before it gets its own repo. The plan is in `testinator-dev/docs/vm-farm-plan.md`.

So far it only hosts MCP servers and offers a local API on `127.0.0.1:7410`. Only the VM itself can reach that address, and it has no authentication. Screen frames, the live stream and recording are still to come.

## Try it on the Windows VM

1. RDP into the VM, then pull this branch.
2. Stop Connect, so that two cua-driver setups don't run at once:
   ```powershell
   .\scripts\windows\stop-connect.ps1
   ```
3. In the RDP desktop session, start the daemon. Keep this window open.
   ```powershell
   .\experiments\vmfarmd\run.ps1
   ```
   It has to run in the desktop session. Started over SSH or as a service, cua-driver can't see the screen.
4. In a second PowerShell window, run the smoke test:
   ```powershell
   .\experiments\vmfarmd\smoke.ps1
   ```

**What a good run looks like:**
- `session_start` lists cua-driver's tools next to `get_vm_info`.
- `get_screen_size` returns the display size.
- After `session_end`, no cua-driver process is left.

Logs are written to `experiments\vmfarmd\logs\`.

To try it with an MCP client, point the client at `http://localhost:7410/mcp`. The `vmfarmd-session-id` header picks a session; without it, the `default` session is used.

## Rebuild the exe (on macOS)

```bash
cargo xwin build --release --target x86_64-pc-windows-msvc
cp target/x86_64-pc-windows-msvc/release/vmfarmd.exe bin/
```

To run the daemon locally on macOS, with playwright-mcp in place of cua-driver:

```bash
cargo run -- desktop --config config/dev.toml
```
