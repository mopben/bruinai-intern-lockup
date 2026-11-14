"""Tiny generated test videos (OpenCV). Each frame's index is readable back from its pixels."""

from __future__ import annotations

from pathlib import Path

import numpy as np

WIDTH, HEIGHT = 64, 48
FRAME_LEVEL_STEP = 8
"""Grey level step per frame, so frame k has mean level about k * 8 (survives compression)."""


def frame_image(k: int) -> np.ndarray:
    level = (k * FRAME_LEVEL_STEP) % 256
    return np.full((HEIGHT, WIDTH, 3), level, dtype=np.uint8)


def write_video(path: Path, frames: int, fps: float = 10.0) -> Path:
    import cv2  # noqa: PLC0415 - tests without the ml extra import this module too

    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), fps, (WIDTH, HEIGHT))
    assert writer.isOpened()
    for k in range(frames):
        writer.write(frame_image(k))
    writer.release()
    return path


def level_of(image: np.ndarray) -> int:
    return round(float(image.mean()) / FRAME_LEVEL_STEP)
