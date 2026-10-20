"""Decision logic for the UAV wall-crack payload.

This module has no camera or deep-learning dependencies, which makes the
safety/state rules easy to test independently from Raspberry Pi hardware.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional


@dataclass(frozen=True)
class DecisionConfig:
    history_length: int = 8
    min_stable_samples: int = 4
    wall_reject_threshold: float = 0.45
    wall_accept_threshold: float = 0.78
    crack_safe_threshold: float = 0.30
    crack_alert_threshold: float = 0.70
    blur_minimum: float = 45.0
    brightness_minimum: float = 35.0
    brightness_maximum: float = 225.0

    def validate(self) -> None:
        if self.history_length < 1:
            raise ValueError("history_length must be at least 1")
        if not 1 <= self.min_stable_samples <= self.history_length:
            raise ValueError("min_stable_samples must be within history_length")
        if not 0 <= self.wall_reject_threshold < self.wall_accept_threshold <= 1:
            raise ValueError("wall thresholds must satisfy 0 <= reject < accept <= 1")
        if not 0 <= self.crack_safe_threshold < self.crack_alert_threshold <= 1:
            raise ValueError("crack thresholds must satisfy 0 <= safe < alert <= 1")
        if not 0 <= self.brightness_minimum < self.brightness_maximum <= 255:
            raise ValueError("brightness thresholds must satisfy 0 <= min < max <= 255")


@dataclass(frozen=True)
class Decision:
    code: str
    message: str
    color_bgr: tuple[int, int, int]
    wall_score: Optional[float] = None
    crack_score: Optional[float] = None


GRAY = (150, 150, 150)
BLUE = (255, 170, 0)
AMBER = (0, 165, 255)
GREEN = (0, 210, 0)
RED = (0, 0, 255)


class TemporalDecisionEngine:
    """Turns noisy frame scores into conservative, stable inspection states."""

    def __init__(self, config: DecisionConfig):
        config.validate()
        self.config = config
        self.wall_history: Deque[float] = deque(maxlen=config.history_length)
        self.crack_history: Deque[float] = deque(maxlen=config.history_length)

    def reset(self) -> None:
        self.wall_history.clear()
        self.crack_history.clear()

    def update(
        self,
        *,
        person_present: bool,
        blur_score: float,
        brightness: float,
        wall_score: Optional[float],
        crack_score: Optional[float],
    ) -> Decision:
        cfg = self.config

        if person_present:
            self.reset()
            return Decision(
                "person",
                "PERSON DETECTED - INSPECTION PAUSED",
                AMBER,
            )

        if brightness < cfg.brightness_minimum:
            self.crack_history.clear()
            return Decision("low_light", "LOW LIGHT - ADD LIGHTING", AMBER)

        if brightness > cfg.brightness_maximum:
            self.crack_history.clear()
            return Decision("overexposed", "GLARE DETECTED - CHANGE ANGLE", AMBER)

        if blur_score < cfg.blur_minimum:
            self.crack_history.clear()
            return Decision("blur", "IMAGE BLUR - HOLD STEADY OR MOVE CLOSER", AMBER)

        if wall_score is None:
            return Decision("waiting", "WAITING FOR MODEL RESULT", BLUE)

        self.wall_history.append(float(wall_score))
        smoothed_wall = sum(self.wall_history) / len(self.wall_history)
        if crack_score is not None and wall_score >= cfg.wall_accept_threshold:
            self.crack_history.append(float(crack_score))

        if len(self.wall_history) < cfg.min_stable_samples:
            return Decision(
                "stabilizing",
                "STABILIZING CAMERA",
                BLUE,
                wall_score=smoothed_wall,
            )

        if smoothed_wall < cfg.wall_reject_threshold:
            self.crack_history.clear()
            return Decision(
                "not_wall",
                "NO WALL DETECTED",
                GRAY,
                wall_score=smoothed_wall,
            )

        if smoothed_wall < cfg.wall_accept_threshold:
            self.crack_history.clear()
            return Decision(
                "wall_uncertain",
                "WALL UNCERTAIN - REPOSITION AND RESCAN",
                AMBER,
                wall_score=smoothed_wall,
            )

        if crack_score is None:
            return Decision(
                "wall_confirmed",
                "WALL CONFIRMED - ANALYZING",
                BLUE,
                wall_score=smoothed_wall,
            )

        smoothed_crack = sum(self.crack_history) / len(self.crack_history)

        if len(self.crack_history) < cfg.min_stable_samples:
            return Decision(
                "analyzing",
                "WALL CONFIRMED - ANALYZING",
                BLUE,
                wall_score=smoothed_wall,
                crack_score=smoothed_crack,
            )

        if smoothed_crack >= cfg.crack_alert_threshold:
            return Decision(
                "crack",
                "WALL DETECTED - CRACK FOUND",
                RED,
                wall_score=smoothed_wall,
                crack_score=smoothed_crack,
            )

        if smoothed_crack <= cfg.crack_safe_threshold:
            return Decision(
                "safe",
                "WALL DETECTED - NO CRACK FOUND",
                GREEN,
                wall_score=smoothed_wall,
                crack_score=smoothed_crack,
            )

        return Decision(
            "crack_uncertain",
            "CRACK CHECK UNCERTAIN - CHANGE ANGLE AND RESCAN",
            AMBER,
            wall_score=smoothed_wall,
            crack_score=smoothed_crack,
        )
