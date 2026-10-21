"""Local web server for the 3D rescue simulation (SIMULATION ONLY).

    py sim_server.py [--port 8765] [--no-browser]

Why a server? Browsers block ES-module imports (the bundled Three.js runtime)
from ``file://`` pages, so the page must be served over http. The server binds to
127.0.0.1 only, serves files from this repository, and also relays the live
simulation state (POST/GET ``/api/state``) so the MAVLink bridge can read it.
"""

from __future__ import annotations

import argparse
import json
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_PORT = 8765
MAX_STATE_BYTES = 16 * 1024
STATE_MAX_AGE_SECONDS = 3.0
BLOCKED_TOP_LEVEL = {".git", ".venv", "models", "tests", "inspection_reports"}  # never served


class SimState:
    """Thread-safe holder for the latest state posted by the 3D page."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict | None = None
        self._stamp = 0.0

    def set(self, state: dict) -> None:
        with self._lock:
            self._state, self._stamp = state, time.monotonic()

    def get(self) -> dict:
        with self._lock:
            if self._state is None:
                return {"connected": False, "state": None}
            age = time.monotonic() - self._stamp
            return {"connected": age <= STATE_MAX_AGE_SECONDS, "age_seconds": age, "state": self._state}


class Handler(SimpleHTTPRequestHandler):
    sim_state = SimState()

    def __init__(self, *args, sim_state: SimState, **kwargs):
        self.sim_state = sim_state
        super().__init__(*args, directory=str(PROJECT_DIR), **kwargs)

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path == "/api/state":
            self._json(self.sim_state.get())
        elif path.split("/")[1:2] and path.split("/")[1] in BLOCKED_TOP_LEVEL:
            self._json({"error": "not found"}, 404)
        else:
            super().do_GET()

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/api/state":
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_STATE_BYTES:
                raise ValueError("bad length")
            state = json.loads(self.rfile.read(length))
            if not isinstance(state, dict):
                raise ValueError("not an object")
        except (ValueError, json.JSONDecodeError):
            self._json({"error": "invalid state"}, 400)
            return
        self.sim_state.set(state)
        self._json({"ok": True})

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        if "/api/state" not in str(args[0] if args else ""):
            super().log_message(fmt, *args)


def make_server(port: int = DEFAULT_PORT, sim_state: SimState | None = None) -> ThreadingHTTPServer:
    handler = partial(Handler, sim_state=sim_state or SimState())
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the 3D rescue simulation locally")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--page", choices=("rescue_simulation.html", "live_operations.html"), default="rescue_simulation.html",
                        help="repository page to open (default: rescue_simulation.html)")
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError as exc:
        print(f"Cannot start on port {args.port}: {exc}")
        return 1
    url = f"http://127.0.0.1:{args.port}/{args.page}"
    print("SIMULATION ONLY - no real drone or hardware is controlled.")
    print(f"Serving {PROJECT_DIR} at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
