"""Plane-to-plane homography by normalised DLT (Hartley), ported from src/camera/homography.ts.

Both point sets are shifted to their centroid and scaled to mean distance sqrt(2);
then H with h33 = 1 is found by linear least squares (2 equations per pair).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from itertools import combinations

import numpy as np

from dryrun_vision.errors import CalibrationError
from dryrun_vision.geometry.linalg import FloatArray, det3, frozen, inv3, least_squares

Pt = tuple[float, float]

MIN_PAIRS = 4
W_EPS = 1e-12
"""|w| below this means the point maps to infinity."""
FLATNESS_MIN = 1e-4
"""Smallest/largest spread ratio below which the points count as one line."""
THREE_IN_LINE_REL = 2e-3
"""Triangle area (x2) below this times spread**2 means three points in a line (4-point sets only)."""
DUPLICATE_DECIMALS = 6
"""Points equal to this many decimals are the same point."""
DET_REL_MIN = 1e-12
"""|det H| below this times scale**3 means H does not fix the floor."""


def apply_homography(h: FloatArray, p: Sequence[float]) -> Pt | None:
    """p through h, or None if the point maps to infinity."""
    x, y = float(p[0]), float(p[1])
    w = h[2, 0] * x + h[2, 1] * y + h[2, 2]
    if not math.isfinite(w) or abs(w) < W_EPS:
        return None
    return (
        float((h[0, 0] * x + h[0, 1] * y + h[0, 2]) / w),
        float((h[1, 0] * x + h[1, 1] * y + h[1, 2]) / w),
    )


def _normaliser(points: Sequence[Pt]) -> FloatArray:
    n = len(points)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    mean_dist = sum(math.hypot(p[0] - cx, p[1] - cy) for p in points) / n
    s = math.sqrt(2) / mean_dist
    return np.array([[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]], dtype=np.float64)


def _flatness(points: Sequence[Pt]) -> float:
    n = len(points)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    sxx = sum((p[0] - cx) ** 2 for p in points)
    syy = sum((p[1] - cy) ** 2 for p in points)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in points)
    tr = sxx + syy
    disc = math.sqrt(max(0.0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
    big = tr / 2 + disc
    return 0.0 if big <= 0 else (tr / 2 - disc) / big


def _has_three_in_line(points: Sequence[Pt], rel_tol: float) -> bool:
    scale = max([abs(c) for p in points for c in p] + [1e-9])
    spread = max([math.hypot(a[0] - b[0], a[1] - b[1]) for a in points for b in points] + [1e-9 * scale])
    for a, b, c in combinations(points, 3):
        area2 = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        if area2 < rel_tol * spread * spread:
            return True
    return False


def _check_set(points: Sequence[Pt]) -> str | None:
    keys = {(round(p[0], DUPLICATE_DECIMALS), round(p[1], DUPLICATE_DECIMALS)) for p in points}
    if len(keys) != len(points):
        return "Two points are in the same place. Use four different points."
    if _flatness(points) < FLATNESS_MIN:
        return "The points lie on one line. Spread them out over the floor."
    if len(points) == MIN_PAIRS and _has_three_in_line(points, THREE_IN_LINE_REL):
        return "Three of the four points are in a line. Pick points that form a box shape."
    return None


def _check_points(src: Sequence[Pt], dst: Sequence[Pt]) -> str | None:
    if len(src) != len(dst):
        return "Each floor point needs exactly one matching camera point."
    if len(src) < MIN_PAIRS:
        return f"Need at least four point pairs; there are {len(src)}."
    if not all(math.isfinite(c) for p in [*src, *dst] for c in p):
        return "A point is not a number."
    for s in (src, dst):
        problem = _check_set(s)
        if problem:
            return problem
    return None


def _dlt_rows(ns: Sequence[Pt], nd: Sequence[Pt]) -> tuple[list[list[float]], list[float]]:
    rows: list[list[float]] = []
    rhs: list[float] = []
    for (sx, sy), (dx, dy) in zip(ns, nd, strict=True):
        rows.append([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy])
        rhs.append(dx)
        rows.append([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy])
        rhs.append(dy)
    return rows, rhs


def solve_homography(src: Sequence[Sequence[float]], dst: Sequence[Sequence[float]]) -> FloatArray:
    """H (3x3, read-only, h33 = 1) with dst ~ H src. Raises CalibrationError in plain words."""
    s_pts = [(float(p[0]), float(p[1])) for p in src]
    d_pts = [(float(p[0]), float(p[1])) for p in dst]
    problem = _check_points(s_pts, d_pts)
    if problem:
        raise CalibrationError(problem)
    ts, td = _normaliser(s_pts), _normaliser(d_pts)
    ns = [apply_homography(ts, p) for p in s_pts]
    nd = [apply_homography(td, p) for p in d_pts]
    rows, rhs = _dlt_rows(ns, nd)  # type: ignore[arg-type]
    h = least_squares(rows, rhs)
    if h is None:
        raise CalibrationError(
            "These points do not fix the floor. Pick points that are spread out, not in a line."
        )
    hn = np.append(h, 1.0).reshape(3, 3)
    td_inv = inv3(td)
    if td_inv is None:
        raise CalibrationError("Calibration points are degenerate.")
    full = td_inv @ (hn @ ts)
    out = full / (full[2, 2] if full[2, 2] != 0 else 1.0)
    scale = float(np.abs(out).max())
    if not np.all(np.isfinite(out)) or abs(det3(out)) < DET_REL_MIN * scale**3:
        raise CalibrationError(
            "These points do not fix the floor. "
            "Check that each map point matches the same spot in the picture."
        )
    return frozen(out)
