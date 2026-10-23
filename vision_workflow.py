"""Small, testable state helpers for the operator-reviewed vision workflow."""

from __future__ import annotations


def candidate_ready(consecutive_detection_frames: int, required_frames: int) -> bool:
    """Return whether a detection has remained present long enough for review."""
    return required_frames > 0 and consecutive_detection_frames >= required_frames


def release_allowed(*, candidate_confirmed: bool, hardware_enabled: bool, serial_connected: bool) -> bool:
    """A release requires all three independent gates."""
    return candidate_confirmed and hardware_enabled and serial_connected


def source_label(video_path: str | None, camera_index: int) -> str:
    return f"recorded:{video_path}" if video_path else f"camera:{camera_index}"
