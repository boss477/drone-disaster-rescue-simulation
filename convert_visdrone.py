"""Convert VisDrone-DET annotations to YOLO-format person labels.

    py convert_visdrone.py --dataset C:/data/VisDrone2019-DET-val --out C:/data/visdrone_val_yolo

VisDrone annotation lines are ``x,y,w,h,score,category,truncation,occlusion``.
Only categories 1 (pedestrian) and 2 (people) are kept, as YOLO classes 0 and 1,
which matches ``evaluate_aerial_people.py --truth-classes 0,1``. Rows with score 0
are VisDrone "ignored regions" and are dropped. Images are copied unchanged.
The dataset stays outside the repository (see dataset_manifest.py for provenance).
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

PERSON_CATEGORIES = {1: 0, 2: 1}  # VisDrone category -> YOLO class


def convert_annotation(text: str, width: int, height: int) -> list[str]:
    lines = []
    for row in text.splitlines():
        fields = row.strip().split(",")
        if len(fields) < 6:
            continue
        x, y, w, h, score, category = (int(float(value)) for value in fields[:6])
        if score == 0 or category not in PERSON_CATEGORIES or w <= 0 or h <= 0:
            continue
        x1, y1 = max(x, 0), max(y, 0)
        x2, y2 = min(x + w, width), min(y + h, height)
        if x2 <= x1 or y2 <= y1:
            continue
        lines.append(
            f"{PERSON_CATEGORIES[category]} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} "
            f"{(x2 - x1) / width:.6f} {(y2 - y1) / height:.6f}"
        )
    return lines


def convert_dataset(dataset: Path, out: Path) -> dict[str, int]:
    from PIL import Image

    images_out, labels_out = out / "images", out / "labels"
    images_out.mkdir(parents=True, exist_ok=True)
    labels_out.mkdir(parents=True, exist_ok=True)
    images = sorted((dataset / "images").glob("*.jpg"))
    people = with_people = 0
    for image_path in images:
        with Image.open(image_path) as image:
            width, height = image.size
        annotation = dataset / "annotations" / f"{image_path.stem}.txt"
        lines = convert_annotation(annotation.read_text(encoding="utf-8"), width, height) if annotation.is_file() else []
        shutil.copy2(image_path, images_out / image_path.name)
        (labels_out / f"{image_path.stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        people += len(lines)
        with_people += bool(lines)
    return {"images": len(images), "images_with_people": with_people, "person_boxes": people}


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert VisDrone-DET person annotations to YOLO format")
    parser.add_argument("--dataset", type=Path, required=True, help="Extracted VisDrone2019-DET-* folder")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not (args.dataset / "images").is_dir():
        print("--dataset must contain images/ and annotations/")
        return 2
    print(convert_dataset(args.dataset, args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
