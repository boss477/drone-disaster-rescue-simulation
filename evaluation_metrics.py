"""Dependency-free detection metrics used by the aerial-person evaluator."""

from __future__ import annotations

from dataclasses import dataclass

Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class DetectionMetrics:
    true_positive: int
    false_positive: int
    false_negative: int

    @property
    def precision(self) -> float:
        total = self.true_positive + self.false_positive
        return self.true_positive / total if total else 0.0

    @property
    def recall(self) -> float:
        total = self.true_positive + self.false_negative
        return self.true_positive / total if total else 0.0


def intersection_over_union(a: Box, b: Box) -> float:
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union else 0.0


def match_detections(predictions: list[Box], truth: list[Box], threshold: float = 0.5) -> DetectionMetrics:
    """Greedily match each prediction to one unused ground-truth box."""
    unmatched = set(range(len(truth)))
    true_positive = 0
    for prediction in predictions:
        best = max(unmatched, key=lambda index: intersection_over_union(prediction, truth[index]), default=None)
        if best is not None and intersection_over_union(prediction, truth[best]) >= threshold:
            unmatched.remove(best)
            true_positive += 1
    return DetectionMetrics(true_positive, len(predictions) - true_positive, len(unmatched))
