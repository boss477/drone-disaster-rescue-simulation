import unittest

from evaluation_metrics import intersection_over_union, match_detections


class EvaluationMetricTests(unittest.TestCase):
    def test_iou(self):
        self.assertEqual(intersection_over_union((0, 0, 10, 10), (0, 0, 10, 10)), 1.0)
        self.assertEqual(intersection_over_union((0, 0, 2, 2), (3, 3, 5, 5)), 0.0)

    def test_one_truth_cannot_match_twice(self):
        result = match_detections([(0, 0, 10, 10), (0, 0, 10, 10)], [(0, 0, 10, 10)])
        self.assertEqual((result.true_positive, result.false_positive, result.false_negative), (1, 1, 0))

    def test_reports_missed_truth(self):
        result = match_detections([], [(0, 0, 10, 10)])
        self.assertEqual(result.false_negative, 1)


if __name__ == "__main__":
    unittest.main()
