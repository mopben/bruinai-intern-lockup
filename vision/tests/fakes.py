"""Fake detector and tracker for tests: no model, fully predictable."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from dryrun_vision.detect import PersonBox
from dryrun_vision.track import TrackedBox
from videos import level_of


@dataclass
class LevelDetector:
    """One person whose box moves 1 px right per frame (frame read back from the grey level)."""

    name: str = "fake-detector"

    def detect(self, image: np.ndarray) -> tuple[PersonBox, ...]:
        k = level_of(image)
        return (PersonBox(2.0 + k, 4.0, 12.0 + k, 40.0, 0.9), PersonBox(-5.0, 30.0, 6.0, 60.0, 0.6))


@dataclass
class EnumeratingTracker:
    """Gives box i of every frame the id 10 + i."""

    name: str = "fake-tracker"

    def update(self, boxes: tuple[PersonBox, ...]) -> tuple[TrackedBox, ...]:
        return tuple(TrackedBox(10 + i, b) for i, b in enumerate(boxes))
