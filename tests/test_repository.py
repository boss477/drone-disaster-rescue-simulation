"""Repository hygiene: relative paths, no large model files, runtime files present."""

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {".py", ".ps1", ".sh", ".html", ".js", ".json", ".md", ".txt", ".css"}
SKIP_DIRS = {".git", "vendor", ".venv", "__pycache__", "hf_cache", "inspection_reports"}


def project_files():
    for path in ROOT.rglob("*"):
        if path.is_file() and not set(path.relative_to(ROOT).parts) & SKIP_DIRS:
            yield path


class RepositoryTests(unittest.TestCase):
    def test_no_absolute_local_paths(self):
        pattern = re.compile(r"[A-Za-z]:\\+(Users|Windows)|/Users/\w+")
        for path in project_files():
            if path.suffix in TEXT_SUFFIXES and path.name != "test_repository.py":
                text = path.read_text(encoding="utf-8", errors="ignore")
                self.assertIsNone(pattern.search(text), path)

    def test_simulation_references_only_repository_files(self):
        html = (ROOT / "rescue_simulation.html").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r'(src|href)="(https?:|file:|/)', html))
        js = (ROOT / "sim" / "main.js").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"from '(https?:|/)", js))

    def test_vendored_three_is_complete(self):
        for name in ("three.module.js", "three.core.js"):
            self.assertTrue((ROOT / "vendor" / name).is_file(), name)

    def test_required_files_exist(self):
        for name in ("setup.ps1", "run_all_demo.ps1", "requirements-demo.txt", "requirements-mavlink.txt",
                     "mavlink_config.json", "start_visual_sim.ps1", "start_mavlink_bridge.ps1",
                     "start_sitl.ps1", "start_sitl_telemetry.ps1", "sitl_telemetry_adapter.py",
                     "start_mock_sitl.ps1", "mock_sitl_vehicle.py", "models/README.md"):
            self.assertTrue((ROOT / name).is_file(), name)

    def test_live_operations_map_is_present_and_labelled(self):
        page = (ROOT / "live_operations.html").read_text(encoding="utf-8")
        script = (ROOT / "live_operations.js").read_text(encoding="utf-8")
        self.assertIn("SIMULATION", page)
        self.assertIn("eonet.gsfc.nasa.gov", script)
        self.assertIn("api.open-meteo.com", script)
        self.assertTrue((ROOT / "run_live_operations.ps1").is_file())

    def test_operator_controlled_earth_mission_is_present(self):
        page = (ROOT / "earth_rescue.html").read_text(encoding="utf-8")
        script = (ROOT / "earth_rescue.js").read_text(encoding="utf-8")
        for control in ("approveRelease", "abortMission", "confirmTarget", "downloadLog", "flightSource", "replayFile"):
            self.assertIn(f'id="{control}"', page)
        self.assertIn("operator_release_approved", script)
        self.assertIn("sessionStorage", script)
        self.assertNotIn("tile.googleapis.com", script)
        self.assertIn("/api/autopilot", script)
        self.assertIn("samples.push", script)
        self.assertIn("startReplay", script)
        self.assertTrue((ROOT / "run_earth_rescue.ps1").is_file())

    def test_model_weights_not_tracked_by_git(self):
        try:
            tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                                     check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("not a git checkout")
        for line in tracked.splitlines():
            self.assertFalse(line.endswith((".pth", ".pt", ".onnx", ".safetensors", ".bin")), line)

    def test_gitignore_keeps_models_out(self):
        text = (ROOT / ".gitignore").read_text()
        for entry in ("models/*.pth", "models/hf_cache/"):
            self.assertIn(entry, text)


if __name__ == "__main__":
    unittest.main()
