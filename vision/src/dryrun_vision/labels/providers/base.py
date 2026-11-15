"""The provider interface: a short clip of one worker + candidate labels -> one probability per label."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from dryrun_vision.labels.errors import LabelError
from dryrun_vision.labels.vocab import Candidate

_RGB_DIMS = 3
_PROB_SUM_TOLERANCE = 1e-3


@dataclass(frozen=True)
class Clip:
    """A few RGB uint8 frames (H x W x 3) of one worker, in time order. Frames are read-only copies."""

    frames: tuple[np.ndarray, ...]

    @classmethod
    def of(cls, frames: Iterable[np.ndarray]) -> Clip:
        copies = []
        for f in frames:
            if f.ndim != _RGB_DIMS or f.shape[2] != _RGB_DIMS or f.dtype != np.uint8:
                raise ValueError(f"a clip frame must be H x W x 3 uint8 RGB (got {f.shape} {f.dtype})")
            c = f.copy()
            c.setflags(write=False)
            copies.append(c)
        if not copies:
            raise ValueError("a clip needs at least one frame")
        return cls(tuple(copies))


class LabelProvider(Protocol):
    """Anything that can say how likely each candidate label is for a clip."""

    @property
    def name(self) -> str:
        """Written to the actions.jsonl header as `model`."""
        ...

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        """One probability per candidate, in the same order, summing to 1."""
        ...


def check_probabilities(probs: Sequence[float], n: int, who: str) -> tuple[float, ...]:
    """The provider's answer as a validated tuple; LabelError in plain words if it is unusable."""
    values = tuple(float(p) for p in probs)
    if len(values) != n:
        raise LabelError(f"{who} returned {len(values)} probabilities for {n} candidate labels.")
    if any(not math.isfinite(p) or p < 0 for p in values):
        raise LabelError(f"{who} returned a probability that is negative or not a number.")
    total = sum(values)
    if abs(total - 1) > _PROB_SUM_TOLERANCE:
        raise LabelError(f"{who} returned probabilities that add up to {total:.3f}, not 1.")
    return tuple(p / total for p in values)
