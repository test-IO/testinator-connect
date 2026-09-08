# Keeping the VM off the corporate VPN

Gives the macOS VM its own internet egress on the host's physical network connection,
bypassing a full-tunnel corporate VPN (e.g. GlobalProtect) on the host. Needed when the VM's
traffic must appear to come from the host's real network location rather than the VPN's —
for DNS resolution, geo-restricted content, or anything that behaves differently for a
datacenter/VPN egress than for a normal residential or office one.

## Why this is needed

A full-tunnel VPN on the host routes every packet — including the VM's, since lume's `nat`
networking goes through the host — out through the corporate gateway. Two symptoms follow:

* **No internet in the VM**, because UDP/53 to public DNS resolvers is typically blocked by
  corporate policy, so the guest's resolvers time out even though TCP still works over the
  tunnel.
* **Anything that behaves differently for a VPN/datacenter IP** does so for the VM too, since
  its egress is the same address as the host's tunneled traffic.

This sets the VM up with its own egress on the host's physical uplink instead, while leaving
the host itself on the VPN throughout.

## What does not work

**Bridged networking** (`lume run --network bridged:en0`) needs the
`com.apple.vm.networking` entitlement. A Homebrew-installed `lume` binary is ad-hoc signed
without it, and even with it, a Wi-Fi interface cannot be bridged by Virtualization.framework.

**`pf route-to`.** Do not use `sudo pfctl -f /etc/pf.conf` or `sudo pfctl -d` on a Mac running
a VM with `nat` networking — both flush or disable the runtime pf anchors that *implement*
that NAT, killing the VM's internet outright. `/etc/pf.conf` warns about this in its own
header. Re-enable pf with `sudo pfctl -E` if this happens.

## The constraint that shapes the design

On a Mac running GlobalProtect and/or an EDR agent (e.g. SentinelOne), inbound TCP to the
host's non-loopback addresses can be silently dropped — `accept()` returns, then the first
`recv()` fails with `OSError: [Errno 57] Socket is not connected`. Check for this before
assuming the approach below is necessary:

```
127.0.0.1:PORT      -> OK
<bridge/vm-facing>  -> FAIL if affected
<LAN address>       -> FAIL if affected
```

If affected, the VM cannot connect to a listener on the host's bridge address, so the proxy
below binds to loopback and is reached over an SSH reverse forward instead.

## Architecture

```
  VM Chrome ──> 127.0.0.1:1080 (in guest)
                      │  ssh -R, host-initiated
                      ▼
                127.0.0.1:1080 (on host) ── vm_socks.py
                      │
                      │  outbound sockets pinned to the physical uplink via IP_BOUND_IF
                      ▼
                physical interface ──> real egress   (never the VPN's utun interface)
```

`IP_BOUND_IF` is the load-bearing trick: macOS keeps a per-interface scoped default route
(the `I` / `RTF_IFSCOPE` flag), so a socket pinned to the physical interface uses that
interface's own default route and bypasses the VPN tunnel entirely, e.g.:

```
default  <vpn-gateway>      UGScg    utun4
default  <physical-gateway> UGScIg   en0     <- scoped; what a pinned socket uses
```

`vm_socks.py` also resolves DNS itself, over UDP to the physical gateway from a
pinned socket — not just to work around blocked resolvers, but so DNS-based geo/CDN steering
agrees with the real egress rather than the VPN's.

## Setup

Needs no root on the host and no change to the VPN. Re-run after a host reboot, a VM
restart, or a VPN reconnect — or use the supervisor script below to automate that.

```bash
cd ~/work/testinator-connect/docs/vm-novpn

# 1. proxy on host loopback, egress pinned to the physical uplink
nohup /usr/bin/python3 vm_socks.py \
    --iface en0 --dns <physical-gateway-ip> --listen 127.0.0.1:1080 \
    > ~/Library/Logs/lume-vm-novpn.log 2>&1 &

# 2. expose it inside the guest as 127.0.0.1:1080
ssh -N -f -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
    -R 1080:127.0.0.1:1080 lume@192.168.64.2
```

Find `--iface`/`<physical-gateway-ip>` with:

```bash
netstat -rn -f inet | awk '$1=="default" && $NF!~/^utun/ {print $NF, $2; exit}'
```

Step 3 is once-per-VM — `networksetup` persists it inside the guest, so it survives VM
restarts and does not need repeating:

```bash
lume ssh automation-vm -- '
  echo lume | sudo -S networksetup -setsocksfirewallproxy Ethernet 127.0.0.1 1080
  echo lume | sudo -S networksetup -setsocksfirewallproxystate Ethernet on
  echo lume | sudo -S dscacheutil -flushcache
  echo lume | sudo -S killall -HUP mDNSResponder'
```

Chrome picks up the system SOCKS setting without a relaunch and does remote DNS through the
proxy, so the guest's own broken resolvers stop mattering.

**Do not** point `--dns` at a public resolver (e.g. `1.1.1.1`) — public resolvers are only
reachable *off* the tunnel, and the proxy's DNS socket is pinned to the physical interface,
so the physical gateway is both correct and faster.

## Verifying

```bash
lume ssh automation-vm -- 'curl -s --socks5-hostname 127.0.0.1:1080 https://ifconfig.me/ip'
# expect the physical uplink's address, NOT the VPN's
```

| check | expected when healthy |
|---|---|
| VM egress | the host's physical-uplink address (not the VPN's) |
| host egress | unchanged — still the VPN's, which is the point |
| `https://www.google.com/` from VM | `200` |

## Teardown

```bash
pkill -f vm_socks.py
pkill -f 'ssh .*-R 1080'
lume ssh automation-vm -- 'echo lume | sudo -S networksetup -setsocksfirewallproxystate Ethernet off'
```

Leaving the guest proxy enabled while the host side is down means the VM has no internet at
all, so turn it off in the guest if you stop the host side for a while.

## Day-to-day: a supervisor for reboots and restarts

[`lume-vm-novpn.sh`](./lume-vm-novpn.sh) automates the two host-side halves — it re-detects
the physical uplink on its own, so it also copes with changing networks. Install it once:

```bash
mkdir -p ~/.local/bin
cp ~/work/testinator-connect/docs/vm-novpn/{lume-vm-novpn.sh,vm_socks.py} ~/.local/bin/
chmod +x ~/.local/bin/lume-vm-novpn.sh
```

Edit the `VM_IP` (and, if the VM's name differs, the `lume ssh` line in
`warn_if_guest_proxy_off`) near the top of the script to match your VM before using it. Then:

```bash
~/.local/bin/lume-vm-novpn.sh once      # start whatever is down
~/.local/bin/lume-vm-novpn.sh status    # proxy/tunnel state + both egress IPs
~/.local/bin/lume-vm-novpn.sh stop      # tear the host side down
```

It never needs the guest password: the guest's `networksetup` proxy setting persists inside
the VM, so the script only maintains the two host-side halves and warns if the guest side
got switched off.

**What survives what:**

| event | proxy | ssh -R tunnel | guest proxy setting |
|---|---|---|---|
| VM restart | survives | dies | survives |
| host reboot | dies | dies | survives |
| VPN reconnect | survives | survives | survives |

So a VM restart needs only the tunnel restarted, and `once` handles either case.

### Optional: run the supervisor at login

Not installed by default — a `LaunchAgents` entry is a login-persistence mechanism, install
it deliberately if you want it. Save as `~/Library/LaunchAgents/com.local.lume-vm-novpn.plist`,
substituting your own home directory for `/Users/YOUR_USERNAME`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.local.lume-vm-novpn</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/YOUR_USERNAME/.local/bin/lume-vm-novpn.sh</string>
    <string>supervise</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/Users/YOUR_USERNAME/Library/Logs/lume-vm-novpn.log</string>
  <key>StandardErrorPath</key><string>/Users/YOUR_USERNAME/Library/Logs/lume-vm-novpn.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.lume-vm-novpn.plist
launchctl bootout   gui/$(id -u)/com.local.lume-vm-novpn      # to remove
tail -f ~/Library/Logs/lume-vm-novpn.log                      # what it is doing
```

In `supervise` mode it polls every 30s, so it picks the tunnel back up on its own within half
a minute of a VM restart.

The VM itself still has to be started by hand after a host reboot (`lume run automation-vm`) — it
is a plain foreground process, not a launchd service.
