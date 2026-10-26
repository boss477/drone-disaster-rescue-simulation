"""Shared, lazy CLIP + YOLO inference for the local rescue dashboard."""
import io
import hashlib
import os
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Use ordinary HTTPS downloads: Xet transfer stalls on this Windows setup.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "5")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "30")


class VisionService:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"status": "idle"}
        self.classifier = None
        self.people_model = None
        self.last_image_key = None

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, image_bytes):
        image_key = hashlib.sha256(image_bytes).hexdigest()
        with self.lock:
            if self.state['status'] == 'running':
                return False
            if image_key == self.last_image_key and not self.state.get('result', {}).get('errors'):
                return True
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
            self.last_image_key = image_key
        threading.Thread(target=self._run, args=(image,), daemon=True).start()
        return True

    def _run(self, image):
        started = time.monotonic()
        result = {"width": image.width, "height": image.height, "boxes": [], "errors": {}}
        def classify():
            from disaster_zero_shot import ZeroShotDisasterDetector, rank_scores, is_uncertain
            if self.classifier is None:
                self.classifier = ZeroShotDisasterDetector()
            scores = self.classifier.predict_scores_image(image)
            ranked = rank_scores(scores)
            return {"disaster": {"category": "uncertain" if is_uncertain(ranked) else ranked[0][0],
                                  "confidence": ranked[0][1], "scores": dict(ranked)}}
        def detect():
            from ultralytics import YOLO
            if self.people_model is None:
                root = Path(os.environ.get("DRONE_RESCUE_DATA_ROOT", Path(__file__).resolve().parent))
                weights = root / "models" / "yolov8n.pt"
                weights.parent.mkdir(parents=True, exist_ok=True)
                self.people_model = YOLO(str(weights))
            prediction = self.people_model(image, classes=[0], conf=0.35, imgsz=640, verbose=False)[0]
            boxes = [{"xyxy": box, "confidence": conf} for box, conf in
                               zip(prediction.boxes.xyxy.cpu().tolist(), prediction.boxes.conf.cpu().tolist())]
            return {"boxes": boxes, "people_count": len(boxes)}
        # Independent models: a slow CLIP download must not hold up YOLO.
        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = {workers.submit(classify): 'disaster', workers.submit(detect): 'people'}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    result.update(future.result())
                except Exception as exc:
                    result['errors'][name] = str(exc)
                with self.lock:
                    self.state['message'] = f'{name.capitalize()} analysis finished; waiting for the other model…'
                    self.state['partial'] = dict(result)
        result["elapsed_seconds"] = round(time.monotonic() - started, 2)
        result["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        result["ai_estimate"] = True
        with self.lock:
            self.state = {"status": "complete", "result": result}
