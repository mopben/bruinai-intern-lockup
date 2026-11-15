"""Where a track rests, how long it stays near a spot, and how long it is inside the working area."""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from statistics import median

import numpy as np

from dryrun_vision.geometry import Vec2
from dryrun_vision.identity.fragments import Fragment
from dryrun_vision.kitchen import Bounds

MAX_DT_FACTOR = 3.0
"""A detection stands for the time to the next one, but never more than 3 typical frame steps
(so a long occlusion does not count as time spent at the last seen spot)."""


def _durations(fragments: Sequence[Fragment]) -> list[float]:
    """Seconds each detection stands for: the step to the next one in its fragment, capped."""
    out: list[float] = []
    for f in fragments:
        times = f.times
        steps = [b - a for a, b in itertools.pairwise(times)]
        typical = median(steps) if steps else 0.0
        cap = MAX_DT_FACTOR * typical
        out.extend(min(s, cap) for s in steps)
        out.append(typical)
    return out


def _weighted(fragments: Sequence[Fragment]) -> tuple[np.ndarray, np.ndarray]:
    pts = np.array([[p.x, p.z] for f in fragments for p in f.points], dtype=np.float64).reshape(-1, 2)
    return pts, np.array(_durations(fragments), dtype=np.float64)


def seconds_near(fragments: Sequence[Fragment], spot: Vec2, radius_m: float) -> float:
    """Seconds the fragments spend within radius_m of spot."""
    pts, dur = _weighted(fragments)
    near = np.hypot(pts[:, 0] - spot.x, pts[:, 1] - spot.z) <= radius_m
    return float(dur[near].sum())


def seconds_inside(fragments: Sequence[Fragment], bounds: Bounds, margin_m: float) -> float:
    """Seconds the fragments spend inside the bounds grown by margin_m."""
    pts, dur = _weighted(fragments)
    inside = (
        (pts[:, 0] >= bounds.min_x - margin_m)
        & (pts[:, 0] <= bounds.max_x + margin_m)
        & (pts[:, 1] >= bounds.min_z - margin_m)
        & (pts[:, 1] <= bounds.max_z + margin_m)
    )
    return float(dur[inside].sum())


def total_seconds(fragments: Sequence[Fragment]) -> float:
    """Seconds of track the fragments cover (sum of detection durations)."""
    return float(sum(_durations(fragments)))
