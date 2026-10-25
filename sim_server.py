"""Local web server for the 3D rescue simulation (SIMULATION ONLY).

    py sim_server.py [--port 8765] [--no-browser]

Why a server? Browsers block ES-module imports (the bundled Three.js runtime)
from ``file://`` pages, so the page must be served over http. The server binds to
127.0.0.1 only, serves files from this repository, and also relays the live
simulation state (POST/GET ``/api/state``) so the MAVLink bridge can read it.
An optional SITL adapter can publish autopilot telemetry at ``/api/autopilot``;
the Cesium page reads that endpoint when "Follow SITL telemetry" is selected.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

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
    autopilot_state = SimState()

    def __init__(self, *args, sim_state: SimState, autopilot_state: SimState,
                 odm_root: Path | None = None, **kwargs):
        self.sim_state = sim_state
        self.autopilot_state = autopilot_state
        self.odm_root = odm_root.resolve() if odm_root else None
        super().__init__(*args, directory=str(PROJECT_DIR), **kwargs)

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def copyfile(self, source, outputfile) -> None:
        """Ignore clients closing early (common in browser/tests probing assets)."""
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def _serve_odm_file(self, request_path: str) -> None:
        if self.odm_root is None:
            self._json({"error": "ODM root is not configured"}, 404)
            return
        relative = Path(unquote(request_path.removeprefix("/odm-data/")))
        target = (self.odm_root / relative).resolve()
        if not target.is_relative_to(self.odm_root) or not target.is_file():
            self._json({"error": "not found"}, 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        stat = target.stat()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        with target.open("rb") as source:
            self.copyfile(source, self.wfile)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/state":
            self._json(self.sim_state.get())
        elif path == "/api/autopilot":
            self._json(self.autopilot_state.get())
        elif path.startswith("/odm-data/"):
            self._serve_odm_file(path)
        elif path.split("/")[1:2] and path.split("/")[1] in BLOCKED_TOP_LEVEL:
            self._json({"error": "not found"}, 404)
        else:
            super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        stores = {"/api/state": self.sim_state, "/api/autopilot": self.autopilot_state}
        if path not in stores:
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
        stores[path].set(state)
        self._json({"ok": True})

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        if not any(path in str(args[0] if args else "") for path in ("/api/state", "/api/autopilot")):
            super().log_message(fmt, *args)


def make_server(port: int = DEFAULT_PORT, sim_state: SimState | None = None,
                autopilot_state: SimState | None = None,
                odm_root: Path | None = None) -> ThreadingHTTPServer:
    handler = partial(Handler, sim_state=sim_state or SimState(),
                      autopilot_state=autopilot_state or SimState(), odm_root=odm_root)
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the 3D rescue simulation locally")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--page", choices=("rescue_simulation.html", "live_operations.html", "earth_rescue.html"), default="rescue_simulation.html",
                        help="repository page to open (default: rescue_simulation.html)")
    parser.add_argument("--odm-root", type=Path,
                        help="external folder exposed read-only at /odm-data/ for ODM visualization")
    args = parser.parse_args()
    try:
        server = make_server(args.port, odm_root=args.odm_root)
    except OSError as exc:
        print(f"Cannot start on port {args.port}: {exc}")
        return 1
    url = f"http://127.0.0.1:{args.port}/{args.page}"
    print("SIMULATION ONLY - no real drone or hardware is controlled.")
    if args.odm_root:
        print(f"ODM data: {args.odm_root.resolve()} -> /odm-data/")
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
