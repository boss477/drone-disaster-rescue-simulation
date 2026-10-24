import csv
import tempfile
import unittest
from pathlib import Path

import build_floodnet_manifest as manifest


class FloodNetManifestTests(unittest.TestCase):
    def test_non_flooded_is_not_misclassified_as_flooded(self):
        self.assertEqual(manifest.floodnet_label(Path("Labeled/Non-Flooded/image/a.jpg")), "normal")
        self.assertEqual(manifest.floodnet_label(Path("Labeled/Flooded/image/b.jpg")), "flood")

    def test_writes_only_labelled_image_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            flooded = root / "Train" / "Labeled" / "Flooded" / "image" / "a.jpg"
            normal = root / "Train" / "Labeled" / "Non-Flooded" / "image" / "b.jpg"
            mask = root / "Train" / "Labeled" / "Flooded" / "mask" / "a.png"
            for path in (flooded, normal, mask):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            output = root / "manifest.csv"
            self.assertEqual(manifest.write_manifest(root, output), {"images": 2, "flood": 1, "normal": 1})
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([row["label"] for row in rows], ["flood", "normal"])


if __name__ == "__main__":
    unittest.main()
