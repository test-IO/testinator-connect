#!/usr/bin/env python3
"""SOCKS5 proxy whose outbound sockets are pinned to the physical uplink via
IP_BOUND_IF, so traffic bypasses GlobalProtect. Needs no root.

  python3 vm_socks.py --iface en0 --dns 192.168.2.1 --listen 192.168.64.1:1080
"""
import argparse, os, random, select, socket, struct, sys, threading, traceback

IP_BOUND_IF = 25  # <netinet/in.h>


def bind_iface(sock, idx):
    sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, struct.pack("I", idx))


def resolve(host, dns_ip, idx, timeout=5.0):
    """Minimal DNS A lookup sent from the pinned interface, so CDN geo-steering
    matches the residential path instead of the VPN's."""
    try:
        return socket.inet_ntoa(socket.inet_aton(host))  # already an IP
    except OSError:
        pass
    qid = random.randrange(0, 0xFFFF)
    q = struct.pack("!HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    for label in host.rstrip(".").split("."):
        q += bytes([len(label)]) + label.encode("idna")
    q += b"\x00" + struct.pack("!HH", 1, 1)  # A, IN

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        bind_iface(s, idx)
        s.settimeout(timeout)
        s.sendto(q, (dns_ip, 53))
        while True:
            data, _ = s.recvfrom(4096)
            if len(data) >= 12 and struct.unpack("!H", data[:2])[0] == qid:
                break
    finally:
        s.close()

    ancount = struct.unpack("!H", data[6:8])[0]
    # skip question section
    off = 12
    while data[off] != 0:
        off += data[off] + 1 if data[off] < 0xC0 else 2
        if data[off - 1] >= 0xC0 if off >= 1 else False:
            break
    off += 5
    for _ in range(ancount):
        while off < len(data):
            ln = data[off]
            if ln == 0:
                off += 1
                break
            if ln >= 0xC0:
                off += 2
                break
            off += ln + 1
        rtype, _cls, _ttl, rdlen = struct.unpack("!HHIH", data[off:off + 10])
        off += 10
        if rtype == 1 and rdlen == 4:
            return socket.inet_ntoa(data[off:off + 4])
        off += rdlen
    raise OSError(f"no A record for {host}")


def pipe(a, b):
    socks = [a, b]
    try:
        while True:
            r, _, x = select.select(socks, [], socks, 300)
            if x or not r:
                break
            for s in r:
                buf = s.recv(65536)
                if not buf:
                    return
                (b if s is a else a).sendall(buf)
    except OSError:
        pass


def handle(conn, dns_ip, idx):
    remote = None
    try:
        conn.settimeout(20)
        # greeting
        ver, nm = struct.unpack("!BB", conn.recv(2))
        if ver != 5:
            return
        conn.recv(nm)
        conn.sendall(b"\x05\x00")  # no auth

        hdr = conn.recv(4)
        if len(hdr) < 4:
            return
        _v, cmd, _rsv, atyp = struct.unpack("!BBBB", hdr)
        if atyp == 1:
            host = socket.inet_ntoa(conn.recv(4))
        elif atyp == 3:
            host = conn.recv(conn.recv(1)[0]).decode()
        else:
            conn.sendall(b"\x05\x08\x00\x01" + b"\x00" * 6)  # addr type unsupported
            return
        port = struct.unpack("!H", conn.recv(2))[0]

        if cmd != 1:  # CONNECT only
            conn.sendall(b"\x05\x07\x00\x01" + b"\x00" * 6)
            return

        try:
            ip = resolve(host, dns_ip, idx)
        except Exception as e:
            print(f"[dns fail] {host}: {e}", file=sys.stderr, flush=True)
            conn.sendall(b"\x05\x04\x00\x01" + b"\x00" * 6)  # host unreachable
            return

        remote = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        bind_iface(remote, idx)
        remote.settimeout(15)
        try:
            remote.connect((ip, port))
        except Exception as e:
            print(f"[connect fail] {host}({ip}):{port} {e}", file=sys.stderr, flush=True)
            conn.sendall(b"\x05\x05\x00\x01" + b"\x00" * 6)  # refused
            return

        bnd = remote.getsockname()
        conn.sendall(b"\x05\x00\x00\x01" + socket.inet_aton(bnd[0]) + struct.pack("!H", bnd[1]))
        conn.settimeout(None)
        remote.settimeout(None)
        pipe(conn, remote)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
    finally:
        for s in (conn, remote):
            if s:
                try: s.close()
                except OSError: pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iface", default="en0")
    ap.add_argument("--dns", default="192.168.2.1")
    ap.add_argument("--listen", default="192.168.64.1:1080")
    a = ap.parse_args()

    idx = socket.if_nametoindex(a.iface)
    host, port = a.listen.rsplit(":", 1)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, int(port)))
    srv.listen(128)
    print(f"socks5 on {host}:{port} -> out via {a.iface} (idx {idx}), dns {a.dns}", flush=True)

    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn, a.dns, idx), daemon=True).start()


if __name__ == "__main__":
    main()
