"""Floor geometry: points, oriented rectangles and segment tests (port of src/core/geometry.ts).

Rotation convention (three.js rotation.y = yaw): a local floor vector (x, z) maps to world as
    x' =  x cos(yaw) + z sin(yaw)
    z' = -x sin(yaw) + z cos(yaw)
so yaw = 0 leaves local +z ("front") facing world +z.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import NamedTuple

GEOM_EPS = 1e-7
"""Metres. "Touching is not crossing" tolerance (geometry.ts)."""
CLIP_MIN = 1e-9
"""Parametric length a segment must overlap the interior to count as crossing (geometry.ts)."""


class Vec2(NamedTuple):
    """A floor point in metres: x to the right, z toward the viewer."""

    x: float
    z: float


def distance(a: Vec2, b: Vec2) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass(frozen=True)
class OrientedRect:
    center: Vec2
    half_w: float
    """Half size along local x, metres."""
    half_d: float
    """Half size along local z, metres."""
    yaw: float


def local_to_world(rect: OrientedRect, local: Vec2) -> Vec2:
    c, s = math.cos(rect.yaw), math.sin(rect.yaw)
    return Vec2(rect.center.x + local.x * c + local.z * s, rect.center.z - local.x * s + local.z * c)


def world_to_local(rect: OrientedRect, p: Vec2) -> Vec2:
    c, s = math.cos(rect.yaw), math.sin(rect.yaw)
    dx, dz = p[0] - rect.center.x, p[1] - rect.center.z
    return Vec2(dx * c - dz * s, dx * s + dz * c)


def rect_corners(rect: OrientedRect) -> tuple[Vec2, ...]:
    """Corners starting at local (-w, -d): back-left, back-right, front-right, front-left."""
    w, d = rect.half_w, rect.half_d
    return tuple(local_to_world(rect, Vec2(x, z)) for x, z in ((-w, -d), (w, -d), (w, d), (-w, d)))


def grow_rect(rect: OrientedRect, r: float) -> OrientedRect:
    return replace(rect, half_w=rect.half_w + r, half_d=rect.half_d + r)


def point_strictly_inside(rect: OrientedRect, p: Vec2) -> bool:
    lp = world_to_local(rect, p)
    return abs(lp.x) < rect.half_w - GEOM_EPS and abs(lp.z) < rect.half_d - GEOM_EPS


def segment_crosses_rect(rect: OrientedRect, a: Vec2, b: Vec2) -> bool:
    """True when segment a-b passes through the open interior (Liang-Barsky, as geometry.ts)."""
    la, lb = world_to_local(rect, a), world_to_local(rect, b)
    w, d = rect.half_w - GEOM_EPS, rect.half_d - GEOM_EPS
    if w <= 0 or d <= 0:
        return False
    dx, dz = lb.x - la.x, lb.z - la.z
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, la.x + w), (dx, w - la.x), (-dz, la.z + d), (dz, d - la.z)):
        if p == 0:
            if q <= 0:
                return False
            continue
        t = q / p
        if p < 0:
            if t > t1:
                return False
            t0 = max(t0, t)
        else:
            if t < t0:
                return False
            t1 = min(t1, t)
    return t1 - t0 > CLIP_MIN
