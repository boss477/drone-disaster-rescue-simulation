"""Build a flood/normal evaluation manifest from FloodNet Track 1.

The FloodNet archive stays outside Git. Point this script at the extracted
``FloodNet Challenge - Track 1`` tree and it writes the ``image,label`` CSV
accepted by :mod:`evaluate_disaster_dataset`.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def floodnet_label(path: Path) -> str | None:
    """Return the classifier label encoded by a FloodNet image path."""
    parts = {part.lower() for part in path.parts}
    if "non-flooded" in parts:
        return "normal"
    if "flooded" in parts:
        return "flood"
    return None


def find_labelled_images(root: Path) -> list[tuple[Path, str]]:
    items = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        if path.parent.name.lower() != "image":
            continue
        label = floodnet_label(path.relative_to(root))
        if label:
            items.append((path, label))
    return items


def write_manifest(root: Path, output: Path) -> dict[str, int]:
    items = find_labelled_images(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("image", "label"))
        writer.writerows((path.relative_to(root).as_posix(), label) for path, label in items)
    return {
        "images": len(items),
        "flood": sum(label == "flood" for _, label in items),
        "normal": sum(label == "normal" for _, label in items),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a FloodNet Track 1 CLIP evaluation manifest")
    parser.add_argument("--dataset", type=Path, required=True, help="Extracted FloodNet directory")
    parser.add_argument("--output", type=Path, required=True, help="Destination CSV")
    args = parser.parse_args()
    if not args.dataset.is_dir():
        print("--dataset must be an extracted FloodNet directory")
        return 2
    counts = write_manifest(args.dataset, args.output)
    if not counts["images"]:
        print("No labelled FloodNet Track 1 images found")
        return 2
    print(counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
