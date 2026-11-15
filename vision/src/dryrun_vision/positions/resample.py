"""One person's floor points at the video's frame times -> samples on a fixed 10 Hz grid.

Light smoothing, never invention:
- a running median over MEDIAN_POINTS boxes removes one-box spikes (an arm raised over the head);
- each tick is the straight-line path through the points, averaged with triangle weights over
  SMOOTH_HALF_WINDOW_S either side (symmetric, so a steady walk is not lagged);
- the path is only drawn across holes of at most MAX_BRIDGE_S; longer holes split the track;
- no tick before the first point or after the last point of a stretch (no extrapolation).
The spirit of src/camera/tracker.ts: a gap is better than an invented point.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from statistics import median

import numpy as np

from dryrun_vision.clock import NO_OFFSET, RunClock
from dryrun_vision.geometry import Vec2

PRODUCT_HZ = 10.0
"""Samples per second per worker: the rate of positions.jsonl everywhere in the product."""
MEDIAN_POINTS = 3
"""Boxes in the running median (one each side): removes a single wrong box, keeps every turn."""
SMOOTH_HALF_WINDOW_S = 0.15
"""Seconds either side of a tick that are averaged: about 9 boxes at 30 fps, 2 at 7 fps. A person
walking at 1.2 m/s moves 18 cm in that time, so corners are rounded by a few centimetres only."""
MAX_BRIDGE_S = 0.5
"""Seconds. Holes up to this are bridged by straight-line interpolation (tracker.ts also holds a lost
position for 0.5 s); longer holes stay holes in positions.jsonl."""
TICK_EPS_S = 1e-9
"""Seconds. Float slack when placing ticks between the first and last point."""
KERNEL_STEPS = 4
"""The triangle kernel is sampled at 2 * 4 - 1 = 7 points across the window."""
_KERNEL_OFFSETS = np.arange(-KERNEL_STEPS + 1, KERNEL_STEPS) / KERNEL_STEPS
_KERNEL_WEIGHTS = (KERNEL_STEPS - np.abs(np.arange(-KERNEL_STEPS + 1, KERNEL_STEPS))) / KERNEL_STEPS**2


def running_median(points: Sequence[Vec2]) -> tuple[Vec2, ...]:
    """Median of each coordinate over MEDIAN_POINTS neighbours; the first and last points stay as
    they are (a two-point median would be a mean, pulling the ends inwards)."""
    half = MEDIAN_POINTS // 2
    n = len(points)
    out: list[Vec2] = []
    for i in range(n):
        if i < half or i >= n - half:
            out.append(points[i])
            continue
        window = points[i - half : i + half + 1]
        out.append(Vec2(median(p.x for p in window), median(p.z for p in window)))
    return tuple(out)


def _check(times: Sequence[float], points: Sequence[Vec2], hz: float) -> None:
    if len(times) != len(points):
        raise ValueError("resample_track needs the same number of times and points.")
    if any(b < a for a, b in itertools.pairwise(times)):
        raise ValueError("resample_track needs its points in time order.")
    if not hz > 0:
        raise ValueError(f"The sample rate must be more than 0, not {hz}.")


def _stretches(times: Sequence[float]) -> list[tuple[int, int]]:
    """Index ranges [a, b] with no hole longer than MAX_BRIDGE_S inside."""
    out: list[tuple[int, int]] = []
    start = 0
    for i in range(1, len(times)):
        if times[i] - times[i - 1] > MAX_BRIDGE_S:
            out.append((start, i - 1))
            start = i
    out.append((start, len(times) - 1))
    return out


def _tick(t: float, ts: np.ndarray, xz: np.ndarray) -> Vec2:
    """The straight-line path through the points, averaged with triangle weights over t +- half.

    Sampling the path (not the raw points) keeps the mean unbiased whatever the frame rate; the
    window shrinks near the ends of a stretch so it stays centred on t.
    """
    half = min(SMOOTH_HALF_WINDOW_S, t - ts[0], ts[-1] - t)
    at = t + _KERNEL_OFFSETS * max(half, 0.0)
    x = float(np.dot(np.interp(at, ts, xz[:, 0]), _KERNEL_WEIGHTS))
    z = float(np.dot(np.interp(at, ts, xz[:, 1]), _KERNEL_WEIGHTS))
    return Vec2(x, z)


def resample_track(
    times: Sequence[float], points: Sequence[Vec2], hz: float = PRODUCT_HZ, clock: RunClock = NO_OFFSET
) -> tuple[tuple[float, Vec2], ...]:
    """(run time, point) ticks at k / hz; `times` are video times. Ticks before run time 0 are left out."""
    _check(times, points, hz)
    if not times:
        return ()
    ts = np.array(times, dtype=np.float64)
    xz = np.array([[p.x, p.z] for p in running_median(points)], dtype=np.float64)
    out: list[tuple[float, Vec2]] = []
    for a, b in _stretches(times):
        k0 = max(0, math.ceil(clock.run_time(ts[a]) * hz - TICK_EPS_S))
        k1 = math.floor(clock.run_time(ts[b]) * hz + TICK_EPS_S)
        seg_t, seg_xz = ts[a : b + 1], xz[a : b + 1]
        for k in range(k0, k1 + 1):
            at = min(max(clock.video_time(k / hz), seg_t[0]), seg_t[-1])
            out.append((k / hz, _tick(at, seg_t, seg_xz)))

    return tuple(out)
