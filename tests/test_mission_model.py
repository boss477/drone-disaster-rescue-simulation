import unittest

import mission_model as mm


class MissionModelTests(unittest.TestCase):
    def setUp(self):
        self.mission = mm.load_mission()
        self.timeline = mm.build_timeline(self.mission)
        self.total = mm.total_duration(self.timeline)

    def test_phase_order(self):
        phases = [s.phase for s in self.timeline]
        self.assertEqual(phases[:2], ["loading", "takeoff"])
        self.assertEqual(phases[-2:], ["return", "landing"])
        self.assertEqual(phases.count("unload"), len(self.mission["sites"]))

    def test_slow_movement(self):
        self.assertLessEqual(self.mission["cruise_speed_mps"], 2.0)
        for t in (20, 40, 80):
            s = mm.state_at(self.mission, self.timeline, t)
            speed = sum(v * v for v in s["velocity"].values()) ** 0.5
            self.assertLessEqual(speed, 2.0)

    def test_starts_ready_and_loads_packages(self):
        s0 = mm.state_at(self.mission, self.timeline, 0)
        self.assertEqual((s0["phase"], s0["people_detected"], s0["packages_delivered"]), ("loading", 0, 0))
        loaded = mm.state_at(self.mission, self.timeline, self.timeline[0].duration)
        self.assertEqual(loaded["packages_loaded"], self.mission["packages_loaded"])

    def test_completion_counts(self):
        end = mm.state_at(self.mission, self.timeline, self.total + 100)
        self.assertTrue(end["complete"])
        self.assertEqual(end["phase"], "complete")
        self.assertEqual(end["packages_delivered"], len(self.mission["sites"]))
        self.assertEqual(end["people_detected"], sum(s["people"] for s in self.mission["sites"]))
        self.assertEqual(end["packages_onboard"], self.mission["packages_loaded"] - len(self.mission["sites"]))
        pos = end["position"]
        self.assertEqual((pos["x"], pos["z"]), (self.mission["base"]["x"], self.mission["base"]["z"]))

    def test_counts_never_decrease_and_battery_drains(self):
        last = None
        for i in range(0, int(self.total) + 2):
            s = mm.state_at(self.mission, self.timeline, i)
            if last:
                self.assertGreaterEqual(s["packages_delivered"], last["packages_delivered"])
                self.assertGreaterEqual(s["people_detected"], last["people_detected"])
                self.assertLessEqual(s["battery_percent"], last["battery_percent"])
            last = s

    def test_cruise_altitude_clears_rooftops(self):
        highest = max(s["roof_height"] for s in self.mission["sites"])
        self.assertGreater(self.mission["cruise_altitude_m"], highest)

    def test_state_is_marked_simulated(self):
        self.assertTrue(mm.state_at(self.mission, self.timeline, 10)["simulated"])


if __name__ == "__main__":
    unittest.main()
