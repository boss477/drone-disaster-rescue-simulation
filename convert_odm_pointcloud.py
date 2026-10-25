"""Convert a georeferenced ODM LAZ file to Cesium point-cloud 3D Tiles.

Install requirements-odm-pointcloud.txt into a separate environment first.
The output stays beside the survey files, outside this repository.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def convert_project(project_dir: Path) -> Path:
    project_dir = project_dir.resolve()
    repo_dir = Path(__file__).resolve().parent
    if project_dir == repo_dir or repo_dir in project_dir.parents:
        raise ValueError("ODM products must stay outside the repository")
    source = project_dir / "odm_georeferencing" / "odm_georeferenced_model.laz"
    if not source.is_file():
        raise FileNotFoundError(f"Georeferenced point cloud not found: {source}")
    destination = project_dir / "pointcloud_tiles"
    tileset = destination / "tileset.json"
    if tileset.is_file():
        return tileset
    if destination.exists():
        raise FileExistsError(f"Incomplete output directory: {destination}; inspect it before retrying")
    try:
        import laspy
        from py3dtiles.convert import convert
        from pyproj import CRS
    except ImportError as exc:
        raise RuntimeError(
            "Install optional dependencies: py -m pip install -r requirements-odm-pointcloud.txt"
        ) from exc
    with laspy.open(source) as reader:
        source_crs = reader.header.parse_crs()
    if source_crs is None:
        raise ValueError(f"LAZ has no coordinate reference system: {source}")
    convert(source, outfolder=destination, crs_in=source_crs,
            crs_out=CRS.from_epsg(4978), color_scale=256, jobs=4)
    if not tileset.is_file():
        raise RuntimeError(f"Point-cloud conversion did not produce {tileset}")
    return tileset


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(f"Point-cloud 3D Tiles: {convert_project(args.project_dir)}")
    except (ValueError, FileNotFoundError, FileExistsError, RuntimeError) as exc:
        parser.exit(1, f"{exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
