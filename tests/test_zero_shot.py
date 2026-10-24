"""Tests for the zero-shot classifier helpers (no torch / CLIP download needed)."""

import tempfile
import unittest
from pathlib import Path

import disaster_zero_shot as dz

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


@unittest.skipIf(Image is None, "Pillow not installed")
class ImageLoadingTests(unittest.TestCase):
    def test_loads_rgb_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.png"
            Image.new("RGBA", (8, 6), (255, 0, 0, 128)).save(path)
            image = dz.load_image(path)
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.size, (8, 6))

    def test_missing_file_raises_value_error(self):
        with self.assertRaises(ValueError):
            dz.load_image("definitely_missing_image.jpg")

    def test_corrupt_file_raises_value_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.jpg"
            path.write_bytes(b"not an image")
            with self.assertRaises(ValueError):
                dz.load_image(path)

    def test_sample_image_loads(self):
        sample = dz.PROJECT_DIR / "samples" / "flood_street.jpg"
        self.assertEqual(dz.load_image(sample).mode, "RGB")


class ScoreOrderingTests(unittest.TestCase):
    def test_ranked_highest_first(self):
        ranked = dz.rank_scores({"a": 0.1, "b": 0.6, "c": 0.3})
        self.assertEqual([name for name, _ in ranked], ["b", "c", "a"])

    def test_report_lists_every_category_in_order_and_is_labelled(self):
        scores = {label: 0.01 for label in dz.LABELS}
        scores["flood scene"] = 0.95
        report = dz.format_report(scores)
        self.assertIn("Predicted category: flood scene (95.0%)", report)
        self.assertIn("AI estimate", report)
        positions = [report.index(label) for label, _ in dz.rank_scores(scores)]
        self.assertEqual(positions, sorted(positions))
        for label in dz.LABELS:
            self.assertIn(label, report)


class UncertainPredictionTests(unittest.TestCase):
    def test_confident_prediction(self):
        self.assertFalse(dz.is_uncertain(dz.rank_scores({"a": 0.8, "b": 0.15, "c": 0.05})))

    def test_low_confidence_is_uncertain(self):
        self.assertTrue(dz.is_uncertain(dz.rank_scores({"a": 0.3, "b": 0.2, "c": 0.2, "d": 0.299})))

    def test_close_runner_up_is_uncertain(self):
        self.assertTrue(dz.is_uncertain(dz.rank_scores({"a": 0.48, "b": 0.42, "c": 0.10})))

    def test_report_marks_uncertain(self):
        scores = {label: 1 / len(dz.LABELS) for label in dz.LABELS}
        self.assertIn("UNCERTAIN", dz.format_report(scores))

    def test_empty_is_uncertain(self):
        self.assertTrue(dz.is_uncertain([]))


class DependencyTests(unittest.TestCase):
    def test_missing_dependency_message_is_friendly(self):
        message = dz.dependency_message(["torch"])
        self.assertIn("torch", message)
        self.assertIn("setup.ps1", message)

    def test_not_cached_message_explains_first_use_download(self):
        message = dz.not_cached_message()
        self.assertIn("downloaded", message)
        self.assertIn("offline", message)

    def test_cache_dir_uses_configured_asset_root(self):
        self.assertEqual(dz.CACHE_DIR, dz.ASSET_ROOT / "models" / "hf_cache")


if __name__ == "__main__":
    unittest.main()
