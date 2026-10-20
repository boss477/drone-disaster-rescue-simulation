"""Small zero-shot disaster scene classifier for the demonstration."""

from __future__ import annotations

import cv2
import numpy as np
import open_clip
import torch
from PIL import Image
import argparse
import csv
from pathlib import Path


class ZeroShotDisasterDetector:
    LABELS = (
        "flood scene",
        "fire scene",
        "earthquake damaged building",
        "landslide scene",
        "storm damage scene",
        "normal scene",
    )

    def __init__(self):
        torch.set_num_threads(4)
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        self.tokenizer = open_clip.get_tokenizer("ViT-B-32")
        self.model.eval()
        with torch.inference_mode():
            tokens = self.tokenizer(list(self.LABELS))
            self.text_features = self.model.encode_text(tokens)
            self.text_features /= self.text_features.norm(dim=-1, keepdim=True)

    def predict(self, frame: np.ndarray) -> tuple[str, float]:
        scores = self.predict_scores(frame)
        return max(scores.items(), key=lambda item: item[1])

    def predict_scores(self, frame: np.ndarray) -> dict[str, float]:
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        image_tensor = self.preprocess(image).unsqueeze(0)
        with torch.inference_mode():
            image_features = self.model.encode_image(image_tensor)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            scores = (100.0 * image_features @ self.text_features.T).softmax(dim=-1)[0]
        return {label: float(scores[i].item()) for i, label in enumerate(self.LABELS)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test zero-shot disaster classification")
    parser.add_argument("path", help="Path to one image or a dataset folder")
    args = parser.parse_args()
    source = Path(args.path)
    if source.is_dir():
        images = sorted(
            path for path in source.rglob("*")
            if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        )
    else:
        images = [source]
    if not images:
        raise SystemExit(f"No supported images found in: {source}")
    detector = ZeroShotDisasterDetector()
    output_csv = source / "zero_shot_predictions.csv" if source.is_dir() else source.with_name("zero_shot_predictions.csv")
    with output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["image", "prediction", "confidence"])
        for image_path in images:
            frame = cv2.imread(str(image_path))
            if frame is None:
                print(f"SKIP unreadable: {image_path}")
                continue
            label, confidence = detector.predict(frame)
            writer.writerow([str(image_path), label, f"{confidence:.4f}"])
            print(f"{image_path.name}: {label} ({confidence * 100:.1f}%)")
    print(f"Predictions saved to: {output_csv}")
    print("AI estimate only - human verification required")
