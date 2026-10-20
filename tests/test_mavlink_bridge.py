import json
import socket
import unittest

import mavlink_bridge as mb
import mission_model as mm

try:
    from pymavlink import mavutil
except ImportError:  # optional dependency
    mavutil = None


def sample_state(t=40.0):
    mission = mm.load_mission()
    return mission, mm.state_at(mission, mm.build_timeline(mission), t)


def copy(cfg):
    return json.loads(json.dumps(cfg))


class ConfigSafetyTests(unittest.TestCase):
    def setUp(self):
        self.cfg = mb.load_config()

    def test_default_config_is_telemetry_only(self):
        self.assertEqual(self.cfg["mode"], "telemetry")
        self.assertFalse(self.cfg["sitl"]["enabled"])
        self.assertFalse(mb.commands_allowed(self.cfg, cli_flag=True))
        mb.validate_config(self.cfg)

    def test_commands_need_every_condition(self):
        cfg = copy(self.cfg)
        cfg["mode"], cfg["sitl"]["enabled"] = "sitl", True
        self.assertTrue(mb.commands_allowed(cfg, cli_flag=True))
        self.assertFalse(mb.commands_allowed(cfg, cli_flag=False))
        cfg["sitl"]["enabled"] = False
        self.assertFalse(mb.commands_allowed(cfg, cli_flag=True))
        cfg["sitl"]["enabled"], cfg["mode"] = True, "telemetry"
        self.assertFalse(mb.commands_allowed(cfg, cli_flag=True))

    def test_non_local_sitl_endpoint_is_refused(self):
        cfg = copy(self.cfg)
        cfg["mode"], cfg["sitl"]["enabled"] = "sitl", True
        cfg["sitl"]["endpoint"] = "udpout:192.168.1.50:14540"
        self.assertFalse(mb.commands_allowed(cfg, cli_flag=True))

    def test_controller_refuses_when_disabled(self):
        with self.assertRaises(mb.SafetyError):
            mb.SitlController(self.cfg, cli_flag=True)

    def test_invalid_port_rejected(self):
        cfg = copy(self.cfg)
        cfg["qgc"]["udp_port"] = 0
        with self.assertRaises(ValueError):
            mb.validate_config(cfg)


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.cfg = mb.load_config()

    def test_geo_conversion(self):
        home = self.cfg["home"]
        lat, lon = mb.sim_to_geo(home, 0, 0)
        self.assertEqual((lat, lon), (home["latitude_deg"], home["longitude_deg"]))
        north_lat, _ = mb.sim_to_geo(home, 0, -111.32)  # -z is north
        self.assertAlmostEqual(north_lat - lat, 0.001, places=6)
        _, east_lon = mb.sim_to_geo(home, 50, 0)
        self.assertGreater(east_lon, lon)

    def test_values_cover_required_fields(self):
        mission, state = sample_state()
        v = mb.telemetry_values(self.cfg, state, mission)
        for key in ("lat_e7", "lon_e7", "rel_alt_mm", "battery_pct", "mission_seq",
                    "people_detected", "packages_delivered"):
            self.assertIn(key, v)
        self.assertGreater(v["rel_alt_mm"], 0)
        self.assertTrue(0 <= v["battery_pct"] <= 100)

    def test_messages_never_arm_and_contain_no_commands(self):
        mission, state = sample_state()
        messages = mb.build_messages(self.cfg, state, mission, 1000)
        names = {name for name, _ in messages}
        self.assertFalse({"command_long", "command_int", "set_mode", "mission_item"} & names)
        heartbeat = dict(messages)["heartbeat"]
        self.assertEqual(heartbeat[2] & 128, 0)  # MAV_MODE_FLAG_SAFETY_ARMED not set
        self.assertTrue({"global_position_int", "sys_status", "mission_current", "named_value_int"} <= names)

    def test_event_messages_sent_once(self):
        mission = mm.load_mission()
        timeline = mm.build_timeline(mission)
        a = mm.state_at(mission, timeline, 0)
        b = mm.state_at(mission, timeline, timeline[0].duration + 1)  # loading -> takeoff
        first = mb.build_messages(self.cfg, b, mission, 0, previous=a)
        again = mb.build_messages(self.cfg, b, mission, 0, previous=b)
        self.assertIn("statustext", {n for n, _ in first})
        self.assertNotIn("statustext", {n for n, _ in again})

    def test_delivery_and_detection_announced(self):
        mission = mm.load_mission()
        timeline = mm.build_timeline(mission)
        detect = next(s for s in timeline if s.phase == "detect")
        before = mm.state_at(mission, timeline, detect.start_time + 1)
        after = mm.state_at(mission, timeline, detect.start_time + detect.duration + 0.5)
        texts = [a[1].decode() for n, a in mb.build_messages(self.cfg, after, mission, 0, previous=before)
                 if n == "statustext"]
        self.assertTrue(any("people detected" in t for t in texts))
        self.assertTrue(all("[SIM]" in t for t in texts))

    def test_mission_item_reached_when_sequence_advances(self):
        mission = mm.load_mission()
        timeline = mm.build_timeline(mission)
        takeoff = next(s for s in timeline if s.phase == "takeoff")
        before = mm.state_at(mission, timeline, takeoff.start_time + 1)
        transit = next(s for s in timeline if s.phase == "transit")
        after = mm.state_at(mission, timeline, transit.start_time + 1)
        names = {n for n, _ in mb.build_messages(self.cfg, after, mission, 0, previous=before)}
        self.assertIn("mission_item_reached", names)


@unittest.skipIf(mavutil is None, "pymavlink not installed")
class UdpRoundTripTests(unittest.TestCase):
    def test_qgc_style_listener_receives_telemetry(self):
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        listener = mavutil.mavlink_connection(f"udpin:127.0.0.1:{port}")
        sender = mavutil.mavlink_connection(f"udpout:127.0.0.1:{port}", source_system=42, source_component=1)
        cfg = mb.load_config()
        mission, state = sample_state(60)
        mb.emit(sender, mb.build_messages(cfg, state, mission, 5000))
        seen = {}
        for _ in range(40):
            msg = listener.recv_match(blocking=True, timeout=1)
            if msg is None:
                break
            seen.setdefault(msg.get_type(), msg)
        self.assertIn("HEARTBEAT", seen)
        self.assertEqual(seen["HEARTBEAT"].get_srcSystem(), 42)
        self.assertIn("GLOBAL_POSITION_INT", seen)
        self.assertAlmostEqual(seen["GLOBAL_POSITION_INT"].lat / 1e7, cfg["home"]["latitude_deg"], delta=0.01)
        expected = mb.telemetry_values(cfg, state, mission)["battery_pct"]
        self.assertEqual(seen["SYS_STATUS"].battery_remaining, expected)
        self.assertIn("NAMED_VALUE_INT", seen)


if __name__ == "__main__":
    unittest.main()
