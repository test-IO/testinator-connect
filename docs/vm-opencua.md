# Driving a real browser in a macOS VM with OpenCUA

Sets up a macOS VM with a real Chrome browser, driven by mouse and keyboard events at the
operating-system level via [OpenCUA's `cua-driver`](https://github.com/trycua/cua) — no
CDP, no Playwright, no debugger attached. Use this for pages that detect or block ordinary
browser automation.

## 1. Host prerequisites

Apple Silicon, ~60 GB free disk, and:

```sh
brew install lume sshpass
```

`sshpass` is needed for the guest's default password auth, before an SSH key is copied in
(step 4).

## 2. Create the VM

Use `lume create` with an Apple restore image (~16 GB), not `lume pull` — the prebuilt
images are 43–86 GB, and lume 0.5.1 skips their layers as unsupported media types anyway.

```sh
lume create automation-vm --ipsw latest --unattended tahoe \
  --cpu 4 --memory 8GB --disk-size 80GB --display 2560x1600
lume run automation-vm
lume ls           # ip, ssh, and the vnc:// URL with its password
```

Set the resolution you want before signing in to anything: changing it later
(`lume set automation-vm --display WxH`) needs a stop/start, and the restart re-runs Setup
Assistant and drops browser cookies.

Guest credentials are `lume` / `lume`. The VNC port and password change on every boot —
re-read them from `lume ls` after each start. The IP address is stable across restarts
(only re-check it if you recreate the VM).

## 3. Install real Chrome in the guest

Chromium will not do: it has no Widevine CDM. Install as the `lume` user, never as root —
`cp -pR` running as root preserves the DMG's build uid and leaves an app owned by a
nonexistent user.

```sh
V() { SSHPASS=lume sshpass -e ssh -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null lume@192.168.64.2 "$@"; }

V 'cd /tmp && curl -sL -o chrome.dmg \
   "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg" &&
   hdiutil attach -nobrowse -quiet -mountpoint /Volumes/gc chrome.dmg &&
   cp -R "/Volumes/gc/Google Chrome.app" /Applications/ &&
   hdiutil detach /Volumes/gc -quiet && rm -f chrome.dmg'

# confirm the CDM is present
V 'ls "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Libraries/" | grep -i widevine'
```

## 4. Install cua-driver and connect it to testinator-connect

`cua-driver` is a daemon that exposes an MCP server over stdio and drives the guest's
screen/mouse/keyboard from inside the VM.

**Copy an SSH key into the guest.** testinator-connect launches cua-driver over
`ssh ... -o BatchMode=yes`, which needs key-based auth already trusted — it will not fall
back to a password prompt.

```sh
ssh-copy-id -o StrictHostKeyChecking=no lume@192.168.64.2   # password: lume
```

**Install cua-driver as the `lume` user**, never as root — root-owned files under it are
unreadable to the unprivileged session that will run it:

```sh
V 'curl -fsSL https://cua.ai/driver/install.sh | bash'
```

This installs the binary to `/Users/lume/.local/bin/cua-driver`. Confirm it's healthy:

```sh
V '/Users/lume/.local/bin/cua-driver doctor'
```

**Grant Accessibility and Screen Recording, once, over VNC — not SSH.** macOS gates
OS-level screen/input control behind TCC prompts that only a GUI session can answer.
Connect to the `vnc://` URL `lume ls` reports (macOS Screen Sharing, or any VNC client),
then from a Terminal *inside* the VM's own screen:

```sh
cua-driver permissions grant
```

This launches CuaDriver via LaunchServices, walks through the Accessibility, Screen
Recording, and (on Tahoe) direct-capture consent dialogs, then verifies with a live
capture. Re-check the granted state anytime with `cua-driver permissions status --json`
(this one works fine over SSH).

**Wire it into testinator-connect.** Add a `MacOS_VM` server entry to testinator-connect's
`config.json` (`~/Library/Application Support/agentic-qa-connect/config.json` on macOS).
[`macos-vm.mcp-config.json`](./macos-vm.mcp-config.json) has the exact entry — merge it
into the `servers` object and replace `VM_IP_ADDRESS` with the IP `lume ls` reports for
your VM. Restart testinator-connect's service afterward; server config is read at connect
time.

To verify cua-driver itself is working, independent of testinator-connect's wiring:

```sh
cua-driver list-tools
cua-driver call get_desktop_state
```
