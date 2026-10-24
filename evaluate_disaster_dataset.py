"""Evaluate the pretrained zero-shot CLIP classifier on a labelled image manifest.

Manifest CSV columns: ``image,label``. Labels may use the full classifier names
or short forms such as ``flood``, ``fire`` and ``normal``. No training occurs.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

from disaster_zero_shot import LABELS, ZeroShotDisasterDetector, load_image, rank_scores

LABEL_ALIASES = {label.removesuffix(" scene"): label for label in LABELS}
LABEL_ALIASES.update({label: label for label in LABELS})
LABEL_ALIASES["earthquake"] = "earthquake damaged building"
LABEL_ALIASES["storm"] = "storm damage scene"
LABEL_ALIASES["landslide"] = "landslide scene"


def canonical_label(value: str) -> str:
    key = value.strip().lower()
    if key not in LABEL_ALIASES:
        raise ValueError(f"unsupported label '{value}'; expected one of {', '.join(LABELS)}")
    return LABEL_ALIASES[key]


def summarize(truth_and_prediction: list[tuple[str, str]], seconds: float) -> dict:
    confusion = {truth: {predicted: 0 for predicted in LABELS} for truth in LABELS}
    correct = 0
    for truth, predicted in truth_and_prediction:
        confusion[truth][predicted] += 1
        correct += truth == predicted
    total = len(truth_and_prediction)
    support = Counter(truth for truth, _ in truth_and_prediction)
    return {
        "images": total,
        "correct": correct,
        "accuracy": correct / total if total else 0.0,
        "seconds": seconds,
        "images_per_second": total / seconds if seconds else 0.0,
        "support": {label: support[label] for label in LABELS},
        "confusion_matrix": confusion,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate pretrained CLIP on a labelled image CSV")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--image-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if not args.manifest.is_file() or not args.image_root.is_dir():
        print("--manifest and --image-root must exist")
        return 2

    items = []
    with args.manifest.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            try:
                label = canonical_label(row.get("label", ""))
            except ValueError as error:
                print(error)
                return 2
            path = args.image_root / row.get("image", "")
            if not path.is_file():
                print(f"Image not found: {path}")
                return 2
            items.append((path, label))
    if not items:
        print("Manifest contains no images")
        return 2

    detector = ZeroShotDisasterDetector()
    rows = []
    pairs = []
    started = time.perf_counter()
    for path, truth in items:
        scores = detector.predict_scores_image(load_image(path))
        prediction, confidence = rank_scores(scores)[0]
        pairs.append((truth, prediction))
        rows.append((str(path), truth, prediction, confidence, truth == prediction))
    elapsed = time.perf_counter() - started
    summary = summarize(pairs, elapsed)
    summary.update({"model": "CLIP ViT-B-32 laion2b_s34b_b79k", "manifest": str(args.manifest)})

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "disaster_predictions.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("image", "truth", "prediction", "confidence", "correct"))
        writer.writerows(rows)
    (args.output_dir / "disaster_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
