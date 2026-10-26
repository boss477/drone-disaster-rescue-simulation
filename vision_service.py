"""Shared, lazy CLIP + YOLO inference for the local rescue dashboard."""
import io
import os
import threading
import time
from pathlib import Path

# Use ordinary HTTPS downloads: Xet transfer stalls on this Windows setup.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")


class VisionService:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"status": "idle"}
        self.classifier = None
        self.people_model = None

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, image_bytes):
        # Validate before accepting a job; keep uploaded images in memory only.
        from PIL import Image, ImageOps
        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.width * source.height > 20_000_000:
                raise ValueError("Image must be at most 20 megapixels.")
            image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((1600, 1600))
        with self.lock:
            if self.state["status"] == "running":
                return False
            self.state = {"status": "running", "message": "Loading cached models; first use may download CLIP and YOLO."}
        threading.Thread(target=self._run, args=(image,), daemon=True).start()
        return True

    def _run(self, image):
        started = time.monotonic()
        result = {"width": image.width, "height": image.height, "boxes": [], "errors": {}}
        try:
            from disaster_zero_shot import ZeroShotDisasterDetector, rank_scores, is_uncertain
            if self.classifier is None:
                self.classifier = ZeroShotDisasterDetector()
            scores = self.classifier.predict_scores_image(image)
            ranked = rank_scores(scores)
            result["disaster"] = {"category": "uncertain" if is_uncertain(ranked) else ranked[0][0],
                                  "confidence": ranked[0][1], "scores": dict(ranked)}
        except Exception as exc:
            result["errors"]["disaster"] = str(exc)
        with self.lock:
            self.state["message"] = "Detecting possible people in the same image…"
        try:
            from ultralytics import YOLO
            if self.people_model is None:
                root = Path(os.environ.get("DRONE_RESCUE_DATA_ROOT", Path(__file__).resolve().parent))
                weights = root / "models" / "yolov8n.pt"
                weights.parent.mkdir(parents=True, exist_ok=True)
                self.people_model = YOLO(str(weights))
            prediction = self.people_model(image, classes=[0], conf=0.35, verbose=False)[0]
            result["boxes"] = [{"xyxy": box, "confidence": conf} for box, conf in
                               zip(prediction.boxes.xyxy.cpu().tolist(), prediction.boxes.conf.cpu().tolist())]
            result["people_count"] = len(result["boxes"])
        except Exception as exc:
            result["errors"]["people"] = str(exc)
        result["elapsed_seconds"] = round(time.monotonic() - started, 2)
        result["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        result["ai_estimate"] = True
        with self.lock:
            self.state = {"status": "complete", "result": result}
