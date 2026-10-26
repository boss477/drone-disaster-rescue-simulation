import io
import threading
import unittest
from unittest.mock import patch

from PIL import Image
from vision_service import VisionService


class VisionServiceTests(unittest.TestCase):
    def image_bytes(self):
        buffer = io.BytesIO()
        Image.new('RGB', (32, 20), 'blue').save(buffer, format='PNG')
        return buffer.getvalue()

    def test_invalid_image_does_not_start_job(self):
        service = VisionService()
        with self.assertRaises(Exception):
            service.start(b'not an image')
        self.assertEqual(service.snapshot()['status'], 'idle')

    def test_concurrent_review_is_rejected(self):
        service = VisionService()
        entered = threading.Event()
        release = threading.Event()
        def work(image):
            entered.set()
            release.wait(2)
        with patch.object(service, '_run', side_effect=work):
            self.assertTrue(service.start(self.image_bytes()))
            self.assertTrue(entered.wait(1))
            self.assertFalse(service.start(self.image_bytes()))
            release.set()

    def test_classifier_failure_preserves_person_detection(self):
        service = VisionService()
        class Boxes:
            def cpu(self): return self
            def tolist(self): return []
        class Prediction:
            class boxes:
                xyxy = Boxes()
                conf = Boxes()
        service.people_model = lambda *args, **kwargs: [Prediction()]
        with patch('disaster_zero_shot.ZeroShotDisasterDetector', side_effect=RuntimeError('offline')):
            service._run(Image.new('RGB', (32, 20)))
        result = service.snapshot()['result']
        self.assertEqual(result['people_count'], 0)
        self.assertEqual(result['errors'], {'disaster': 'offline'})
        self.assertTrue(result['ai_estimate'])
