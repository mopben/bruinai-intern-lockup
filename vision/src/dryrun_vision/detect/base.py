"""What a person detector gives back, and the interface every detector meets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt

from dryrun_vision.errors import DryRunError

ImageArray = npt.NDArray[np.uint8]


class DetectorError(DryRunError):
    """The detector could not be set up (missing package, device or weights)."""


@dataclass(frozen=True)
class PersonBox:
    """A person box in source-image pixels: corners (x1, y1) top-left and (x2, y2) bottom-right."""

    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    """Detector confidence, 0..1."""

    def __post_init__(self) -> None:
        if not (self.x2 > self.x1 and self.y2 > self.y1):
            raise ValueError(
                "A box's right edge must be right of its left edge, and its bottom below its top."
            )
        if not 0 <= self.score <= 1:
            raise ValueError(f"A box score must be between 0 and 1, not {self.score}.")

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


class Detector(Protocol):
    """Finds people in one frame."""

    @property
    def name(self) -> str:
        """Short model name, written to the tracks.jsonl header."""
        ...

    def detect(self, image: ImageArray) -> tuple[PersonBox, ...]:
        """People in a BGR image (height x width x 3). Must not change the image."""
        ...
