import unittest

from mock_sitl_vehicle import HOME_LAT, TARGET_NORTH_M, trajectory


class MockSitlVehicleTests(unittest.TestCase):
    def test_starts_at_home(self):
        pose = trajectory(0)
        self.assertEqual(pose.latitude_deg, HOME_LAT)
        self.assertEqual(pose.relative_altitude_m, 0)

    def test_reaches_500_metre_target_and_holds(self):
        pose = trajectory(20)
        north = (pose.latitude_deg - HOME_LAT) * 111320
        self.assertAlmostEqual(north, TARGET_NORTH_M, places=3)
        self.assertEqual(pose.mode, "HOLD")

    def test_returns_and_lands(self):
        returning = trajectory(37)
        landed = trajectory(47.999)
        self.assertLess(returning.latitude_deg, trajectory(20).latitude_deg)
        self.assertAlmostEqual(landed.latitude_deg, HOME_LAT, places=7)
        self.assertLess(landed.relative_altitude_m, 0.02)


if __name__ == "__main__":
    unittest.main()
