"""Create a simple rain-and-rising-water flood simulation video from one image."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Input scene image")
    parser.add_argument("--output", default="flood_simulation.mp4")
    parser.add_argument("--seconds", type=int, default=10)
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()

    image = cv2.imread(args.image)
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")
    height, width = image.shape[:2]
    output = Path(args.output)
    writer = cv2.VideoWriter(
        str(output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (width, height)
    )
    rng = np.random.default_rng(7)
    total_frames = max(1, args.seconds * args.fps)

    try:
        for frame_number in range(total_frames):
            frame = image.copy()
            progress = frame_number / max(1, total_frames - 1)
            water_top = int(height * (0.82 - 0.52 * progress))

            water = np.zeros_like(frame)
            water[water_top:, :] = (150, 80, 25)  # BGR: muddy blue-brown water
            frame = cv2.addWeighted(frame, 0.62, water, 0.38, 0)
            cv2.rectangle(frame, (0, water_top), (width, height), (150, 80, 25), 2)

            for _ in range(max(20, width // 18)):
                x = int(rng.integers(0, width))
                y = int(rng.integers(0, max(1, water_top)))
                length = int(rng.integers(10, 26))
                cv2.line(frame, (x, y), (x - 3, min(height - 1, y + length)), (210, 210, 210), 1)

            cv2.putText(frame, "FLOOD SIMULATION - AI DEMO", (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, "POSSIBLE FLOOD AREA", (20, 76), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 165, 255), 2, cv2.LINE_AA)
            writer.write(frame)
    finally:
        writer.release()
    print(f"Simulation saved to: {output.resolve()}")


if __name__ == "__main__":
    main()
