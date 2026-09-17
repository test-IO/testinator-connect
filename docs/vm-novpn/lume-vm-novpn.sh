#!/bin/bash
# Keeps a lume VM's traffic off the corporate VPN.
#
#   host  : SOCKS5 proxy on 127.0.0.1:1080, outbound sockets pinned to the physical
#           uplink via IP_BOUND_IF, so egress is the physical connection and never a
#           VPN tunnel interface.
#   link  : ssh -R into the VM, because inbound TCP to this Mac's non-loopback
#           addresses can be dropped (App Firewall / VPN client / EDR agent).
#   guest : system SOCKS proxy = 127.0.0.1:1080. Set once by hand; networksetup
#           persists it inside the VM, so this script never needs the guest password.
#
# Re-establishes both host-side halves after a host reboot, a VM restart, or a
# VPN reconnect. Docs: testinator-connect/docs/vm-novpn/README.md
#
# Edit VM_IP (and the VM name in warn_if_guest_proxy_off's hint) before using this.
set -uo pipefail

PROXY_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm_socks.py"
PORT=1080
VM_USER=lume
VM_IP=192.168.64.2  # from `lume ls` — stable across restarts, re-check after recreating the VM
PY=/usr/bin/python3
INTERVAL=30

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o LogLevel=ERROR -o ConnectTimeout=8)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

uplink()  { netstat -rn -f inet | awk '$1=="default" && $NF!~/^utun/ {print $NF; exit}'; }
gateway() { netstat -rn -f inet | awk '$1=="default" && $NF!~/^utun/ {print $2;  exit}'; }

proxy_alive()  { pgrep -f "vm_socks.py .*--listen 127.0.0.1:$PORT" >/dev/null 2>&1; }
tunnel_alive() { pgrep -f "ssh .*-R $PORT:127.0.0.1:$PORT" >/dev/null 2>&1; }
vm_up()        { ssh "${SSH_OPTS[@]}" "$VM_USER@$VM_IP" true 2>/dev/null; }

start_proxy() {
  local iface gw
  iface=$(uplink); gw=$(gateway)
  if [ -z "$iface" ] || [ -z "$gw" ]; then
    log "no non-VPN default route yet; waiting"
    return 1
  fi
  if [ ! -f "$PROXY_PY" ]; then
    log "ERROR: proxy not found at $PROXY_PY"
    return 1
  fi
  log "starting proxy (iface=$iface dns=$gw)"
  nohup "$PY" "$PROXY_PY" --iface "$iface" --dns "$gw" --listen "127.0.0.1:$PORT" \
    >> "$HOME/Library/Logs/lume-vm-novpn.proxy.log" 2>&1 &
  sleep 1
}

start_tunnel() {
  vm_up || { log "VM not reachable yet"; return 1; }
  log "starting ssh -R tunnel"
  ssh -N -f "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
      -R "$PORT:127.0.0.1:$PORT" "$VM_USER@$VM_IP" 2>/dev/null
}

warn_if_guest_proxy_off() {
  vm_up || return 0
  ssh "${SSH_OPTS[@]}" "$VM_USER@$VM_IP" \
    "networksetup -getsocksfirewallproxy Ethernet | grep -q 'Enabled: Yes'" 2>/dev/null && return 0
  log "WARNING: guest SOCKS proxy is off -- the VM will not use the bypass. Re-enable with:"
  log "  ssh $VM_USER@$VM_IP -- 'sudo networksetup -setsocksfirewallproxystate Ethernet on'"
}

case "${1:-supervise}" in
  once)
    proxy_alive  || start_proxy
    tunnel_alive || start_tunnel
    warn_if_guest_proxy_off
    ;;
  supervise)
    log "supervisor started (interval ${INTERVAL}s)"
    while true; do
      proxy_alive  || start_proxy
      tunnel_alive || { start_tunnel && warn_if_guest_proxy_off; }
      sleep "$INTERVAL"
    done
    ;;
  stop)
    pkill -f "vm_socks.py .*--listen 127.0.0.1:$PORT" && log "proxy stopped"
    pkill -f "ssh .*-R $PORT:127.0.0.1:$PORT"         && log "tunnel stopped"
    ;;
  status)
    proxy_alive  && echo "proxy : up" || echo "proxy : DOWN"
    tunnel_alive && echo "tunnel: up" || echo "tunnel: DOWN"
    echo -n "vm egress  : "
    ssh "${SSH_OPTS[@]}" "$VM_USER@$VM_IP" \
      "curl -s --max-time 10 --socks5-hostname 127.0.0.1:$PORT https://ifconfig.me/ip" 2>/dev/null \
      || echo -n "(vm unreachable)"
    echo
    echo -n "host egress: "; curl -s --max-time 8 https://ifconfig.me/ip; echo
    ;;
  *)
    echo "usage: $0 once|supervise|stop|status"; exit 2 ;;
esac
