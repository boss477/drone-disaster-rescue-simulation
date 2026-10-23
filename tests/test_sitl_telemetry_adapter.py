import json
import unittest
from types import SimpleNamespace

from sitl_telemetry_adapter import TelemetryAccumulator


def message(kind, **values):
    return SimpleNamespace(get_type=lambda: kind, **values)


class SitlTelemetryAdapterTests(unittest.TestCase):
    def test_position_converts_mavlink_units(self):
        state = TelemetryAccumulator()
        changed = state.update(message(
            "GLOBAL_POSITION_INT", lat=473977420, lon=85455940,
            alt=488250, relative_alt=20250, hdg=12345))
        self.assertTrue(changed)
        self.assertTrue(state.ready())
        self.assertAlmostEqual(state.snapshot()["latitude_deg"], 47.397742)
        self.assertAlmostEqual(state.snapshot()["longitude_deg"], 8.545594)
        self.assertEqual(state.snapshot()["relative_altitude_m"], 20.25)
        self.assertEqual(state.snapshot()["heading_deg"], 123.45)

    def test_invalid_heading_is_not_exposed(self):
        state = TelemetryAccumulator()
        state.update(message("GLOBAL_POSITION_INT", lat=1, lon=2, alt=3, relative_alt=4, hdg=65535))
        self.assertIsNone(state.snapshot()["heading_deg"])

    def test_status_and_heartbeat(self):
        state = TelemetryAccumulator()
        state.update(message("SYS_STATUS", battery_remaining=77))
        state.update(message("GPS_RAW_INT", fix_type=3, satellites_visible=12))
        state.update(message("HEARTBEAT", base_mode=128), lambda _: "AUTO_MISSION")
        snapshot = state.snapshot()
        self.assertEqual(snapshot["battery_percent"], 77)
        self.assertEqual(snapshot["gps_fix_type"], 3)
        self.assertEqual(snapshot["satellites_visible"], 12)
        self.assertTrue(snapshot["armed"])
        self.assertEqual(snapshot["flight_mode"], "AUTO_MISSION")

    def test_snapshot_is_strict_json_compatible(self):
        encoded = json.dumps(TelemetryAccumulator().snapshot(), allow_nan=False)
        self.assertIn('"simulation_only": true', encoded)


if __name__ == "__main__":
    unittest.main()
