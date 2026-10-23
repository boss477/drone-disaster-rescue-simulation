import tempfile
import unittest
from pathlib import Path

from dataset_manifest import build_manifest


class DatasetManifestTests(unittest.TestCase):
    def test_counts_images_and_records_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "train").mkdir()
            (root / "val").mkdir()
            (root / "train" / "a.jpg").write_bytes(b"train")
            (root / "val" / "b.png").write_bytes(b"validation")
            manifest = build_manifest(root, name="Demo", version="1", source_url="https://example.test", license_name="test")
            self.assertEqual(manifest["train_images"], 1)
            self.assertEqual(manifest["validation_images"], 1)
            self.assertEqual(manifest["split_overlap"], 0)
            self.assertEqual(len(manifest["inventory_sha256"]), 64)

    def test_rejects_same_relative_image_name_in_both_splits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "train").mkdir()
            (root / "val").mkdir()
            (root / "train" / "same.jpg").write_bytes(b"one")
            (root / "val" / "same.jpg").write_bytes(b"two")
            with self.assertRaisesRegex(ValueError, "overlap"):
                build_manifest(root, name="Demo", version="1", source_url="x", license_name="x")

    def test_requires_train_and_validation_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "train/ and val/"):
                build_manifest(Path(folder), name="Demo", version="1", source_url="x", license_name="x")


if __name__ == "__main__":
    unittest.main()
