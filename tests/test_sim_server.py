import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import sim_server


class SimServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = sim_server.SimState()
        cls.autopilot = sim_server.SimState()
        cls.server = sim_server.make_server(0, cls.state, cls.autopilot)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path):
        return urllib.request.urlopen(self.base + path, timeout=5)

    def test_binds_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_serves_page_and_runtime_files(self):
        self.assertEqual(self.get("/rescue_simulation.html").status, 200)
        for path in ("/sim/main.js", "/sim/mission.json", "/vendor/three.module.js", "/vendor/three.core.js",
                     "/earth_rescue.html", "/earth_rescue.js", "/earth_rescue_scene.js", "/earth_rescue.css"):
            self.assertEqual(self.get(path).status, 200, path)

    def test_private_folders_not_served(self):
        for path in ("/.git/config", "/models/README.md"):
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                self.get(path)
            self.assertEqual(ctx.exception.code, 404, path)

    def test_state_round_trip(self):
        self.assertIn("connected", json.load(self.get("/api/state")))
        request = urllib.request.Request(
            self.base + "/api/state", data=json.dumps({"phase": "transit"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        self.assertEqual(urllib.request.urlopen(request, timeout=5).status, 200)
        payload = json.load(self.get("/api/state"))
        self.assertTrue(payload["connected"])
        self.assertEqual(payload["state"]["phase"], "transit")

    def test_autopilot_state_is_separate(self):
        self.assertFalse(json.load(self.get("/api/autopilot"))["connected"])
        self.state.set({"phase": "main-channel"})
        state = {"latitude_deg": 47.4, "longitude_deg": 8.54, "relative_altitude_m": 20}
        request = urllib.request.Request(
            self.base + "/api/autopilot", data=json.dumps(state).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        self.assertEqual(urllib.request.urlopen(request, timeout=5).status, 200)
        payload = json.load(self.get("/api/autopilot"))
        self.assertTrue(payload["connected"])
        self.assertEqual(payload["state"]["relative_altitude_m"], 20)
        self.assertEqual(json.load(self.get("/api/state"))["state"]["phase"], "main-channel")

    def test_rejects_bad_state(self):
        request = urllib.request.Request(self.base + "/api/state", data=b"[1,2]", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(ctx.exception.code, 400)

    def test_vision_rejects_invalid_image(self):
        self.assertEqual(json.load(self.get('/api/vision'))['status'], 'idle')
        request = urllib.request.Request(self.base + '/api/vision', data=b'not an image', method='POST')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(ctx.exception.code, 400)

    def test_serves_external_odm_folder_without_exposing_parent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "odm"
            root.mkdir()
            (root / "manifest.json").write_text('{"name":"test"}', encoding="utf-8")
            outside = Path(temp) / "secret.txt"
            outside.write_text("private", encoding="utf-8")
            server = sim_server.make_server(0, odm_root=root)
            base = f"http://127.0.0.1:{server.server_address[1]}"
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                self.assertEqual(json.load(urllib.request.urlopen(base + "/odm-data/manifest.json"))["name"], "test")
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(base + "/odm-data/%2e%2e/secret.txt")
                self.assertEqual(ctx.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
