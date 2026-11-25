#!/usr/bin/env python3
"""Run Hornbill Express locally, e.g. on the booth laptop or to test on a phone/tablet on the same Wi-Fi.

Usage:  python tools/serve.py            -> serves the project folder on port 8000
        python tools/serve.py --dist     -> serves dist/ (run tools/build.py first)
        python tools/serve.py --port 9000
"""
import argparse
import functools
import http.server
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--dist", action="store_true")
    a = ap.parse_args()
    folder = ROOT / "dist" if a.dist else ROOT
    handler = functools.partial(NoCache, directory=str(folder))
    with http.server.ThreadingHTTPServer(("0.0.0.0", a.port), handler) as httpd:
        print(f"Hornbill Express is running:\n  this computer:  http://localhost:{a.port}/")
        for ip in lan_ips():
            print(f"  same Wi-Fi:     http://{ip}:{a.port}/   (TV screen: /display.html)")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
