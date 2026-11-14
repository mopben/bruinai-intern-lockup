"""Lean correction: the box's top-centre is not straight above the person.

Seen from the side, a standing person's vertical axis is tilted in the picture (head and feet at
different x), and a detector's box encloses the whole axis. So the box's horizontal centre is the
midpoint of the axis's visible ends, not the head's x. With the camera model we know how the axis
of a person standing at floor point X looks, so we solve for the X whose axis explains the box:

- head anchor: the head (anchor height up) is at the box's top edge, and the midpoint of the head
  and of the axis point at the box's bottom edge (the feet, or where a counter cuts the person off)
  is at the box's horizontal centre;
- foot anchor: the same with the feet at the bottom edge and the axis point at the top edge.

Two equations, two unknowns (x, z); a few Gauss-Newton steps from the plain top-/bottom-centre
estimate. If they do not converge (both residuals under ACCEPT_PX at the end) the plain estimate
is kept.

Evidence: the algebra is checked on synthetic boxes drawn with the same camera model it inverts
(tests/test_lean.py), which cannot show it helps on real boxes. On PETS09-S2L1 (real boxes, hand
labelled ground truth) it moved the head-anchor median floor error from 0.309 to 0.303 m and made
the foot anchor slightly worse (0.198 to 0.209 m), so anchor.py applies it to the head anchor only.
"""

from __future__ import annotations

import math

import numpy as np

from dryrun_vision.formats import Detection
from dryrun_vision.geometry import CameraModel, Vec2

MAX_STEPS = 12
"""Gauss-Newton steps; it converges in 3-4 on every test case."""
STEP_M = 1e-4
"""Metres. Finite-difference step for the Jacobian (0.1 mm: far below any real error)."""
DONE_PX = 1e-3
"""Pixels. Stop when both residuals are smaller than this."""
ACCEPT_PX = 0.5
"""Pixels. After the last step both residuals must be under this, or the plain estimate is kept:
half a pixel is well inside a detector's box-edge noise."""
MAX_SHIFT_M = 1.0
"""Metres. A correction larger than this is not a lean (a box of something else): keep the estimate."""
MAX_AXIS_TOP_M = 2.5
"""Metres. With the foot anchor the axis point at the box top is searched up to this height."""


def _pixel(m: CameraModel, x: float, z: float, y: float) -> tuple[float, float, float]:
    """Homogeneous image point (u*w, v*w, w) of the world point (x, y up, z)."""
    p = m.floor_to_image @ np.array([x, z, 1.0]) + y * m.up
    return float(p[0]), float(p[1]), float(p[2])


def _height_at_row(m: CameraModel, x: float, z: float, v: float) -> float:
    """Height of the point on the vertical through (x, z) that appears at image row v."""
    a = _pixel(m, x, z, 0.0)
    b = m.up
    den = float(b[1]) - v * float(b[2])
    return math.inf if den == 0 else (v * a[2] - a[1]) / den


def _u(m: CameraModel, x: float, z: float, y: float) -> float:
    p = _pixel(m, x, z, y)
    return p[0] / p[2]


def _residual(m: CameraModel, det: Detection, anchor: str, h: float, xz: np.ndarray) -> np.ndarray:
    x, z = float(xz[0]), float(xz[1])
    if anchor == "head":
        edge_row, other_row, y_anchor = det.y, det.y + det.h, h
        y_other = min(max(_height_at_row(m, x, z, other_row), 0.0), h)
    else:
        edge_row, other_row, y_anchor = det.y + det.h, det.y, 0.0
        y_other = min(max(_height_at_row(m, x, z, other_row), 0.0), MAX_AXIS_TOP_M)
    pa = _pixel(m, x, z, y_anchor)
    mid_u = (pa[0] / pa[2] + _u(m, x, z, y_other)) / 2
    return np.array([pa[1] / pa[2] - edge_row, mid_u - (det.x + det.w / 2)])


def lean_corrected(m: CameraModel, det: Detection, anchor: str, h: float, start: Vec2 | None) -> Vec2 | None:
    """The floor point whose standing axis explains the box (see the module text), or `start`."""
    if start is None:
        return None
    xz = np.array([start.x, start.z], dtype=np.float64)
    for _ in range(MAX_STEPS):
        r = _residual(m, det, anchor, h, xz)
        if not np.all(np.isfinite(r)):
            return start
        if np.max(np.abs(r)) < DONE_PX:
            break
        jac = np.column_stack(
            [(_residual(m, det, anchor, h, xz + STEP_M * e) - r) / STEP_M for e in np.eye(2)]
        )
        try:
            xz = xz - np.linalg.solve(jac, r)
        except np.linalg.LinAlgError:
            return start
    if not np.all(np.isfinite(xz)):
        return start
    final = _residual(m, det, anchor, h, xz)
    out = Vec2(float(xz[0]), float(xz[1]))
    converged = bool(np.all(np.isfinite(final))) and float(np.max(np.abs(final))) < ACCEPT_PX
    near = math.hypot(out.x - start.x, out.z - start.z) <= MAX_SHIFT_M
    return out if converged and near else start
