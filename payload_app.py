#!/usr/bin/env python3
"""Raspberry Pi payload demonstrator for hierarchical wall/crack inspection.

The program supports the Raspberry Pi CSI camera through Picamera2, ordinary
USB UVC webcams through OpenCV, and a still image for bench testing.
"""

from __future__ import annotations

import argparse
import csv
from functools import partial
import json
import os
import platform
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import cv2
    import numpy as np
except ImportError as exc:  # pragma: no cover - depends on target hardware
    raise SystemExit(
        "OpenCV or NumPy is missing. On Windows run ./setup.ps1; on a Raspberry Pi run ./install_pi.sh."
    ) from exc

try:
    import torch
    import torch.nn as nn
    from torchvision.models import resnet18, resnet50
    from torchvision.models.detection import (
        SSDLite320_MobileNet_V3_Large_Weights,
        ssdlite320_mobilenet_v3_large,
    )
except ImportError as exc:  # pragma: no cover - depends on target hardware
    raise SystemExit(
        "PyTorch or Torchvision is missing. Run ./install_pi.sh first."
    ) from exc

from payload_logic import Decision, DecisionConfig, TemporalDecisionEngine


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = PROJECT_DIR / "payload_config.json"


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)

    required_sections = {"camera", "decision", "runtime", "gpio"}
    missing = required_sections - config.keys()
    if missing:
        raise ValueError(f"Missing config sections: {', '.join(sorted(missing))}")
    return config


def load_state_dict_safely(path: Path):
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except TypeError:  # PyTorch versions before weights_only was added
        return torch.load(path, map_location="cpu")


class ClassifierPair:
    """Loads the user's existing ResNet models and performs CPU inference."""

    def __init__(self, wall_path: Path, crack_path: Path, thread_count: int):
        for model_path in (wall_path, crack_path):
            if not model_path.is_file():
                raise FileNotFoundError(f"Model not found: {model_path}")

        torch.set_grad_enabled(False)
        torch.set_num_threads(max(1, thread_count))
        if hasattr(torch, "set_num_interop_threads"):
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass

        self.wall_model = resnet18(weights=None)
        self.wall_model.fc = nn.Sequential(
            nn.Linear(self.wall_model.fc.in_features, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 2),
        )
        self.wall_model.load_state_dict(load_state_dict_safely(wall_path))
        self.wall_model.eval()

        self.crack_model = resnet50(weights=None)
        self.crack_model.fc = nn.Sequential(
            nn.Linear(self.crack_model.fc.in_features, 256),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(256, 2),
        )
        self.crack_model.load_state_dict(load_state_dict_safely(crack_path))
        self.crack_model.eval()

        self.mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)

    def _tensor(self, roi_bgr: np.ndarray) -> torch.Tensor:
        resized = cv2.resize(roi_bgr, (224, 224), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0)
        tensor = (tensor - self.mean) / self.std
        return tensor.unsqueeze(0)

    def predict(self, roi_bgr: np.ndarray, wall_accept_threshold: float):
        tensor = self._tensor(roi_bgr)
        with torch.inference_mode():
            wall_logits = self.wall_model(tensor)[0]
            wall_score = torch.softmax(wall_logits, dim=0)[1].item()

            crack_score = None
            if wall_score >= wall_accept_threshold:
                crack_logits = self.crack_model(tensor)[0]
                crack_score = torch.softmax(crack_logits, dim=0)[1].item()

        return wall_score, crack_score


class BaseCamera:
    description = "unknown"

    def read(self):
        raise NotImplementedError

    def close(self):
        pass


class OpenCVCamera(BaseCamera):
    def __init__(self, index: int, width: int, height: int, fps: int):
        if platform.system() == "Windows":
            preferred_backend = cv2.CAP_DSHOW
        elif platform.system() == "Linux":
            preferred_backend = cv2.CAP_V4L2
        else:
            preferred_backend = cv2.CAP_ANY

        self.cap = cv2.VideoCapture(index, preferred_backend)
        if not self.cap.isOpened() and preferred_backend != cv2.CAP_ANY:
            self.cap.release()
            self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open USB/web camera index {index}")

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.description = f"USB camera {index}"

    def read(self):
        ok, frame = self.cap.read()
        return ok and frame is not None, frame

    def close(self):
        self.cap.release()


class PiCameraSource(BaseCamera):
    def __init__(self, width: int, height: int, fps: int):
        try:
            from picamera2 import Picamera2
        except ImportError as exc:
            raise RuntimeError("Picamera2 is not installed") from exc

        self.camera = Picamera2()
        video_config = self.camera.create_video_configuration(
            main={"size": (width, height), "format": "RGB888"},
            controls={"FrameRate": fps},
            buffer_count=3,
        )
        self.camera.configure(video_config)

        try:
            from libcamera import controls

            self.camera.set_controls({"AfMode": controls.AfModeEnum.Continuous})
        except (ImportError, RuntimeError, AttributeError):
            # Fixed-focus cameras and older Picamera2 releases do not expose AF.
            pass

        self.camera.start()
        time.sleep(1.0)
        self.description = "Raspberry Pi CSI camera"

    def read(self):
        rgb = self.camera.capture_array("main")
        if rgb is None:
            return False, None
        return True, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    def close(self):
        self.camera.stop()
        self.camera.close()


class StaticImageSource(BaseCamera):
    def __init__(self, path: Path, width: int, height: int):
        source = cv2.imread(str(path))
        if source is None:
            raise RuntimeError(f"Could not read test image: {path}")
        source_height, source_width = source.shape[:2]
        scale = min(width / source_width, height / source_height)
        resized = cv2.resize(
            source,
            (max(1, int(source_width * scale)), max(1, int(source_height * scale))),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
        )
        self.frame = np.zeros((height, width, 3), dtype=np.uint8)
        y = (height - resized.shape[0]) // 2
        x = (width - resized.shape[1]) // 2
        self.frame[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
        self.description = f"test image {path.name}"

    def read(self):
        return True, self.frame.copy()


def create_camera(kind: str, camera_cfg: dict, index: int, image: Optional[Path]):
    width = int(camera_cfg["width"])
    height = int(camera_cfg["height"])
    fps = int(camera_cfg["fps"])

    if image is not None:
        return StaticImageSource(image, width, height)

    if kind == "pi":
        return PiCameraSource(width, height, fps)
    if kind == "usb":
        return OpenCVCamera(index, width, height, fps)

    errors = []
    for constructor in (
        lambda: PiCameraSource(width, height, fps),
        lambda: OpenCVCamera(index, width, height, fps),
    ):
        try:
            return constructor()
        except Exception as exc:  # try the next supported backend
            errors.append(str(exc))
    raise RuntimeError("No camera opened. " + " | ".join(errors))


class PersonDetector:
    """Offline person gate using built-in OpenCV face and pedestrian models."""

    def __init__(self, working_width: int, enable_hog: bool = True):
        self.working_width = working_width
        cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        self.face = cv2.CascadeClassifier(str(cascade_path))
        self.hog = None
        if enable_hog:
            self.hog = cv2.HOGDescriptor()
            self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def detect(self, frame: np.ndarray):
        height, width = frame.shape[:2]
        scale = min(1.0, self.working_width / float(width))
        small = cv2.resize(
            frame,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )

        boxes = []
        scores = []
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        faces = self.face.detectMultiScale(
            gray,
            scaleFactor=1.12,
            minNeighbors=6,
            minSize=(36, 36),
        )
        for x, y, w, h in faces:
            # Expand a detected face so the overlay represents a person region.
            pad_x, pad_y = int(w * 0.6), int(h * 0.8)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(small.shape[1], x + w + pad_x)
            y2 = min(small.shape[0], y + h + int(h * 2.2))
            boxes.append([x1, y1, x2 - x1, y2 - y1])
            scores.append(0.90)

        if self.hog is not None and small.shape[0] >= 128 and small.shape[1] >= 64:
            people, weights = self.hog.detectMultiScale(
                small,
                hitThreshold=0.0,
                winStride=(8, 8),
                padding=(8, 8),
                scale=1.08,
            )
            for (x, y, w, h), weight in zip(people, weights):
                weight_value = float(weight)
                if weight_value >= 0.25:
                    boxes.append([int(x), int(y), int(w), int(h)])
                    scores.append(min(0.99, 0.55 + weight_value * 0.15))

        if not boxes:
            return []

        keep = cv2.dnn.NMSBoxes(boxes, scores, 0.20, 0.35)
        if len(keep) == 0:
            return []

        inverse = 1.0 / scale
        detections = []
        for index in np.array(keep).reshape(-1):
            x, y, w, h = boxes[int(index)]
            detections.append(
                (
                    "person",
                    int(x * inverse),
                    int(y * inverse),
                    int((x + w) * inverse),
                    int((y + h) * inverse),
                    scores[int(index)],
                )
            )
        return detections


def overlaps_scan_area(box, scan_box):
    box_x1, box_y1, box_x2, box_y2 = box
    scan_x1, scan_y1, scan_x2, scan_y2 = scan_box
    intersection_width = max(0, min(box_x2, scan_x2) - max(box_x1, scan_x1))
    intersection_height = max(0, min(box_y2, scan_y2) - max(box_y1, scan_y1))
    intersection_area = intersection_width * intersection_height
    box_area = max(1, (box_x2 - box_x1) * (box_y2 - box_y1))
    return intersection_area / box_area >= 0.20


class CocoObjectDetector:
    """Local SSDLite detector; never downloads weights at runtime."""

    TARGETS = {"person", "cell phone", "laptop", "tv"}

    def __init__(self, model_path: Path, score_threshold: float):
        if not model_path.is_file():
            raise FileNotFoundError(f"Object detector not found: {model_path}")

        weights = SSDLite320_MobileNet_V3_Large_Weights.COCO_V1
        self.categories = weights.meta["categories"]
        self.transform = weights.transforms()
        self.score_threshold = score_threshold
        self.model = ssdlite320_mobilenet_v3_large(
            weights=None,
            weights_backbone=None,
            num_classes=len(self.categories),
            norm_layer=partial(nn.BatchNorm2d, eps=0.001, momentum=0.03),
        )
        self.model.load_state_dict(load_state_dict_safely(model_path))
        self.model.eval()

    def detect(self, frame: np.ndarray, scan_box):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0)
        tensor = self.transform(tensor)
        with torch.inference_mode():
            prediction = self.model([tensor])[0]

        detections = []
        for box, label, score in zip(
            prediction["boxes"], prediction["labels"], prediction["scores"]
        ):
            score_value = float(score.item())
            if score_value < self.score_threshold:
                break
            name = self.categories[int(label.item())]
            if name not in self.TARGETS:
                continue
            x1, y1, x2, y2 = (int(value) for value in box.tolist())
            if name != "person" and not overlaps_scan_area((x1, y1, x2, y2), scan_box):
                continue
            detections.append((name, x1, y1, x2, y2, score_value))
        return detections


def measure_quality(roi: np.ndarray):
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    return blur_score, brightness


def possible_red_mark(frame: np.ndarray, objects) -> bool:
    """Conservative visual cue only; red objects are not identified as blood."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    red_low = cv2.inRange(hsv, np.array([0, 90, 60]), np.array([12, 255, 255]))
    red_high = cv2.inRange(hsv, np.array([170, 90, 60]), np.array([179, 255, 255]))
    red_mask = cv2.bitwise_or(red_low, red_high)
    for name, px1, py1, px2, py2, _score in objects:
        if name != "person":
            continue
        x1 = max(0, px1)
        y1 = max(0, py1)
        x2 = min(frame.shape[1], px2)
        y2 = min(frame.shape[0], py2)
        if x2 <= x1 or y2 <= y1:
            continue
        region = red_mask[y1:y2, x1:x2]
        area = max(1, region.shape[0] * region.shape[1])
        if cv2.countNonZero(region) / area >= 0.08:
            return True
    return False


def estimate_disaster_scene(frame: np.ndarray) -> tuple[str, float]:
    """Lightweight demo estimate; labels are intentionally non-diagnostic."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    blue_water = cv2.inRange(hsv, np.array([80, 20, 25]), np.array([135, 255, 210]))
    brown_water = cv2.inRange(hsv, np.array([5, 20, 20]), np.array([35, 220, 190]))
    warm_fire = cv2.inRange(hsv, np.array([0, 110, 80]), np.array([35, 255, 255]))
    water_ratio = (cv2.countNonZero(blue_water) + cv2.countNonZero(brown_water)) / (2 * frame.shape[0] * frame.shape[1])
    fire_ratio = cv2.countNonZero(warm_fire) / (frame.shape[0] * frame.shape[1])
    if water_ratio > 0.22:
        return "POSSIBLE FLOOD", min(0.99, 0.55 + water_ratio)
    if fire_ratio > 0.28:
        return "POSSIBLE FIRE", min(0.99, 0.50 + fire_ratio)
    return "NO CLEAR DISASTER", 0.50


class InspectionLogger:
    def __init__(self, root: Path, evidence_cooldown_seconds: float):
        session = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.directory = root / session
        self.directory.mkdir(parents=True, exist_ok=True)
        self.csv_path = self.directory / "inspection_log.csv"
        self.cooldown = evidence_cooldown_seconds
        self.last_evidence_time = 0.0
        self.last_code = None

        with self.csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                [
                    "timestamp_utc",
                    "state",
                    "message",
                    "wall_score",
                    "crack_score",
                    "blur_score",
                    "brightness",
                    "person_count",
                    "person_bounding_boxes",
                    "simulated_release",
                    "evidence_file",
                ]
            )

    def record_state_change(
        self,
        decision: Decision,
        frame: np.ndarray,
        blur_score: float,
        brightness: float,
        objects=(),
    ):
        if decision.code == self.last_code:
            return
        self.last_code = decision.code

        evidence_name = ""
        now = time.monotonic()
        if decision.code in ("crack", "payload_released") and now - self.last_evidence_time >= self.cooldown:
            prefix = "rescue_release" if decision.code == "payload_released" else "crack"
            evidence_name = f"{prefix}_{datetime.now().strftime('%H%M%S')}.jpg"
            cv2.imwrite(str(self.directory / evidence_name), frame)
            self.last_evidence_time = now

        people = [item for item in objects if item[0] == "person"]
        boxes = [
            {"x1": item[1], "y1": item[2], "x2": item[3], "y2": item[4], "confidence": round(item[5], 4)}
            for item in people
        ]

        with self.csv_path.open("a", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerow(
                [
                    utc_timestamp(),
                    decision.code,
                    decision.message,
                    "" if decision.wall_score is None else f"{decision.wall_score:.4f}",
                    "" if decision.crack_score is None else f"{decision.crack_score:.4f}",
                    f"{blur_score:.1f}",
                    f"{brightness:.1f}",
                    len(people),
                    json.dumps(boxes, separators=(",", ":")),
                    "yes" if decision.code == "payload_released" else "no",
                    evidence_name,
                ]
            )

    def save_manual_snapshot(self, frame: np.ndarray):
        name = f"snapshot_{datetime.now().strftime('%H%M%S')}.jpg"
        cv2.imwrite(str(self.directory / name), frame)
        return self.directory / name


class PayloadGPIO:
    def __init__(self, enabled: bool, config: dict):
        self.enabled = False
        self.green = self.red = self.buzzer = None
        self.last_code = None
        if not enabled:
            return

        try:
            from gpiozero import Buzzer, LED

            self.green = LED(int(config["green_led_bcm"]))
            self.red = LED(int(config["red_led_bcm"]))
            self.buzzer = Buzzer(int(config["buzzer_bcm"]))
            self.enabled = True
        except Exception as exc:
            print(f"GPIO disabled: {exc}", file=sys.stderr)

    def update(self, code: str):
        if not self.enabled or code == self.last_code:
            return
        self.last_code = code
        self.green.off()
        self.red.off()
        self.buzzer.off()
        if code == "safe":
            self.green.on()
        elif code == "crack":
            self.red.on()
            self.buzzer.beep(on_time=0.12, off_time=0.12, n=2, background=True)
        elif code == "person":
            self.red.blink(on_time=0.25, off_time=0.25, n=2, background=True)

    def close(self):
        for device in (self.green, self.red, self.buzzer):
            if device is not None:
                device.close()


def centered_scan_box(frame: np.ndarray, ratio: float):
    height, width = frame.shape[:2]
    side = int(min(height, width) * ratio)
    x1 = (width - side) // 2
    y1 = (height - side) // 2
    return x1, y1, x1 + side, y1 + side


def draw_hud(
    frame: np.ndarray,
    decision: Decision,
    scan_box,
    objects,
    fps: float,
    blur_score: float,
    brightness: float,
    inference_ms: float,
    source_description: str,
    disaster_label: str = "",
    disaster_confidence: float = 0.0,
):
    x1, y1, x2, y2 = scan_box
    color = decision.color_bgr
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
    cv2.putText(
        frame,
        "STRUCTURAL SCAN AREA",
        (x1, max(28, y1 - 10)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        color,
        2,
        cv2.LINE_AA,
    )

    for name, px1, py1, px2, py2, score in objects:
        object_color = (0, 165, 255) if name == "person" else (255, 0, 255)
        cv2.rectangle(frame, (px1, py1), (px2, py2), object_color, 3)
        cv2.putText(
            frame,
            f"{name.upper()} {score * 100:.0f}%",
            (px1, max(24, py1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            object_color,
            2,
            cv2.LINE_AA,
        )

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame.shape[1], 78), (10, 18, 35), -1)
    cv2.rectangle(
        overlay,
        (0, frame.shape[0] - 92),
        (frame.shape[1], frame.shape[0]),
        (10, 18, 35),
        -1,
    )
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)

    cv2.putText(
        frame,
        "AUTONOMOUS DRONE PAYLOAD - WALL CRACK INSPECTION",
        (18, 31),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        decision.message,
        (18, 64),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        color,
        2,
        cv2.LINE_AA,
    )
    if disaster_label:
        cv2.putText(
            frame,
            f"SCENE: {disaster_label} ({disaster_confidence * 100:.0f}%)",
            (frame.shape[1] - 430, 64),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            (0, 165, 255) if "POSSIBLE" in disaster_label else (180, 180, 180),
            2,
            cv2.LINE_AA,
        )

    wall_text = "--" if decision.wall_score is None else f"{decision.wall_score * 100:.1f}%"
    crack_text = "--" if decision.crack_score is None else f"{decision.crack_score * 100:.1f}%"
    person_count = sum(1 for item in objects if item[0] == "person")
    status_line = (
        f"Persons detected {person_count}   "
        f"Wall score {wall_text}   Crack score {crack_text}   "
        f"FPS {fps:.1f}   Inference {inference_ms:.0f} ms"
    )
    quality_line = (
        f"Image quality: sharpness {blur_score:.0f}, brightness {brightness:.0f}   "
        f"Source: {source_description}"
    )
    cv2.putText(
        frame,
        status_line,
        (18, frame.shape[0] - 54),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (235, 235, 235),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        quality_line,
        (18, frame.shape[0] - 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (205, 205, 205),
        1,
        cv2.LINE_AA,
    )


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--camera", choices=("auto", "pi", "usb"), default="auto")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument(
        "--laptop-camera",
        action="store_true",
        help="Use the laptop/USB webcam (equivalent to --camera usb)",
    )
    parser.add_argument(
        "--rescue-demo",
        action="store_true",
        help="Laptop-camera rescue demo: detect a person and simulate payload release",
    )
    parser.add_argument("--image", type=Path, help="Use a still image instead of a camera")
    parser.add_argument("--fullscreen", action="store_true")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--no-hog", action="store_true", help="Use face detection only")
    parser.add_argument("--gpio", action="store_true", help="Enable optional LEDs and buzzer")
    parser.add_argument("--max-frames", type=int, default=0, help=argparse.SUPPRESS)
    return parser.parse_args()


def main():
    args = parse_args()
    config = load_config(args.config.resolve())
    decision_cfg = DecisionConfig(**config["decision"])
    engine = TemporalDecisionEngine(decision_cfg)

    model_dir = PROJECT_DIR / "models"
    runtime_cfg = config["runtime"]
    required = [model_dir / runtime_cfg["wall_model"], model_dir / runtime_cfg["crack_model"]]
    absent = [path.name for path in required if not path.is_file()]
    if absent:
        print(
            "Missing model file(s): " + ", ".join(absent) + "\n"
            f"Place them in {model_dir} (they are not stored in Git). See models/README.md.\n"
            "The disaster classifier, 3D simulation and QGroundControl bridge do not need them.",
            file=sys.stderr,
        )
        return 1
    print("Loading wall and crack models. This can take a moment on Raspberry Pi...")
    models = ClassifierPair(
        model_dir / runtime_cfg["wall_model"],
        model_dir / runtime_cfg["crack_model"],
        int(runtime_cfg["torch_threads"]),
    )
    camera_kind = "usb" if args.laptop_camera else args.camera
    camera = create_camera(
        camera_kind,
        config["camera"],
        args.camera_index,
        args.image.resolve() if args.image else None,
    )
    print(f"Camera ready: {camera.description}")

    try:
        detector = CocoObjectDetector(
            model_dir / runtime_cfg["object_model"],
            float(runtime_cfg["object_score_threshold"]),
        )
        coco_detector_active = True
        print("Offline COCO detector ready: person, phone, laptop, and TV")
    except Exception as exc:
        print(f"COCO detector unavailable ({exc}); using offline person fallback.", file=sys.stderr)
        detector = PersonDetector(
            int(runtime_cfg["person_working_width"]),
            enable_hog=not args.no_hog,
        )
        coco_detector_active = False
    logger = InspectionLogger(
        PROJECT_DIR / runtime_cfg["report_directory"],
        float(runtime_cfg["evidence_cooldown_seconds"]),
    )
    gpio = PayloadGPIO(args.gpio, config["gpio"])

    window_name = "Autonomous Drone Payload Inspection"
    if not args.headless:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        if args.fullscreen:
            cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    frame_number = 0
    object_detections = []
    object_hold = 0
    object_interval = max(1, int(runtime_cfg["object_detection_interval_frames"]))
    object_hold_frames = max(1, int(runtime_cfg["object_hold_frames"]))
    inference_interval = max(1, int(runtime_cfg["classification_interval_frames"]))
    scan_ratio = float(runtime_cfg["scan_area_ratio"])
    last_decision = Decision("starting", "SYSTEM STARTING", (255, 170, 0))
    last_inference_ms = 0.0
    previous_frame_time = time.monotonic()
    rescue_person_frames = 0
    rescue_clear_frames = 0
    rescue_released = False
    rescue_required_frames = max(1, int(runtime_cfg.get("rescue_person_hold_frames", 8)))

    try:
        while True:
            ok, frame = camera.read()
            if not ok:
                print("Camera frame unavailable; retrying...", file=sys.stderr)
                time.sleep(0.2)
                continue

            frame_number += 1
            now = time.monotonic()
            fps = 1.0 / max(0.001, now - previous_frame_time)
            previous_frame_time = now

            scan_box = centered_scan_box(frame, scan_ratio)
            x1, y1, x2, y2 = scan_box
            roi = frame[y1:y2, x1:x2]
            blur_score, brightness = measure_quality(roi)

            if (frame_number - 1) % object_interval == 0:
                if coco_detector_active:
                    fresh_objects = detector.detect(frame, scan_box)
                else:
                    fresh_objects = detector.detect(frame)
                if fresh_objects:
                    object_detections = fresh_objects
                    object_hold = object_hold_frames
                elif object_hold > 0:
                    object_hold -= object_interval
                else:
                    object_detections = []
            elif object_hold > 0:
                object_hold -= 1
            else:
                object_detections = []

            person_present = any(item[0] == "person" for item in object_detections)
            rejected_objects = [item for item in object_detections if item[0] != "person"]
            quality_problem = (
                blur_score < decision_cfg.blur_minimum
                or brightness < decision_cfg.brightness_minimum
                or brightness > decision_cfg.brightness_maximum
            )

            should_classify = frame_number % inference_interval == 0 or frame_number == 1
            if args.rescue_demo:
                red_mark_possible = possible_red_mark(frame, object_detections)
                if person_present:
                    rescue_person_frames += 1
                    rescue_clear_frames = 0
                    if rescue_person_frames >= rescue_required_frames:
                        rescue_released = True
                    if red_mark_possible:
                        last_decision = Decision(
                            "possible_red_mark",
                            "POSSIBLE BLOOD - PERSON MAY BE HARMED",
                            (0, 0, 255),
                        )
                    elif rescue_released:
                        last_decision = Decision(
                            "payload_released",
                            "PERSON DETECTED - PAYLOAD RELEASE SIMULATED",
                            (0, 210, 0),
                        )
                    else:
                        last_decision = Decision(
                            "person_confirming",
                            f"PERSON DETECTED - CONFIRMING ({rescue_person_frames}/{rescue_required_frames})",
                            (0, 165, 255),
                        )
                else:
                    rescue_person_frames = 0
                    if rescue_released:
                        rescue_clear_frames += 1
                        if rescue_clear_frames >= rescue_required_frames:
                            rescue_released = False
                            rescue_clear_frames = 0
                    if rescue_released:
                        last_decision = Decision(
                            "payload_released",
                            "PAYLOAD RELEASED - WAITING FOR PERSON TO CLEAR",
                            (0, 210, 0),
                        )
                    elif quality_problem:
                        last_decision = engine.update(
                            person_present=False,
                            blur_score=blur_score,
                            brightness=brightness,
                            wall_score=None,
                            crack_score=None,
                        )
                    elif should_classify:
                        started = time.perf_counter()
                        wall_score, crack_score = models.predict(
                            roi, decision_cfg.wall_accept_threshold
                        )
                        last_inference_ms = (time.perf_counter() - started) * 1000.0
                        last_decision = engine.update(
                            person_present=False,
                            blur_score=blur_score,
                            brightness=brightness,
                            wall_score=wall_score,
                            crack_score=crack_score,
                        )
                    else:
                        last_decision = Decision(
                            "ready",
                            "READY - WALL/CRACK SCAN ACTIVE",
                            (255, 170, 0),
                        )
            elif person_present or quality_problem:
                last_decision = engine.update(
                    person_present=person_present,
                    blur_score=blur_score,
                    brightness=brightness,
                    wall_score=None,
                    crack_score=None,
                )
            elif rejected_objects:
                engine.reset()
                rejected_name = rejected_objects[0][0].upper()
                last_decision = Decision(
                    "object",
                    f"{rejected_name} DETECTED - NOT A WALL",
                    (255, 0, 255),
                )
            elif should_classify:
                started = time.perf_counter()
                wall_score, crack_score = models.predict(
                    roi, decision_cfg.wall_accept_threshold
                )
                last_inference_ms = (time.perf_counter() - started) * 1000.0
                last_decision = engine.update(
                    person_present=False,
                    blur_score=blur_score,
                    brightness=brightness,
                    wall_score=wall_score,
                    crack_score=crack_score,
                )

            display = frame.copy()
            disaster_label, disaster_confidence = estimate_disaster_scene(frame)
            draw_hud(
                display,
                last_decision,
                scan_box,
                object_detections,
                fps,
                blur_score,
                brightness,
                last_inference_ms,
                camera.description,
                disaster_label,
                disaster_confidence,
            )
            logger.record_state_change(
                last_decision, display, blur_score, brightness, object_detections
            )
            gpio.update(last_decision.code)

            if not args.headless:
                cv2.imshow(window_name, display)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    break
                if key == ord("s"):
                    saved = logger.save_manual_snapshot(display)
                    print(f"Snapshot saved: {saved}")
                if key == ord("f"):
                    current = cv2.getWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN)
                    target = cv2.WINDOW_NORMAL if current == cv2.WINDOW_FULLSCREEN else cv2.WINDOW_FULLSCREEN
                    cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, target)
                if args.rescue_demo and key == ord("r"):
                    rescue_released = True
                    rescue_person_frames = rescue_required_frames
                    last_decision = Decision(
                        "payload_released",
                        "MANUAL PAYLOAD RELEASE SIMULATED",
                        (0, 210, 0),
                    )

            if args.max_frames and frame_number >= args.max_frames:
                break
    except KeyboardInterrupt:
        pass
    finally:
        camera.close()
        gpio.close()
        if not args.headless:
            cv2.destroyAllWindows()
        print(f"Inspection log: {logger.csv_path}")


if __name__ == "__main__":
    raise SystemExit(main())
