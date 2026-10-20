"""Zero-shot disaster scene classifier (CLIP) with a CLI.

    py disaster_zero_shot.py samples/flood_street.jpg
    py disaster_zero_shot.py path/to/folder --csv predictions.csv

Results are AI estimates only. The pretrained CLIP model is downloaded on first
use into ``models/hf_cache`` (inside this repository) and reused afterwards.
Heavy libraries (torch, open_clip) are imported lazily so the helpers below can
be imported and tested without them.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import os
import sys
from pathlib import Path
from typing import Iterable, Optional

PROJECT_DIR = Path(__file__).resolve().parent
CACHE_DIR = PROJECT_DIR / "models" / "hf_cache"
# Keep the model cache inside the repository unless the user chose their own.
os.environ.setdefault("HF_HOME", str(CACHE_DIR))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

LABELS = (
    "flood scene",
    "fire scene",
    "earthquake damaged building",
    "landslide scene",
    "storm damage scene",
    "normal scene",
)
MODEL_NAME = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"
HF_REPO = "laion/CLIP-ViT-B-32-laion2B-s34B-b79K"
HF_FILES = ("open_clip_model.safetensors", "open_clip_pytorch_model.bin")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# A prediction is "uncertain" when the top score is low or the runner-up is close.
MIN_CONFIDENCE = 0.40
MIN_MARGIN = 0.10

AI_DISCLAIMER = "AI estimate only - not a verified emergency decision. Human verification required."
REQUIRED_PACKAGES = (
    ("numpy", "numpy"),
    ("PIL", "Pillow"),
    ("torch", "torch"),
    ("open_clip", "open_clip_torch"),
)


class ModelUnavailableError(RuntimeError):
    """Raised with a user-friendly message when the model cannot be used."""


# ---------------------------------------------------------------- helpers ---

def check_dependencies() -> list[str]:
    """Return the pip names of required packages that are not installed."""
    return [pip for module, pip in REQUIRED_PACKAGES if importlib.util.find_spec(module) is None]


def dependency_message(missing: Iterable[str]) -> str:
    return (
        "Missing Python packages: " + ", ".join(missing) + ".\n"
        "Run  ./setup.ps1  (Windows) or  py -m pip install -r requirements-demo.txt"
    )


def model_is_cached() -> bool:
    """True if the CLIP weights already exist in the local Hugging Face cache."""
    try:
        from huggingface_hub import try_to_load_from_cache
    except Exception:
        return False
    for filename in HF_FILES:
        try:
            cached = try_to_load_from_cache(HF_REPO, filename, cache_dir=Path(os.environ["HF_HOME"]) / "hub")
        except Exception:
            cached = None
        if isinstance(cached, str):
            return True
    return False


def not_cached_message() -> str:
    return (
        "The pretrained CLIP model is not downloaded yet.\n"
        "It will be downloaded once (roughly 600 MB, internet required) into:\n"
        f"  {CACHE_DIR}\n"
        "Later runs reuse that folder and work offline."
    )


def load_image(path: str | Path):
    """Open an image as an RGB PIL image (EXIF-rotated). Raises ValueError if unreadable."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    path = Path(path)
    if not path.is_file():
        raise ValueError(f"Image not found: {path}")
    try:
        with Image.open(path) as source:
            return ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(f"Cannot read image '{path.name}': {exc}") from exc


def rank_scores(scores: dict[str, float]) -> list[tuple[str, float]]:
    """Scores sorted from highest to lowest (ties keep label order)."""
    return sorted(scores.items(), key=lambda item: -item[1])


def is_uncertain(
    ranked: list[tuple[str, float]],
    min_confidence: float = MIN_CONFIDENCE,
    min_margin: float = MIN_MARGIN,
) -> bool:
    if not ranked:
        return True
    top = ranked[0][1]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    return top < min_confidence or (top - runner_up) < min_margin


def format_report(scores: dict[str, float]) -> str:
    ranked = rank_scores(scores)
    label, confidence = ranked[0]
    headline = "UNCERTAIN - closest match" if is_uncertain(ranked) else "Predicted category"
    lines = [f"{headline}: {label} ({confidence * 100:.1f}%)", "All category scores:"]
    lines += [f"  {name:<30} {value * 100:5.1f}%" for name, value in ranked]
    lines.append(AI_DISCLAIMER)
    return "\n".join(lines)


def find_images(source: Path) -> list[Path]:
    if source.is_dir():
        return sorted(p for p in source.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    return [source]


# --------------------------------------------------------------- detector ---

class ZeroShotDisasterDetector:
    LABELS = LABELS

    def __init__(self, allow_download: bool = True):
        missing = check_dependencies()
        if missing:
            raise ModelUnavailableError(dependency_message(missing))
        if not allow_download and not model_is_cached():
            raise ModelUnavailableError(not_cached_message() + "\nRe-run without --offline to download it.")
        import open_clip
        import torch

        torch.set_num_threads(4)
        try:
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                MODEL_NAME, pretrained=PRETRAINED
            )
        except Exception as exc:  # network or cache problems
            raise ModelUnavailableError(
                f"Could not load the CLIP model ({exc}).\n"
                "Check your internet connection for the first download, then try again."
            ) from exc
        self._torch = torch
        self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
        self.model.eval()
        with torch.inference_mode():
            self.text_features = self.model.encode_text(self.tokenizer(list(LABELS)))
            self.text_features /= self.text_features.norm(dim=-1, keepdim=True)

    def predict_scores_image(self, image) -> dict[str, float]:
        """Scores for an RGB PIL image."""
        tensor = self.preprocess(image).unsqueeze(0)
        with self._torch.inference_mode():
            features = self.model.encode_image(tensor)
            features /= features.norm(dim=-1, keepdim=True)
            scores = (100.0 * features @ self.text_features.T).softmax(dim=-1)[0]
        return {label: float(scores[i].item()) for i, label in enumerate(LABELS)}

    def predict_scores(self, frame) -> dict[str, float]:
        """Scores for a BGR OpenCV frame (kept for payload_app compatibility)."""
        from PIL import Image

        return self.predict_scores_image(Image.fromarray(frame[:, :, ::-1]))

    def predict(self, frame) -> tuple[str, float]:
        return rank_scores(self.predict_scores(frame))[0]


# -------------------------------------------------------------------- CLI ---

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Zero-shot disaster image classification (AI estimate)")
    parser.add_argument("path", nargs="?", help="Path to one image or a folder of images")
    parser.add_argument("--check", action="store_true", help="Check dependencies and the model cache, then exit")
    parser.add_argument("--download-model", action="store_true", help="Download and cache the CLIP model, then exit")
    parser.add_argument("--csv", type=Path, help="Also save predictions to this CSV file")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Never download the model; fail with a message if it is not cached",
    )
    return parser.parse_args(argv)


def run_setup_mode(args: argparse.Namespace) -> int:
    missing = check_dependencies()
    if missing:
        print(dependency_message(missing), file=sys.stderr)
        return 1
    print("Dependencies: OK")
    if model_is_cached():
        print("CLIP model: cached locally (works offline).")
    else:
        print(not_cached_message())
    if args.download_model:
        try:
            ZeroShotDisasterDetector()
        except ModelUnavailableError as exc:
            print(exc, file=sys.stderr)
            return 1
        print("CLIP model ready and cached.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if args.check or args.download_model:
        return run_setup_mode(args)
    if not args.path:
        print("Give an image or folder path, e.g.  py disaster_zero_shot.py samples/flood_street.jpg", file=sys.stderr)
        return 2
    source = Path(args.path)
    images = find_images(source)
    if not images or (not source.is_dir() and not source.exists()):
        print(f"No supported images found in: {source}", file=sys.stderr)
        return 2

    missing = check_dependencies()
    if missing:
        print(dependency_message(missing), file=sys.stderr)
        return 1
    if not model_is_cached():
        print(not_cached_message())
        if args.offline:
            print("--offline given: not downloading.", file=sys.stderr)
            return 1
        print("Downloading now (first use only)...")
    try:
        detector = ZeroShotDisasterDetector(allow_download=not args.offline)
    except ModelUnavailableError as exc:
        print(exc, file=sys.stderr)
        return 1

    rows = []
    for image_path in images:
        try:
            scores = detector.predict_scores_image(load_image(image_path))
        except ValueError as exc:
            print(f"SKIP {exc}", file=sys.stderr)
            continue
        ranked = rank_scores(scores)
        rows.append((image_path, ranked, is_uncertain(ranked)))
        print(f"\n== {image_path} ==")
        print(format_report(scores))

    if args.csv and rows:
        with args.csv.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["image", "prediction", "confidence", "uncertain", *LABELS])
            for image_path, ranked, uncertain in rows:
                lookup = dict(ranked)
                writer.writerow(
                    [str(image_path), ranked[0][0], f"{ranked[0][1]:.4f}", uncertain]
                    + [f"{lookup[label]:.4f}" for label in LABELS]
                )
        print(f"\nPredictions saved to: {args.csv}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
