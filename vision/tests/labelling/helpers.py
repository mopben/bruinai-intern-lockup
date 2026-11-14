"""Helpers for the labeller tests: tiny generated videos and fake providers (no model, no network)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from dryrun_vision.labels.providers.base import Clip
from dryrun_vision.labels.vocab import Candidate

GRAY_STEP = 5
"""Frame k of a generated video is a flat gray of k * GRAY_STEP, so a test can tell frames apart."""

MODEL_TESTS_ENV = "DRYRUN_MODEL_TESTS"


def write_video(path: Path, frames: int, size: tuple[int, int] = (64, 48), fps: float = 10.0) -> Path:
    import cv2  # noqa: PLC0415 - optional ml extra

    w, h = size
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    assert out.isOpened()
    for k in range(frames):
        frame = np.full((h, w, 3), (k * GRAY_STEP) % 256, dtype=np.uint8)
        frame[: h // 4, : w // 4] = (0, 0, 255)  # a red corner (BGR) to check the RGB conversion
        out.write(frame)
    out.release()
    return path


def frame_index(frame: np.ndarray) -> int:
    """Which generated frame this is (from the gray level away from the red corner)."""
    h, w = frame.shape[:2]
    return round(float(frame[h // 2 :, w // 2 :].mean()) / GRAY_STEP)


@dataclass
class FakeProvider:
    """Scores with a function of (clip, candidates); records every call."""

    rule: Callable[[Clip, Sequence[Candidate]], Sequence[float]]
    name: str = "fake"
    calls: list[tuple[Clip, tuple[str, ...]]] = field(default_factory=list)

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        self.calls.append((clip, tuple(c.label for c in candidates)))
        return tuple(self.rule(clip, candidates))


def by_brightness(clip: Clip, candidates: Sequence[Candidate]) -> list[float]:
    """Dark clips -> first candidate, bright clips -> second; confident (0.9)."""
    bright = float(np.mean([f.mean() for f in clip.frames])) > 100
    k = len(candidates)
    win = 1 if bright and k > 1 else 0
    rest = 0.1 / (k - 1)
    return [0.9 if i == win else rest for i in range(k)]
