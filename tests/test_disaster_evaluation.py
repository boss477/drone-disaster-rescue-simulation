import unittest

import evaluate_disaster_dataset as evaluator


class DisasterEvaluationTests(unittest.TestCase):
    def test_short_labels_are_canonicalized(self):
        self.assertEqual(evaluator.canonical_label("flood"), "flood scene")
        self.assertEqual(evaluator.canonical_label("normal"), "normal scene")
        with self.assertRaises(ValueError):
            evaluator.canonical_label("unknown")

    def test_summary_contains_accuracy_support_and_confusion(self):
        summary = evaluator.summarize(
            [("flood scene", "flood scene"), ("flood scene", "normal scene"),
             ("normal scene", "normal scene")],
            1.5,
        )
        self.assertEqual(summary["images"], 3)
        self.assertAlmostEqual(summary["accuracy"], 2 / 3)
        self.assertEqual(summary["support"]["flood scene"], 2)
        self.assertEqual(summary["confusion_matrix"]["flood scene"]["normal scene"], 1)


if __name__ == "__main__":
    unittest.main()
