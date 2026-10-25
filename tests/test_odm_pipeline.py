import json
import subprocess
import tempfile
import unittest
import shutil
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
    if "textured_model" not in skip:
        texture_dir = base / "odm_texturing"
        (texture_dir / "x.mtl").write_text("newmtl x\nmap_Kd texture.jpg\n", encoding="utf-8")
        (texture_dir / "texture.jpg").write_bytes(b"fake-jpeg-data")
    return base


def make_browser_products(base: Path):
    files = (
        "orthophoto_tiles/1/0/0.png",
        "dsm_tiles/1/0/0.png",
        "pointcloud_tiles/tileset.json",
        "3d_tiles/model/tileset.json",
        "odm_texturing/odm_textured_model_geo.glb",
    )
    for relative in files:
        path = base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"test")
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

    def test_textured_model_requires_material_and_texture(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = make_project(Path(tmp))
            (base / "odm_texturing/texture.jpg").unlink()
            self.assertFalse(vo.verify(base)["products"]["textured_model"]["ok"])

    def test_browser_ready_products_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = vo.verify(make_browser_products(make_project(Path(tmp))))
        self.assertTrue(report["browser_ready"])
        self.assertEqual(report["browser_products"]["orthophoto_tiles"]["file_count"], 1)


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
        self.assertIn("--tiles", script)
        self.assertIn("--3d-tiles", script)
        self.assertIn("--gltf", script)
        self.assertIn("DryRun", script)
        self.assertIn("DRONE_ODM_WSL_DISTRO", script)

    @unittest.skipUnless(shutil.which("powershell") or shutil.which("pwsh"), "PowerShell is unavailable")
    def test_launcher_dry_run_and_repo_path_refusal(self):
        shell = shutil.which("powershell") or shutil.which("pwsh")
        script = ROOT / "run_open_dronemap.ps1"
        rejected = subprocess.run([shell, "-NoProfile", "-File", script, "-DatasetRoot", ROOT,
                                   "-ProjectName", "test", "-DryRun"], capture_output=True, text=True)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("inside the repository", rejected.stderr + rejected.stdout)
        with tempfile.TemporaryDirectory() as tmp:
            images = Path(tmp) / "test" / "images"
            images.mkdir(parents=True)
            for index in range(3):
                (images / f"{index}.jpg").write_bytes(b"image")
            accepted = subprocess.run([shell, "-NoProfile", "-File", script, "-DatasetRoot", tmp,
                                       "-ProjectName", "test", "-DryRun"], capture_output=True, text=True)
        self.assertEqual(accepted.returncode, 0, accepted.stderr + accepted.stdout)
        self.assertIn("DRY RUN", accepted.stdout)

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
        self.assertIn("odm_data/", text)
        for pattern in ("*.laz", "*.ply", "*.tif", "*.obj"):
            self.assertNotIn(pattern, text)


if __name__ == "__main__":
    unittest.main()
