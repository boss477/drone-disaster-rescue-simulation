"""Mirror PX4/ArduPilot SITL telemetry into the local Cesium dashboard.

SIMULATION ONLY. This process only receives MAVLink and performs localhost HTTP
POSTs. It never sends arm, takeoff, landing, mission, servo, or motor commands.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = PROJECT_DIR / "mavlink_config.json"
ARMED_FLAG = 128


@dataclass
class TelemetryAccumulator:
    """Collect the newest fields from asynchronous MAVLink messages."""

    values: dict[str, Any] = field(default_factory=lambda: {
        "source": "sitl-mavlink",
        "simulation_only": True,
        "latitude_deg": None,
        "longitude_deg": None,
        "altitude_msl_m": None,
        "relative_altitude_m": None,
        "heading_deg": None,
        "roll_deg": None,
        "pitch_deg": None,
        "yaw_deg": None,
        "battery_percent": None,
        "gps_fix_type": None,
        "satellites_visible": None,
        "armed": False,
        "flight_mode": "UNKNOWN",
    })

    def update(self, message: Any, mode_name: Callable[[Any], str] | None = None) -> bool:
        kind = message.get_type()
        if kind == "GLOBAL_POSITION_INT":
            self.values.update(
                latitude_deg=message.lat / 1e7,
                longitude_deg=message.lon / 1e7,
                altitude_msl_m=message.alt / 1000.0,
                relative_altitude_m=message.relative_alt / 1000.0,
            )
            if getattr(message, "hdg", 65535) != 65535:
                self.values["heading_deg"] = message.hdg / 100.0
        elif kind == "ATTITUDE":
            radians_to_degrees = 180.0 / 3.141592653589793
            self.values.update(
                roll_deg=message.roll * radians_to_degrees,
                pitch_deg=message.pitch * radians_to_degrees,
                yaw_deg=message.yaw * radians_to_degrees,
            )
        elif kind == "SYS_STATUS":
            remaining = getattr(message, "battery_remaining", -1)
            if 0 <= remaining <= 100:
                self.values["battery_percent"] = int(remaining)
        elif kind == "GPS_RAW_INT":
            self.values.update(
                gps_fix_type=int(message.fix_type),
                satellites_visible=int(message.satellites_visible),
            )
        elif kind == "HEARTBEAT":
            self.values["armed"] = bool(int(message.base_mode) & ARMED_FLAG)
            if mode_name:
                self.values["flight_mode"] = mode_name(message)
        else:
            return False
        self.values["received_at"] = time.time()
        return True

    def ready(self) -> bool:
        return self.values["latitude_deg"] is not None and self.values["longitude_deg"] is not None

    def snapshot(self) -> dict[str, Any]:
        return dict(self.values)


def post_json(url: str, payload: dict[str, Any], timeout: float = 1.0) -> None:
    body = json.dumps(payload, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"dashboard returned HTTP {response.status}")


def load_settings(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        config = json.load(stream)
    return config.get("sitl_telemetry", {})


def main() -> int:
    parser = argparse.ArgumentParser(description="Receive SITL telemetry for the Cesium dashboard (simulation only)")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--endpoint", help="MAVLink receive endpoint, e.g. udpin:127.0.0.1:14541")
    parser.add_argument("--server-url", help="Local dashboard endpoint")
    parser.add_argument("--rate", type=float, help="Maximum dashboard updates per second")
    args = parser.parse_args()

    settings = load_settings(args.config)
    endpoint = args.endpoint or settings.get("endpoint", "udpin:0.0.0.0:14540")
    server_url = args.server_url or settings.get("server_url", "http://127.0.0.1:8765/api/autopilot")
    rate = args.rate or float(settings.get("update_rate_hz", 5))
    if rate <= 0:
        parser.error("--rate must be greater than zero")

    try:
        from pymavlink import mavutil
    except ImportError:
        print("Missing pymavlink. Run: py -m pip install -r requirements-mavlink.txt")
        return 2

    print("SIMULATION ONLY - receive-only adapter; no flight commands are sent.")
    print(f"Listening for SITL MAVLink on {endpoint}")
    print(f"Publishing visual telemetry to {server_url}")
    connection = mavutil.mavlink_connection(endpoint, autoreconnect=True)
    accumulator = TelemetryAccumulator()
    last_post = 0.0
    last_wait_notice = 0.0
    interval = 1.0 / rate
    try:
        while True:
            message = connection.recv_match(blocking=True, timeout=1)
            now = time.monotonic()
            if message is None:
                if now - last_wait_notice >= 5:
                    print("Waiting for SITL telemetry...")
                    last_wait_notice = now
                continue
            accumulator.update(message, mavutil.mode_string_v10)
            if not accumulator.ready() or now - last_post < interval:
                continue
            try:
                post_json(server_url, accumulator.snapshot())
                last_post = now
            except OSError as exc:
                if now - last_wait_notice >= 5:
                    print(f"Dashboard unavailable: {exc}")
                    last_wait_notice = now
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
