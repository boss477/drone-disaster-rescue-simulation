import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import verify_odm_outputs as vo

ROOT = Path(__file__).resolve().parent.parent
LARGE_SUFFIXES = (".tif", ".tiff", ".laz", ".las", ".ply", ".obj", ".mtl", ".jpg.zip")


def make_project(base: Path, *, skip=()):
    files = {
        "orthophoto": ("odm_orthophoto/odm_orthophoto.tif", b"II*\x00" + b"0" * 2000),
        "dsm": ("odm_dem/dsm.tif", b"MM\x00*" + b"0" * 2000),
        "point_cloud": ("odm_georeferencing/odm_georeferenced_model.laz", b"LASF" + b"0" * 2000),
        "textured_model": ("odm_texturing/odm_textured_model_geo.obj", b"mtllib x.mtl\nv 0 0 0\n" + b"v 1 1 1\n" * 200),
    }
    for kind, (relative, content) in files.items():
        if kind in skip:
            continue
        path = base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return base


class VerifyOutputsTests(unittest.TestCase):
    def test_complete_project_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = vo.verify(make_project(Path(tmp)))
        self.assertTrue(report["all_ok"])
        for entry in report["products"].values():
            self.assertTrue(entry["exists"])
            self.assertGreater(entry["size_bytes"], 1024)
            self.assertTrue(entry["path"])

    def test_missing_product_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = vo.verify(make_project(Path(tmp), skip=("dsm",)))
        self.assertFalse(report["all_ok"])
        self.assertFalse(report["products"]["dsm"]["exists"])
        self.assertTrue(report["products"]["orthophoto"]["ok"])

    def test_wrong_file_type_is_invalid(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = make_project(Path(tmp))
            (base / "odm_orthophoto/odm_orthophoto.tif").write_bytes(b"not a tiff" * 500)
            report = vo.verify(base)
        entry = report["products"]["orthophoto"]
        self.assertTrue(entry["exists"])
        self.assertFalse(entry["ok"])

    def test_ply_point_cloud_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = make_project(Path(tmp), skip=("point_cloud",))
            ply = base / "odm_georeferencing/odm_georeferenced_model.ply"
            ply.parent.mkdir(parents=True, exist_ok=True)
            ply.write_bytes(b"ply\nformat binary_little_endian 1.0\n" + b"0" * 2000)
            self.assertTrue(vo.verify(base)["products"]["point_cloud"]["ok"])

    def test_tiny_file_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = make_project(Path(tmp))
            (base / "odm_dem/dsm.tif").write_bytes(b"II*\x00")
            self.assertFalse(vo.verify(base)["products"]["dsm"]["ok"])


class ManifestAndRepoSafetyTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "odm_sample_dataset.json").read_text(encoding="utf-8"))

    def test_manifest_has_required_fields(self):
        for key in ("dataset_name", "source_url", "license", "download_date", "image_count",
                    "expected_dataset_root", "expected_images_dir"):
            self.assertIn(key, self.manifest)
        self.assertEqual(self.manifest["image_count"], 18)
        self.assertTrue(self.manifest["expected_dataset_root"].startswith("D:\\DroneRescueData\\odm"))
        self.assertIn("NOT live disaster data", self.manifest["purpose"])

    def test_launcher_refuses_repo_paths_and_validates_name(self):
        script = (ROOT / "run_open_dronemap.ps1").read_text(encoding="utf-8")
        self.assertIn("inside the repository", script)
        self.assertIn("ProjectName", script)
        self.assertIn("--dsm", script)
        self.assertIn("DryRun", script)

    def test_no_large_odm_products_tracked_by_git(self):
        try:
            tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                                     check=True).stdout.splitlines()
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("not a git checkout")
        for line in tracked:
            self.assertFalse(line.lower().endswith(LARGE_SUFFIXES), line)

    def test_gitignore_blocks_odm_products(self):
        text = (ROOT / ".gitignore").read_text(encoding="utf-8")
        for pattern in ("*.laz", "*.ply", "*.tif", "*.obj"):
            self.assertIn(pattern, text)


if __name__ == "__main__":
    unittest.main()
