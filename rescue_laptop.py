"""Operator-reviewed person detection for a live camera or recorded video.

The detector creates candidates; it never releases a payload automatically.
Hardware release requires --enable-hardware-release, a connected serial port,
and a candidate explicitly confirmed by the operator.
"""

from __future__ import annotations

import argparse
import csv
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
from ultralytics import YOLO

from vision_workflow import candidate_ready, parse_class_ids, release_allowed, source_label

BAUD = 9600


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Review person candidates in recorded or live imagery")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--video", type=Path, help="recorded video file")
    source.add_argument("--camera-index", type=int, default=0, help="camera index (default: 0)")
    parser.add_argument("--port", help="Nano serial port, such as COM3; omitted means vision-only mode")
    parser.add_argument("--enable-hardware-release", action="store_true",
                        help="permit an operator-approved R command to the configured Nano")
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--person-classes", default="0",
                        help="model class IDs treated as people; VisDrone models normally use 0,1")
    parser.add_argument("--confidence", type=float, default=0.60)
    parser.add_argument("--confirm-frames", type=int, default=15)
    parser.add_argument("--log-dir", type=Path, default=Path("mission_logs"))
    return parser.parse_args()


class SerialLink:
    def __init__(self, port: str | None, log):
        self.serial = None
        self.gps = {"lat": None, "lon": None, "sats": 0}
        self.latch_status = "UNKNOWN"
        self.stop = threading.Event()
        self.log = log
        if not port:
            return
        try:
            import serial
            self.serial = serial.Serial(port, BAUD, timeout=1)
        except (ImportError, OSError) as exc:
            raise RuntimeError(f"Could not open {port} at {BAUD} baud: {exc}") from exc
        time.sleep(2)
        threading.Thread(target=self._read, daemon=True).start()

    @property
    def connected(self) -> bool:
        return self.serial is not None and self.serial.is_open

    def _read(self) -> None:
        while not self.stop.is_set() and self.serial:
            try:
                line = self.serial.readline().decode(errors="ignore").strip()
            except (OSError, AttributeError):
                continue
            if not line:
                continue
            if line.startswith("GPS,") and "NOFIX" not in line:
                try:
                    _, lat, lon, sats = line.split(",")
                    self.gps.update(lat=float(lat), lon=float(lon), sats=int(sats))
                except ValueError:
                    self.log("SERIAL_PARSE_ERROR", line)
            elif line.startswith("GPS,NOFIX"):
                self.gps.update(lat=None, lon=None, sats=0)
            elif line.startswith("STATUS,"):
                self.latch_status = line.removeprefix("STATUS,")
                self.log("LATCH_STATUS", self.latch_status)

    def send(self, command: bytes) -> bool:
        if not self.connected:
            return False
        self.serial.write(command)
        self.log("SERIAL_COMMAND", command.decode("ascii"))
        return True

    def close(self) -> None:
        self.stop.set()
        if self.serial:
            self.serial.close()


def main() -> int:
    args = parse_args()
    if args.video and not args.video.is_file():
        print(f"Video not found: {args.video}")
        return 2
    args.log_dir.mkdir(parents=True, exist_ok=True)
    log_path = args.log_dir / f"vision-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
    log_file = log_path.open("w", newline="", encoding="utf-8")
    writer = csv.writer(log_file)
    writer.writerow(("timestamp_utc", "event", "detail"))

    def log(event: str, detail: str) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        writer.writerow((timestamp, event, detail))
        log_file.flush()
        print(f"{timestamp} {event}: {detail}")

    try:
        link = SerialLink(args.port, log)
    except RuntimeError as exc:
        log_file.close()
        print(exc)
        return 2

    source = str(args.video) if args.video else args.camera_index
    try:
        person_classes = parse_class_ids(args.person_classes)
    except ValueError as exc:
        link.close()
        log_file.close()
        print(f"Invalid --person-classes: {exc}")
        return 2
    source_name = source_label(str(args.video) if args.video else None, args.camera_index)
    log("SESSION_STARTED", f"{source_name}; model={args.model}; person_classes={person_classes}; "
        f"hardware_release={args.enable_hardware_release}")
    model = YOLO(args.model)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        link.close()
        log("SOURCE_ERROR", source_name)
        log_file.close()
        print(f"Could not open {source_name}")
        return 2

    recorded = args.video is not None
    fps = cap.get(cv2.CAP_PROP_FPS) if recorded else 0
    wait_ms = max(1, round(1000 / fps)) if fps and fps > 0 else 1
    streak = 0
    candidate = False
    confirmed = False
    released = False
    frame_number = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_number += 1
            result = model(frame, classes=person_classes, conf=args.confidence, verbose=False)[0]
            found = len(result.boxes) > 0
            for box in result.boxes.xyxy:
                x1, y1, x2, y2 = map(int, box)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 255), 2)
            streak = streak + 1 if found else 0
            now_candidate = candidate_ready(streak, args.confirm_frames)
            if now_candidate and not candidate:
                candidate = True
                confirmed = False
                log("CANDIDATE_READY", f"frame={frame_number}; consecutive_frames={streak}")
            elif not found and candidate:
                candidate = False
                confirmed = False
                log("CANDIDATE_CLEARED", f"frame={frame_number}")

            gps = link.gps
            gps_text = (f"GPS {gps['lat']:.6f}, {gps['lon']:.6f} ({gps['sats']} sats)"
                        if gps["lat"] is not None else "GPS: no fix / not connected")
            status = "RELEASE ACKNOWLEDGED" if released else (
                "TARGET CONFIRMED - PRESS R TO RELEASE" if confirmed else
                "CANDIDATE - PRESS C TO CONFIRM / X TO REJECT" if candidate else
                "PERSON SEEN - WAITING FOR STABILITY" if found else "SEARCHING")
            cv2.putText(frame, "RECORDED FOOTAGE" if recorded else "LIVE CAMERA",
                        (10, 28), cv2.FONT_HERSHEY_SIMPLEX, .65, (255, 220, 80), 2)
            cv2.putText(frame, status, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, .65, (0, 80, 255), 2)
            cv2.putText(frame, gps_text, (10, 90), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 0), 2)
            cv2.putText(frame, f"LATCH: {link.latch_status} | simulation/hardware bench only",
                        (10, 118), cv2.FONT_HERSHEY_SIMPLEX, .5, (200, 220, 220), 1)
            cv2.imshow("Rescue Drone - Operator Review", frame)

            key = cv2.waitKey(wait_ms) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("c") and candidate:
                confirmed = True
                log("TARGET_CONFIRMED", f"operator confirmed frame={frame_number}")
            if key == ord("x") and candidate:
                candidate = False
                confirmed = False
                streak = 0
                log("TARGET_REJECTED", f"operator rejected frame={frame_number}")
            if key == ord("r"):
                allowed = release_allowed(candidate_confirmed=confirmed,
                                          hardware_enabled=args.enable_hardware_release,
                                          serial_connected=link.connected)
                if allowed:
                    released = link.send(b"R")
                    log("RELEASE_REQUEST", "operator-approved hardware release command sent")
                else:
                    log("RELEASE_BLOCKED",
                        f"confirmed={confirmed}; enabled={args.enable_hardware_release}; connected={link.connected}")
            if key == ord("l") and link.connected:
                link.send(b"L")
                released = False
                log("LOCK_REQUEST", "operator requested latch lock")
    finally:
        link.close()
        cap.release()
        cv2.destroyAllWindows()
        log("SESSION_FINISHED", f"frames={frame_number}")
        log_file.close()
    print(f"Evidence log: {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
