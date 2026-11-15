"""The viewer crop: the largest rectangle, of the video's shape, that (nearly) every warped frame fills.

The full stabilised video keeps the reference frame's pixels (for calibration and tracks); the
viewer video is that cropped to this rectangle, so no black border swings about at the edges.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from dryrun_vision.formats import CropRect
from dryrun_vision.geometry.linalg import FloatArray
from dryrun_vision.stabilise.errors import StabiliseError

VIEWER_MIN_COVERAGE = 0.99
"""Share of frames that must fill a pixel for it to be in the viewer crop: 1 % of frames (a third
of a second in 30 s) may show a sliver of black at an edge, so one wild frame cannot shrink it."""
VIEWER_GRID_PX = 8
"""Pixels. The crop is searched on a grid this fine (a 1920-px frame: 240 columns)."""


class ViewerCropError(StabiliseError):
    """No rectangle is filled by enough frames."""


def _covered(h: FloatArray, width: float, height: float, xs: FloatArray, ys: FloatArray) -> FloatArray:
    """Which lattice points (reference px) the warped frame rectangle covers (convex quad test)."""
    corners = np.array([[0, 0, 1], [width, 0, 1], [width, height, 1], [0, height, 1]], dtype=np.float64)
    q = corners @ np.asarray(h).T
    quad = q[:, :2] / q[:, 2:3]
    signs = []
    for i in range(4):
        (ax, ay), (bx, by) = quad[i], quad[(i + 1) % 4]
        signs.append((bx - ax) * (ys - ay) - (by - ay) * (xs - ax))
    s = np.stack(signs)
    return np.all(s >= 0, axis=0) | np.all(s <= 0, axis=0)


def _fits(valid_sat: FloatArray, rows: int, cols: int) -> tuple[int, int] | None:
    """Top-left cell of a rows x cols block of valid cells, using the summed-area table."""
    sums = (
        valid_sat[rows:, cols:]
        - valid_sat[:-rows, cols:]
        - valid_sat[rows:, :-cols]
        + valid_sat[:-rows, :-cols]
    )
    hits = np.argwhere(sums == rows * cols)
    if len(hits) == 0:
        return None
    centre = np.array(sums.shape) / 2
    r, c = min(hits, key=lambda rc: float(np.hypot(*(rc - centre))))
    return int(r), int(c)


def viewer_crop(
    homographies: Sequence[FloatArray], width: int, height: int, min_coverage: float = VIEWER_MIN_COVERAGE
) -> CropRect:
    """The largest width:height rectangle (reference px, even sizes) filled by min_coverage of frames."""
    g = VIEWER_GRID_PX
    ys, xs = np.mgrid[0 : height + 1 : g, 0 : width + 1 : g].astype(np.float64)
    count = sum(_covered(h, width, height, xs, ys).astype(int) for h in homographies)
    corner_ok = count >= math.ceil(min_coverage * len(homographies) - 1e-9)
    cells = corner_ok[:-1, :-1] & corner_ok[1:, :-1] & corner_ok[:-1, 1:] & corner_ok[1:, 1:]
    sat = np.pad(cells.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    aspect = width / height
    best: tuple[int, int, int] | None = None
    lo, hi = 1, cells.shape[0]
    while lo <= hi:
        rows = (lo + hi) // 2
        cols = min(cells.shape[1], math.floor(rows * aspect))
        at = _fits(sat, rows, cols) if cols >= 1 else None
        if at is None:
            hi = rows - 1
        else:
            best, lo = (rows, *at), rows + 1
    if best is None:
        raise ViewerCropError(
            "no part of the picture is filled by enough frames for a viewer crop; the camera moved too far."
        )
    rows, r, c = best
    crop_h = (rows * g) // 2 * 2
    crop_w = min(math.floor(crop_h * aspect), math.floor(rows * aspect) * g) // 2 * 2
    return CropRect(x=c * g, y=r * g, width=crop_w, height=crop_h)
