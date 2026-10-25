"""Verify real OpenDroneMap outputs: existence, size, path and basic file signatures.

    py verify_odm_outputs.py --project-dir D:\\DroneRescueData\\odm\\brighton_beach

Checks the four products this project needs: orthophoto GeoTIFF, DSM GeoTIFF,
georeferenced point cloud (LAZ or PLY) and textured OBJ model. Exit code 0 only
when all four exist, are non-trivial and look like the right file type.
Sample imagery is not live disaster data.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

# product -> (description, candidate relative paths in preference order)
PRODUCTS = {
    "orthophoto": ("Orthophoto GeoTIFF", ["odm_orthophoto/odm_orthophoto.tif"]),
    "dsm": ("DSM / elevation GeoTIFF", ["odm_dem/dsm.tif"]),
    "point_cloud": ("Georeferenced point cloud (LAZ/PLY)", [
        "odm_georeferencing/odm_georeferenced_model.laz",
        "odm_georeferencing/odm_georeferenced_model.ply",
        "odm_filterpoints/point_cloud.ply",
    ]),
    "textured_model": ("Textured 3D OBJ model", [
        "odm_texturing/odm_textured_model_geo.obj",
        "odm_texturing/odm_textured_model.obj",
    ]),
}
MIN_BYTES = 1024
TIFF_MAGIC = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")


def signature_ok(kind: str, path: Path) -> tuple[bool, str]:
    """Cheap content check so an empty or wrong file is not reported as a product."""
    with path.open("rb") as handle:
        head = handle.read(4096)
    if kind in ("orthophoto", "dsm"):
        return head[:4] in TIFF_MAGIC, "TIFF header"
    if kind == "point_cloud":
        if path.suffix.lower() == ".laz":
            return head[:4] == b"LASF", "LASF header"
        return head[:3] == b"ply", "PLY header"
    text = head.decode("utf-8", errors="ignore")
    return ("\nv " in "\n" + text) or ("mtllib" in text), "OBJ vertices/material reference"


def find_product(project_dir: Path, candidates: list[str]) -> Optional[Path]:
    for relative in candidates:
        path = project_dir / relative
        if path.is_file():
            return path
    return None


def verify(project_dir: Path, min_bytes: int = MIN_BYTES) -> dict:
    results = {}
    for kind, (description, candidates) in PRODUCTS.items():
        path = find_product(project_dir, candidates)
        entry = {"description": description, "expected": [str(project_dir / c) for c in candidates],
                 "exists": path is not None, "path": str(path) if path else None, "size_bytes": 0,
                 "signature_ok": False, "ok": False}
        if path:
            entry["size_bytes"] = path.stat().st_size
            if entry["size_bytes"] >= min_bytes:
                entry["signature_ok"], _ = signature_ok(kind, path)
            entry["ok"] = entry["size_bytes"] >= min_bytes and entry["signature_ok"]
        results[kind] = entry
    return {"project_dir": str(project_dir), "all_ok": all(e["ok"] for e in results.values()), "products": results}


def human(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return str(size)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify OpenDroneMap output files")
    parser.add_argument("--project-dir", type=Path, required=True, help="ODM project folder (contains odm_orthophoto/ etc.)")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    parser.add_argument("--min-bytes", type=int, default=MIN_BYTES)
    args = parser.parse_args()
    if not args.project_dir.is_dir():
        print(f"Project folder not found: {args.project_dir}")
        return 2
    report = verify(args.project_dir, args.min_bytes)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"ODM project: {report['project_dir']}")
        for entry in report["products"].values():
            status = "OK     " if entry["ok"] else ("INVALID" if entry["exists"] else "MISSING")
            where = entry["path"] or entry["expected"][0]
            size = human(entry["size_bytes"]) if entry["exists"] else "-"
            print(f"[{status}] {entry['description']}: {where} ({size})")
        print("All four products present." if report["all_ok"] else "Some products are missing or invalid.")
        print("Note: sample imagery is not live disaster data.")
    return 0 if report["all_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
