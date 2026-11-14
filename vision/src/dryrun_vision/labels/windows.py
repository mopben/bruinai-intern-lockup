"""Cutting a segment into labelling windows, and where to sample frames in a window."""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise

from dryrun_vision.formats.base import round_time
from dryrun_vision.labels.constants import MIN_WINDOW_S, WINDOW_S

_EPS = 1e-9


@dataclass(frozen=True)
class Window:
    """[t0, t1) in seconds, rounded to milliseconds like the files."""

    t0: float
    t1: float

    @property
    def duration(self) -> float:
        return self.t1 - self.t0

    def contains(self, t: float) -> bool:
        return self.t0 <= t < self.t1


def split_windows(
    t0: float, t1: float, window_s: float = WINDOW_S, min_window_s: float = MIN_WINDOW_S
) -> tuple[Window, ...]:
    """Windows that tile [t0, t1] exactly. A remainder shorter than `min_window_s` joins the last one."""
    if not window_s > 0 or min_window_s < 0:
        raise ValueError(f"the window length must be more than 0 s (got {window_s} s)")
    if not t1 > t0:
        raise ValueError(f"the end ({t1} s) must be later than the start ({t0} s)")
    span = t1 - t0
    full = math.floor(span / window_s + _EPS)
    remainder = span - full * window_s
    count = max(1, full + (1 if remainder >= min_window_s - _EPS and remainder > _EPS else 0))
    inner = tuple(round_time(t0 + k * window_s) for k in range(1, count))
    edges = (round_time(t0), *inner, round_time(t1))
    return tuple(Window(a, b) for a, b in pairwise(edges) if b > a)


def sample_times(window: Window, n: int) -> tuple[float, ...]:
    """Centres of `n` equal parts of the window."""
    if n < 1:
        raise ValueError(f"sample at least one frame per window (got {n})")
    step = window.duration / n
    return tuple(window.t0 + (i + 0.5) * step for i in range(n))
