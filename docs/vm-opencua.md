# Driving a real browser in a macOS VM with OpenCUA

Setup for testing pages that refuse to work under ordinary browser automation. Nothing
here uses CDP, Playwright, or a debugger: a real Chrome runs inside a macOS VM and is
driven with operating-system mouse and keyboard events, via [OpenCUA's `cua-driver`](https://github.com/trycua/cua).

Built and verified against a cloud-gaming site whose click-to-play flow would not start
under Playwright — the click landed and the page acknowledged it, but the game never
launched. Several plausible theories were chased and disproved along the way: DRM, an
attached debugger, bot detection, and a fullscreen race. None of them were the cause; the
input layer itself was the variable.

## 1. Host prerequisites

Apple Silicon, ~60 GB free disk, and:

```sh
brew install lume sshpass
```

`sshpass` is only needed for the guest's default password auth, before an SSH key is
copied in (step 4).

## 2. Create the VM

Use `lume create` with an Apple restore image (~16 GB), not `lume pull` — the prebuilt
images are 43–86 GB, and lume 0.5.1 skips their layers as unsupported media types anyway.

```sh
lume create automation-vm --ipsw latest --unattended tahoe \
  --cpu 4 --memory 8GB --disk-size 80GB --display 2560x1600
lume run automation-vm
lume ls           # ip, ssh, and the vnc:// URL with its password
```

Change resolution later with `lume set automation-vm --display WxH`; that needs a stop/start,
**and the restart re-runs Setup Assistant and drops browser cookies**, so set the
resolution you want before signing in to anything.

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

[cua-driver](https://github.com/trycua/cua) is OpenCUA's driver: a small daemon that
exposes an MCP server over stdio and drives the guest's screen/mouse/keyboard from
*inside* the VM.

**Copy your SSH key into the guest first.** testinator-connect launches cua-driver over
`ssh ... -o BatchMode=yes`, which refuses to fall back to a password prompt — it needs
key-based auth already trusted, or the MCP server will silently fail to start.

```sh
ssh-copy-id -o StrictHostKeyChecking=no lume@192.168.64.2   # password: lume
```

**Install cua-driver as the `lume` user** (matches what `doctor` below confirms — installing
as root leaves files an unprivileged session can't read):

```sh
V 'curl -fsSL https://cua.ai/driver/install.sh | bash'
```

This drops the binary at `/Users/lume/.local/bin/cua-driver`. Confirm it landed and is
healthy:

```sh
V '/Users/lume/.local/bin/cua-driver doctor'
```

**Grant Accessibility and Screen Recording once, over VNC — not SSH.** cua-driver drives the
screen at the OS level, which macOS gates behind TCC prompts that only a GUI session can
answer. Connect to the `vnc://` URL `lume ls` reports (macOS Screen Sharing, or any VNC
client), then from a Terminal *inside* the VM's own screen:

```sh
cua-driver permissions grant
```

This launches CuaDriver via LaunchServices so the prompts attribute to it correctly, walks
through Accessibility, Screen Recording, and (on Tahoe) the direct-capture consent dialog,
then verifies with a live capture. Running this over SSH does not work — there is no GUI
session for the dialogs to appear in. Re-check anytime with
`cua-driver permissions status --json` (this one is fine over SSH, once granted once).

**Wire it into testinator-connect.** Add the `MacOS_VM` server to testinator-connect's
`config.json` — either through the app if it exposes raw server config, or by editing the
file directly (`~/Library/Application Support/agentic-qa-connect/config.json` on macOS).
[`macos-vm.mcp-config.json`](./macos-vm.mcp-config.json) has the exact entry; merge it into
the `servers` object and replace `VM_IP_ADDRESS` with the IP `lume ls` reports for your VM.
Restart testinator-connect's service after editing — server config is read at connect time.

Verify end to end with cua-driver's own tools before touching testinator-connect:
`cua-driver list-tools` and `cua-driver call get_desktop_state` run the same code path
without SSH or MCP in front of them, so they isolate "is cua-driver working" from "is the
wiring into testinator-connect working."
