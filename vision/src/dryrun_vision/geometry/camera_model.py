"""Camera model: floor homography plus the image direction of "up" (port of src/camera/camera-model.ts).

The full 3x4 projection for world (x, y, z, 1) is P = [p1 p2 p3 p4]. The floor
homography gives H = [p1 p3 p4]; `up` is p2. The plane at height h then has
homography [p1, p3, h*p2 + p4], whose inverse maps a pixel seen h metres up to the
floor point under it.

Two ways to get `up`:
- "box-tops": two or more clicked points of known height above the floor. Exact.
- "lens" (fallback): square pixels and the principal point at the image centre;
  fixes the focal length from the floor's perpendicular, equal-scale axes.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from dryrun_vision.errors import CalibrationError
from dryrun_vision.geometry.floor import Vec2
from dryrun_vision.geometry.homography import Pt, apply_homography
from dryrun_vision.geometry.linalg import FloatArray, frozen, inv3, least_squares, solve_square

HeightMethod = Literal["lens", "box-tops"]

MIN_FOCAL_WIDTHS = 0.2
MAX_FOCAL_WIDTHS = 6.0
"""A measured focal length outside [0.2, 6] image widths is not believed (camera-model.ts)."""
FOCAL_DEN_MIN = 1e-9
"""Below this the two focal constraints carry no information."""
MIN_TOP_HEIGHT_M = 0.2
"""Metres. Box-top points lower than this do not fix `up` well and are left out."""
MIN_TOPS = 2
"""Box-top points needed: each gives two equations for the three unknowns of `up`."""
MIN_HAT_M = 1.0
MAX_HAT_M = 2.3
"""Metres. A measured hat height outside this range is a bad click."""


@dataclass(frozen=True, eq=False)
class CameraModel:
    floor_to_image: FloatArray
    """3x3, floor (x, z, 1) to image pixels. Read-only."""
    up: FloatArray
    """3-vector: image direction of world up, same scale as floor_to_image. Read-only."""
    method: HeightMethod
    note: str
    """Plain words about any assumption made, for the operator."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "floor_to_image", frozen(self.floor_to_image))
        object.__setattr__(self, "up", frozen(self.up))


def height_homography(m: CameraModel, h: float) -> FloatArray:
    """Floor (x, z) at height h (metres) to image."""
    out = np.array(m.floor_to_image, copy=True)
    out[:, 2] = out[:, 2] + h * m.up
    return out


def project_at(m: CameraModel, floor_xz: Sequence[float], height_m: float) -> Pt | None:
    """Pixel where a point height_m above floor point (x, z) appears, or None if at infinity."""
    return apply_homography(height_homography(m, height_m), (floor_xz[0], floor_xz[1]))


def image_to_floor_at(m: CameraModel, px: Sequence[float], height_m: float) -> Vec2 | None:
    """Floor point (x, z) under a thing seen at pixel px that is height_m metres up, or None."""
    inv = inv3(height_homography(m, height_m))
    if inv is None:
        return None
    q = apply_homography(inv, px)
    if q is None or not (math.isfinite(q[0]) and math.isfinite(q[1])):
        return None
    return Vec2(q[0], q[1])


def camera_position(m: CameraModel) -> tuple[float, float, float] | None:
    """The camera centre (x, y, z): the null vector of P. None if degenerate."""
    f = m.floor_to_image
    a = [[f[i, 0], m.up[i], f[i, 1]] for i in range(3)]
    b = [-f[i, 2] for i in range(3)]
    s = solve_square(a, b)
    return None if s is None else (float(s[0]), float(s[1]), float(s[2]))


def _focal_from(g1: FloatArray, g2: FloatArray, width: float) -> float | None:
    eqs = (
        (g1[0] * g2[0] + g1[1] * g2[1], g1[2] * g2[2]),
        (g1[0] ** 2 + g1[1] ** 2 - g2[0] ** 2 - g2[1] ** 2, g1[2] ** 2 - g2[2] ** 2),
    )
    num = 0.0
    den = 0.0
    for a0, b in eqs:
        a = a0 / width**2
        n = math.hypot(a, b)
        if n == 0:
            continue
        num += (a / n) * (b / n)
        den += (a / n) ** 2
    if den < FOCAL_DEN_MIN:
        return None
    omega = -num / den / width**2
    if not omega > 0:
        return None
    f = 1 / math.sqrt(omega)
    return f if math.isfinite(f) and MIN_FOCAL_WIDTHS * width < f < MAX_FOCAL_WIDTHS * width else None


def _lens_note(found: float | None, f: float) -> str:
    # JS Math.round rounds halves up; Python's round() rounds halves to even.
    px = math.floor(f + 0.5)
    if found is not None:
        return f"Hat height correction assumes a centred lens (focal length about {px} px)."
    return (
        f"Focal length could not be measured from these points (camera looking almost straight down?); "
        f"assumed {px} px. Add two box-top points for an exact answer."
    )


def model_from_lens(floor_to_image: FloatArray, width: float, height: float, ref_floor: Vec2) -> CameraModel:
    """Camera model from the floor homography alone; ref_floor is any floor point in view."""
    cx, cy = width / 2, height / 2
    shift = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]], dtype=np.float64)
    g1 = shift @ floor_to_image[:, 0]
    g2 = shift @ floor_to_image[:, 1]
    found = _focal_from(g1, g2, width)
    f = found if found is not None else width
    a = np.array([g1[0] / f, g1[1] / f, g1[2]])
    b = np.array([g2[0] / f, g2[1] / f, g2[2]])
    w_ref = float(floor_to_image[2] @ np.array([ref_floor.x, ref_floor.z, 1.0]))
    if not math.isfinite(w_ref) or w_ref == 0:
        raise CalibrationError("The calibration does not see the floor. Redo the floor points.")
    s = (math.copysign(1.0, w_ref) * 2) / (np.linalg.norm(a) + np.linalg.norm(b))
    rx, rz = a * s, b * s
    ry_raw = np.cross(rz, rx)
    ry = ry_raw / np.linalg.norm(ry_raw)
    pg = np.array([f * ry[0] / s, f * ry[1] / s, ry[2] / s])
    up = np.array([pg[0] + cx * pg[2], pg[1] + cy * pg[2], pg[2]])
    if not np.all(np.isfinite(up)):
        raise CalibrationError("Could not work out the camera's angle. Redo the floor points.")
    return CameraModel(floor_to_image, up, "lens", _lens_note(found, f))


def _top_rows(floor_to_image: FloatArray, tops: Sequence) -> tuple[list[list[float]], list[float]]:
    rows: list[list[float]] = []
    rhs: list[float] = []
    for t in tops:
        qx, qy, qw = floor_to_image @ np.array([t.world.x, t.world.z, 1.0])
        u, v, h = t.image.x, t.image.y, t.world.y
        rows.append([0.0, -h, v * h])
        rhs.append(float(qy - v * qw))
        rows.append([h, 0.0, -u * h])
        rhs.append(float(u * qw - qx))
    return rows, rhs


def model_from_tops(floor_to_image: FloatArray, tops: Sequence) -> CameraModel:
    """Camera model from the floor homography plus 2+ points of known height (PointPair-like).

    For each point u ~ H (x, z, 1) + y * up: two linear equations in `up`.
    """
    usable = [t for t in tops if t.world.y > MIN_TOP_HEIGHT_M]
    if len(usable) < MIN_TOPS:
        raise CalibrationError("Need two or more box-top points (at least 20 cm above the floor).")
    rows, rhs = _top_rows(floor_to_image, usable)
    sc = max([1.0] + [max(abs(r[0]), abs(r[1])) for r in rows])
    sol = least_squares([[c / sc for c in r] for r in rows], rhs)
    if sol is None:
        raise CalibrationError(
            "The box-top points do not fix the camera's angle. Use tops of two different boxes."
        )
    up = sol / sc
    if not np.all(np.isfinite(up)):
        raise CalibrationError("The box-top points do not fix the camera's angle.")
    return CameraModel(
        floor_to_image, up, "box-tops", f"Hat height correction measured from {len(usable)} box-top points."
    )


def solve_hat_height(m: CameraModel, hat_px: Sequence[float], standing: Sequence[float]) -> float:
    """Height (m) of a thing seen at hat_px above the known floor point `standing` (x, z)."""
    qx, qy, qw = m.floor_to_image @ np.array([standing[0], standing[1], 1.0])
    u, v = hat_px[0], hat_px[1]
    px, py, pw = m.up
    a = (v * pw - py, px - u * pw)
    b = (qy - v * qw, u * qw - qx)
    den = a[0] ** 2 + a[1] ** 2
    if den == 0:
        raise CalibrationError("Could not measure the hat height from this click.")
    h = float((a[0] * b[0] + a[1] * b[1]) / den)
    if not math.isfinite(h) or h < MIN_HAT_M or h > MAX_HAT_M:
        raise CalibrationError(
            f"That click gives a hat {h:.2f} m up, which is not plausible. "
            "Check the worker is on the chosen spot."
        )
    return h
