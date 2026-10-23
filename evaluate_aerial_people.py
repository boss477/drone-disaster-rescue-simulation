"""Evaluate COCO-person YOLO predictions against YOLO-format aerial labels.

VisDrone's converted labels normally use classes 0 (pedestrian) and 1 (people).
This tool treats both as a single person category and evaluates on a held-out
image folder. It does not train on or alter the dataset.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

from evaluation_metrics import DetectionMetrics, match_detections

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate aerial person detection on a held-out YOLO dataset")
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--truth-classes", default="0,1", help="comma-separated YOLO ground-truth classes")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--imgsz", type=int, default=640, help="YOLO inference size (small aerial people need larger values)")
    parser.add_argument("--output", type=Path, default=Path("aerial_people_evaluation.csv"))
    return parser.parse_args()


def read_yolo_boxes(path: Path, width: int, height: int, classes: set[int]) -> list[tuple[float, float, float, float]]:
    boxes = []
    if not path.is_file():
        return boxes
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 5 or int(float(fields[0])) not in classes:
            continue
        _, cx, cy, bw, bh = map(float, fields[:5])
        boxes.append(((cx - bw / 2) * width, (cy - bh / 2) * height,
                      (cx + bw / 2) * width, (cy + bh / 2) * height))
    return boxes


def main() -> int:
    args = parse_args()
    if not args.images.is_dir() or not args.labels.is_dir():
        print("--images and --labels must be existing directories")
        return 2
    import cv2
    from ultralytics import YOLO

    classes = {int(value) for value in args.truth_classes.split(",")}
    images = sorted(path for path in args.images.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        print("No evaluation images found")
        return 2
    model = YOLO(args.model)
    totals = DetectionMetrics(0, 0, 0)
    rows = []
    started = time.perf_counter()
    for image_path in images:
        frame = cv2.imread(str(image_path))
        if frame is None:
            continue
        height, width = frame.shape[:2]
        truth = read_yolo_boxes(args.labels / f"{image_path.stem}.txt", width, height, classes)
        result = model(frame, classes=[0], conf=args.confidence, imgsz=args.imgsz, verbose=False)[0]
        predictions = [tuple(map(float, box)) for box in result.boxes.xyxy.cpu().tolist()]
        metrics = match_detections(predictions, truth, args.iou)
        totals = DetectionMetrics(totals.true_positive + metrics.true_positive,
                                  totals.false_positive + metrics.false_positive,
                                  totals.false_negative + metrics.false_negative)
        rows.append((image_path.name, len(truth), len(predictions), metrics.true_positive,
                     metrics.false_positive, metrics.false_negative))
    elapsed = time.perf_counter() - started
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("image", "truth_people", "predicted_people", "true_positive", "false_positive", "false_negative"))
        writer.writerows(rows)
    summary = {
        "images": len(rows),
        "true_positive": totals.true_positive,
        "false_positive": totals.false_positive,
        "false_negative": totals.false_negative,
        "precision": totals.precision,
        "recall": totals.recall,
        "seconds": elapsed,
        "frames_per_second": len(rows) / elapsed if elapsed else 0.0,
        "iou_threshold": args.iou,
        "confidence_threshold": args.confidence,
        "image_size": args.imgsz,
        "model": args.model,
        "csv": str(args.output),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
