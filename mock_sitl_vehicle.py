"""Small MAVLink telemetry source for testing the receive path without PX4.

SIMULATION ONLY. Emits telemetry packets to localhost and accepts no commands.
It is not a flight dynamics model or an autopilot replacement.
"""

from __future__ import annotations

import argparse
import math
import time
from dataclasses import dataclass

HOME_LAT = 47.397742
HOME_LON = 8.545594
HOME_ALT_MSL = 488.0
TARGET_NORTH_M = 500.0


@dataclass(frozen=True)
class MockPose:
    latitude_deg: float
    longitude_deg: float
    relative_altitude_m: float
    heading_deg: float
    battery_percent: int
    mode: str


def trajectory(seconds: float, home_lat: float = HOME_LAT, home_lon: float = HOME_LON) -> MockPose:
    """Repeatable 48-second demo: takeoff, northbound, hold, return, land."""
    t = seconds % 48.0
    if t < 4:
        fraction, altitude, heading, mode = 0.0, 20.0 * t / 4.0, 0.0, "TAKEOFF"
    elif t < 16:
        fraction, altitude, heading, mode = (t - 4) / 12.0, 35.0, 0.0, "MISSION"
    elif t < 30:
        fraction, altitude, heading, mode = 1.0, 35.0, 0.0, "HOLD"
    elif t < 44:
        fraction, altitude, heading, mode = 1.0 - (t - 30) / 14.0, 35.0, 180.0, "RETURN"
    else:
        fraction, altitude, heading, mode = 0.0, 35.0 * (1.0 - (t - 44) / 4.0), 180.0, "LAND"
    return MockPose(
        latitude_deg=home_lat + (TARGET_NORTH_M * fraction) / 111320.0,
        longitude_deg=home_lon,
        relative_altitude_m=max(0.0, altitude),
        heading_deg=heading,
        battery_percent=max(20, 100 - int(seconds / 8)),
        mode=mode,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit localhost MAVLink telemetry for dashboard testing")
    parser.add_argument("--endpoint", default="udpout:127.0.0.1:14540")
    parser.add_argument("--rate", type=float, default=10.0)
    parser.add_argument("--home-lat", type=float, default=HOME_LAT)
    parser.add_argument("--home-lon", type=float, default=HOME_LON)
    args = parser.parse_args()
    if args.rate <= 0:
        parser.error("--rate must be greater than zero")
    try:
        from pymavlink import mavutil
    except ImportError:
        print("Missing pymavlink. Run: py -m pip install -r requirements-mavlink.txt")
        return 2

    connection = mavutil.mavlink_connection(args.endpoint, source_system=1, source_component=1)
    started = time.monotonic()
    print("MOCK SITL TELEMETRY ONLY - no flight controller and no real hardware.")
    print(f"Sending a repeating 500 m northbound demo to {args.endpoint}")
    try:
        while True:
            elapsed = time.monotonic() - started
            pose = trajectory(elapsed, args.home_lat, args.home_lon)
            boot_ms = int(elapsed * 1000) & 0xFFFFFFFF
            armed = pose.mode not in {"LAND"}
            base_mode = mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
            if armed:
                base_mode |= mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
            connection.mav.heartbeat_send(
                mavutil.mavlink.MAV_TYPE_QUADROTOR,
                mavutil.mavlink.MAV_AUTOPILOT_GENERIC,
                base_mode,
                0,
                mavutil.mavlink.MAV_STATE_ACTIVE,
            )
            connection.mav.global_position_int_send(
                boot_ms,
                int(pose.latitude_deg * 1e7),
                int(pose.longitude_deg * 1e7),
                int((HOME_ALT_MSL + pose.relative_altitude_m) * 1000),
                int(pose.relative_altitude_m * 1000),
                0, 0, 0,
                int(pose.heading_deg * 100),
            )
            connection.mav.attitude_send(boot_ms, 0.0, 0.0, math.radians(pose.heading_deg), 0.0, 0.0, 0.0)
            connection.mav.sys_status_send(0, 0, 0, 0, 12000, -1, pose.battery_percent, 0, 0, 0, 0, 0, 0)
            connection.mav.gps_raw_int_send(int(elapsed * 1e6), 3, int(pose.latitude_deg * 1e7),
                                             int(pose.longitude_deg * 1e7),
                                             int((HOME_ALT_MSL + pose.relative_altitude_m) * 1000),
                                             100, 100, 0, int(pose.heading_deg * 100), 12)
            time.sleep(1.0 / args.rate)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
