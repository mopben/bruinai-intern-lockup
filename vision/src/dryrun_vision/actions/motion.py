"""Rest detection and home position (port of smoothPositions/restFlags/restingHome in src/core/trips.ts)."""

from __future__ import annotations

from collections.abc import Sequence
from statistics import median

from dryrun_vision.actions.constants import (
    HOME_SEARCH_M,
    MAX_GAP_S,
    REST_SPAN_GAP_FACTOR,
    REST_SPEED_MPS,
    SMOOTH_HALF_WINDOW,
)
from dryrun_vision.formats.positions import PositionSample
from dryrun_vision.geometry.floor import Vec2, distance


def smooth_positions(samples: Sequence[PositionSample]) -> tuple[Vec2, ...]:
    """Running median of each coordinate over 2*SMOOTH_HALF_WINDOW+1 samples (ends clamped)."""
    n = len(samples)
    out: list[Vec2] = []
    for i in range(n):
        window = [
            samples[min(n - 1, max(0, j))] for j in range(i - SMOOTH_HALF_WINDOW, i + SMOOTH_HALF_WINDOW + 1)
        ]
        out.append(Vec2(median(p.x for p in window), median(p.z for p in window)))
    return tuple(out)


def rest_flags(samples: Sequence[PositionSample], smoothed: Sequence[Vec2]) -> tuple[bool, ...]:
    """Per sample: smoothed speed over +-SMOOTH_HALF_WINDOW samples below REST_SPEED_MPS."""
    n = len(samples)
    flags: list[bool] = []
    for i in range(n):
        a = max(0, i - SMOOTH_HALF_WINDOW)
        b = min(n - 1, i + SMOOTH_HALF_WINDOW)
        dt = samples[b].t - samples[a].t
        if not dt > 0 or dt > REST_SPAN_GAP_FACTOR * MAX_GAP_S:
            flags.append(False)
        else:
            flags.append(distance(smoothed[a], smoothed[b]) / dt < REST_SPEED_MPS)
    return tuple(flags)


def resting_home(stand: Vec2, smoothed: Sequence[Vec2], rest: Sequence[bool]) -> Vec2:
    """Median of the resting positions within HOME_SEARCH_M of the stand point, else the stand point."""
    still = [p for p, r in zip(smoothed, rest, strict=True) if r and distance(p, stand) <= HOME_SEARCH_M]
    if not still:
        return stand
    return Vec2(median(p.x for p in still), median(p.z for p in still))
