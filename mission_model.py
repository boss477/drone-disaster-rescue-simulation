"""Deterministic mission timeline for the flood-rescue SIMULATION.

SIMULATION ONLY. This module never talks to hardware. It mirrors the timeline in
``sim/main.js`` (both read ``sim/mission.json``) so the MAVLink bridge can run
standalone when the 3D page is not open.

Coordinates are scene metres: +x east, -z north, +y up.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_MISSION_PATH = PROJECT_DIR / "sim" / "mission.json"

Vec = tuple[float, float, float]


def load_mission(path: Path = DEFAULT_MISSION_PATH) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


@dataclass
class Segment:
    phase: str
    duration: float
    start: Vec
    end: Vec
    site: int = -1  # index of the rescue site, -1 when not at a site
    heading: float = 0.0  # degrees clockwise from north (-z)
    start_time: float = 0.0


def _heading(a: Vec, b: Vec, fallback: float) -> float:
    dx, dz = b[0] - a[0], b[2] - a[2]
    if math.hypot(dx, dz) < 1e-6:
        return fallback
    return math.degrees(math.atan2(dx, -dz)) % 360.0


def build_timeline(mission: dict[str, Any]) -> list[Segment]:
    base = mission["base"]
    pad: Vec = (base["x"], base["pad_height"], base["z"])
    cruise = mission["cruise_altitude_m"]
    above_base: Vec = (pad[0], cruise, pad[2])
    hover = mission["hover_above_roof_m"]
    segments: list[Segment] = []
    heading = 0.0

    def add(phase: str, start: Vec, end: Vec, duration: float, site: int = -1) -> None:
        nonlocal heading
        heading = _heading(start, end, heading)
        segments.append(Segment(phase, max(duration, 0.0), start, end, site, heading))

    def dist(a: Vec, b: Vec) -> float:
        return math.dist(a, b)

    add("loading", pad, pad, mission["packages_loaded"] * mission["load_seconds_per_package"])
    add("takeoff", pad, above_base, dist(pad, above_base) / mission["climb_speed_mps"])
    here = above_base
    for i, site in enumerate(mission["sites"]):
        over: Vec = (site["x"], cruise, site["z"])
        low: Vec = (site["x"], site["roof_height"] + hover, site["z"])
        add("transit", here, over, dist(here, over) / mission["cruise_speed_mps"], i)
        add("descend", over, low, dist(over, low) / mission["descent_speed_mps"], i)
        add("detect", low, low, mission["detect_seconds"], i)
        add("unload", low, low, mission["unload_seconds"], i)
        add("ascend", low, over, dist(low, over) / mission["climb_speed_mps"], i)
        here = over
    add("return", here, above_base, dist(here, above_base) / mission["cruise_speed_mps"])
    add("landing", above_base, pad, dist(above_base, pad) / mission["descent_speed_mps"])

    clock = 0.0
    for seg in segments:
        seg.start_time = clock
        clock += seg.duration
    return segments


def total_duration(segments: list[Segment]) -> float:
    return segments[-1].start_time + segments[-1].duration if segments else 0.0


def mission_item_count(mission: dict[str, Any]) -> int:
    """Mission items: 0 = load/take off, 1..N = rescue sites, N+1 = return/land."""
    return len(mission["sites"]) + 2


def state_at(mission: dict[str, Any], segments: list[Segment], t: float) -> dict[str, Any]:
    """Full simulated state ``t`` seconds after mission start (t is clamped)."""
    total = total_duration(segments)
    t = min(max(t, 0.0), total)
    sites = mission["sites"]
    detected = delivered = 0
    current = segments[-1]
    for seg in segments:
        end = seg.start_time + seg.duration
        if t >= end:  # fully completed segment: apply its events
            if seg.phase == "detect":
                detected += sites[seg.site]["people"]
            elif seg.phase == "unload":
                delivered += 1
            continue
        current = seg
        break
    else:
        current = segments[-1]

    fraction = 1.0 if current.duration == 0 else min((t - current.start_time) / current.duration, 1.0)
    pos = tuple(a + (b - a) * fraction for a, b in zip(current.start, current.end))
    vel = (0.0, 0.0, 0.0)
    if current.duration > 0 and t < total:
        vel = tuple((b - a) / current.duration for a, b in zip(current.start, current.end))

    complete = t >= total
    if current.phase == "loading":
        loaded = min(
            mission["packages_loaded"],
            int((t - current.start_time) / mission["load_seconds_per_package"]),
        )
    else:
        loaded = mission["packages_loaded"]
    flight_time = max(t - segments[0].duration, 0.0)
    battery = max(100.0 - mission["battery_drain_percent_per_second"] * flight_time, 0.0)

    if current.phase in ("loading", "takeoff"):
        seq = 0
    elif current.phase in ("return", "landing") or complete:
        seq = mission_item_count(mission) - 1
    else:
        seq = current.site + 1
    return {
        "source": "model",
        "phase": "complete" if complete else current.phase,
        "t": t,
        "total_seconds": total,
        "progress_percent": 100.0 * t / total if total else 100.0,
        "position": {"x": pos[0], "y": pos[1], "z": pos[2]},
        "velocity": {"x": vel[0], "y": vel[1], "z": vel[2]},
        "heading_deg": current.heading,
        "battery_percent": battery,
        "packages_loaded": loaded,
        "packages_onboard": loaded - delivered,
        "packages_delivered": delivered,
        "people_detected": detected,
        "site_index": current.site,
        "site_name": sites[current.site]["name"] if current.site >= 0 else "",
        "mission_seq": seq,
        "mission_total": mission_item_count(mission),
        "complete": complete,
        "paused": False,
        "simulated": True,
    }
