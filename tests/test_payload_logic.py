import unittest

from payload_logic import DecisionConfig, TemporalDecisionEngine


class PayloadDecisionTests(unittest.TestCase):
    def setUp(self):
        self.engine = TemporalDecisionEngine(
            DecisionConfig(history_length=4, min_stable_samples=2)
        )

    def update(self, wall=0.9, crack=0.1, **overrides):
        values = {
            "person_present": False,
            "blur_score": 100.0,
            "brightness": 120.0,
            "wall_score": wall,
            "crack_score": crack,
        }
        values.update(overrides)
        return self.engine.update(**values)

    def test_person_always_pauses_and_resets(self):
        self.update()
        result = self.update(person_present=True)
        self.assertEqual(result.code, "person")
        self.assertEqual(len(self.engine.wall_history), 0)
        self.assertEqual(len(self.engine.crack_history), 0)

    def test_quality_gate_blocks_model_decision(self):
        result = self.update(blur_score=5.0)
        self.assertEqual(result.code, "blur")
        self.assertEqual(len(self.engine.wall_history), 0)

    def test_not_wall_after_stabilization(self):
        self.update(wall=0.1, crack=None)
        result = self.update(wall=0.1, crack=None)
        self.assertEqual(result.code, "not_wall")

    def test_crack_alert_after_stabilization(self):
        self.update(wall=0.95, crack=0.95)
        result = self.update(wall=0.95, crack=0.95)
        self.assertEqual(result.code, "crack")

    def test_safe_after_stabilization(self):
        self.update(wall=0.95, crack=0.05)
        result = self.update(wall=0.95, crack=0.05)
        self.assertEqual(result.code, "safe")

    def test_ambiguous_crack_requests_rescan(self):
        self.update(wall=0.95, crack=0.45)
        result = self.update(wall=0.95, crack=0.45)
        self.assertEqual(result.code, "crack_uncertain")


if __name__ == "__main__":
    unittest.main()
