"""Create an auditable manifest for an externally downloaded vision dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def image_files(folder: Path) -> list[Path]:
    return sorted(path for path in folder.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)


def relative_names(files: list[Path], root: Path) -> set[str]:
    return {str(path.relative_to(root)).replace("\\", "/").lower() for path in files}


def build_manifest(
    dataset_root: Path,
    *,
    name: str,
    version: str,
    source_url: str,
    license_name: str,
) -> dict:
    train_root = dataset_root / "train"
    validation_root = dataset_root / "val"
    if not train_root.is_dir() or not validation_root.is_dir():
        raise ValueError("dataset must contain train/ and val/ directories")

    train = image_files(train_root)
    validation = image_files(validation_root)
    overlap = sorted(relative_names(train, train_root) & relative_names(validation, validation_root))
    if overlap:
        raise ValueError(f"train/val filename overlap detected: {overlap[0]}")

    digest = hashlib.sha256()
    for path in train + validation:
        digest.update(str(path.relative_to(dataset_root)).replace("\\", "/").encode("utf-8"))
        digest.update(str(path.stat().st_size).encode("ascii"))

    return {
        "schema_version": 1,
        "dataset": name,
        "version": version,
        "source_url": source_url,
        "license": license_name,
        "root": str(dataset_root.resolve()),
        "train_images": len(train),
        "validation_images": len(validation),
        "split_overlap": 0,
        "inventory_sha256": digest.hexdigest(),
        "note": "Images remain external and are not committed to this repository.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Record dataset source, license, split and inventory")
    parser.add_argument("root", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--license", required=True, dest="license_name")
    parser.add_argument("--output", type=Path, default=Path("dataset_manifest.json"))
    args = parser.parse_args()
    try:
        manifest = build_manifest(
            args.root,
            name=args.name,
            version=args.version,
            source_url=args.source_url,
            license_name=args.license_name,
        )
    except ValueError as error:
        print(error)
        return 2
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
