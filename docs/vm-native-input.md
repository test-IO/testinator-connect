# Driving a real browser in a macOS VM with native input

Setup for testing pages that refuse to work under ordinary browser automation. Nothing
here uses CDP, Playwright, or a debugger: a real Chrome runs inside a macOS VM and is
driven with operating-system mouse and keyboard events over VNC.

Built and verified against Netflix cloud games (`netflix.com/title/81677232`), which is
the case that motivated it.

## Read this first: the failure that cost the most time

Netflix refuses to start a game with `web-cg-5003` — *"Please close any additional game
sessions, then try again"* — when **the game is open in more than one tab**. The symptom
is not an error dialog; it is a "Ready to play! / Start game" screen that never advances,
which looks exactly like a broken automation environment.

Before blaming anything else, confirm exactly one tab has the game open. Several plausible
theories were chased and disproved on the way here — DRM, an attached debugger, bot
detection, and a fullscreen race — and none of them were the cause.

## 1. Host prerequisites

Apple Silicon, ~60 GB free disk, and:

```sh
brew install lume sshpass
python3 -m venv vncenv && ./vncenv/bin/pip install vncdotool
```

`vncdotool` is only for bootstrapping the VM by hand — first-boot setup, granting the TCC
prompts, signing in. Once cua-driver is installed and running inside the VM, everything
goes through it over SSH and VNC is no longer in the path.

## 2. Create the VM

Use `lume create` with an Apple restore image (~16 GB), not `lume pull` — the prebuilt
images are 43–86 GB, and lume 0.5.1 skips their layers as unsupported media types anyway.

```sh
lume create netflix-vm --ipsw latest --unattended tahoe \
  --cpu 4 --memory 8GB --disk-size 80GB --display 2560x1600
lume run netflix-vm
lume ls           # ip, ssh, and the vnc:// URL with its password
```

Change resolution later with `lume set netflix-vm --display WxH`; that needs a stop/start,
**and the restart re-runs Setup Assistant and drops browser cookies**, so set the
resolution you want before signing in to anything.

Guest credentials are `lume` / `lume`. The VNC port and password change on every boot —
re-read them from `lume ls` after each start.

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

## 4. Drive it over VNC

`lume` publishes the guest's screen over VNC, and macOS Screen Sharing injects input at
system level — so no Accessibility grant is needed inside the guest, and nothing has to be
installed there.

```sh
PORT=49190; PW='xray-palm-north-falcon'    # from `lume ls`, changes each boot
VD=./vncenv/bin/vncdotool
$VD -s "127.0.0.1::$PORT" -p "$PW" --timeout 30 capture screen.png
$VD -s "127.0.0.1::$PORT" -p "$PW" --timeout 30 move 1280 1334 click 1
```

### Four traps, all of which cost real time

**One invocation per gesture.** Every `vncdotool` run is a *new* VNC session and pointer
state does not survive between them. `move` in one run and `click` in the next sends the
click to a stale position. Always combine: `move X Y click 1`.

**`type` does not shift.** Typing `netflix_gifted_1@qa.team` yields
`netflix-gifted-12qa.team` — `_` becomes `-`, `@` becomes `2`. The `underscore` and `at`
keysyms produce nothing at all. What works is explicit shift:

```sh
$VD ... type netflix key shift-minus type gifted key shift-minus type 1 key shift-2 type qa.team
```

**No Command modifier and no clipboard paste.** `key super-v` types a literal `v`, and
`launchctl asuser … pbcopy` fails with *"Operation not permitted"*. Plain `pbcopy` over
SSH does set the clipboard, but there is no working way to paste it.

**Waits are `pause SECONDS`,** not `w:ms`. Wheel events (`click 4`/`click 5`) and `home`/
`pgdn` scrolling do not work either — navigate with `open -a "Google Chrome" URL` over SSH
instead of trying to scroll.

Also keep the Chrome window inside the display, or the page is clipped and unreachable:

```sh
V 'open -na "Google Chrome" --args --window-position=0,0 --window-size=2560,1520 \
   --no-first-run --no-default-browser-check "https://www.netflix.com/title/81677232"'
```

Avoid `--force-device-scale-factor` to fit more on screen; it rendered a blank window.

## 5. The working Netflix sequence

1. Open **one** tab at `netflix.com/title/81677232`
2. Pass the profile gate — click the viewing profile (an automated session otherwise sits
   on "Who's watching?" forever and no Play button exists)
3. Click **Resume game** in the title modal — *not* `netflix.com/play-game/<id>` directly.
   Navigating straight there carries no user activation, and Netflix falls back to the
   "Start game" screen
4. The game goes fullscreen on its own

Sign-in is a 4-digit code mailed to the account address, so it needs a human in the loop:
click Continue, fetch the code from the inbox, type it into the first box. Cookies survive
a graceful Chrome quit but not a VM restart.

## Coordinates

`screencapture`/VNC images come back at the guest's full resolution (2560×1600). If you
read coordinates off a scaled-down view, multiply back up. To verify a target before
committing to a click, `move` to it and capture — cheaper than debugging a miss.
