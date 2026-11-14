"""Exact shortest walkable path around grown rectangles (port of src/core/path.ts).

Visibility graph over obstacle corners plus the two end points, searched with
Dijkstra. An obstacle whose grown rectangle contains an end point is replaced by
its raw footprint for that query; if the end point is inside the raw footprint
too, the obstacle is dropped for the query.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.geometry.floor import (
    OrientedRect,
    Vec2,
    distance,
    point_strictly_inside,
    rect_corners,
    segment_crosses_rect,
)

DIST_EPS = 1e-12
"""Metres. Relaxation must improve by more than this (path.ts)."""


@dataclass(frozen=True)
class Obstacle:
    id: str
    grown: OrientedRect
    """Footprint grown by the body radius: what blocks walking."""
    raw: OrientedRect
    """The box itself, used when an end point sits inside the grown margin."""


@dataclass(frozen=True)
class WalkPath:
    length: float
    points: tuple[Vec2, ...]
    blocked: bool
    """True when no walkable path exists and a straight line was used."""


def _effective_rects(obstacles: Sequence[Obstacle], a: Vec2, b: Vec2) -> tuple[OrientedRect, ...]:
    out: list[OrientedRect] = []
    for o in obstacles:
        if not (point_strictly_inside(o.grown, a) or point_strictly_inside(o.grown, b)):
            out.append(o.grown)
        elif not (point_strictly_inside(o.raw, a) or point_strictly_inside(o.raw, b)):
            out.append(o.raw)
    return tuple(out)


def _visible(rects: Sequence[OrientedRect], a: Vec2, b: Vec2) -> bool:
    return not any(segment_crosses_rect(r, a, b) for r in rects)


def _closest_open(dist: Sequence[float], done: Sequence[bool]) -> int:
    u, best = -1, math.inf
    for i, di in enumerate(dist):
        if not done[i] and di < best:
            u, best = i, di
    return u


def _dijkstra(nodes: Sequence[Vec2], rects: Sequence[OrientedRect]) -> tuple[int, ...] | None:
    n = len(nodes)
    dist = [math.inf] * n
    prev = [-1] * n
    done = [False] * n
    dist[0] = 0.0
    while True:
        u = _closest_open(dist, done)
        if u == -1:
            return None
        if u == 1:
            break
        done[u] = True
        for v in range(n):
            if done[v] or v == u:
                continue
            alt = dist[u] + distance(nodes[u], nodes[v])
            if alt < dist[v] - DIST_EPS and _visible(rects, nodes[u], nodes[v]):
                dist[v] = alt
                prev[v] = u
    order: list[int] = []
    at = 1
    while at != -1:
        order.append(at)
        at = prev[at]
    return tuple(reversed(order))


def shortest_path(obstacles: Sequence[Obstacle], a: Vec2, b: Vec2) -> WalkPath:
    """Shortest walkable path from a to b around obstacles. Never raises."""
    rects = _effective_rects(obstacles, a, b)
    if _visible(rects, a, b):
        return WalkPath(distance(a, b), (a, b), False)
    corners = [
        c for r in rects for c in rect_corners(r) if not any(point_strictly_inside(q, c) for q in rects)
    ]
    nodes = (a, b, *corners)
    order = _dijkstra(nodes, rects)
    if order is None:
        return WalkPath(distance(a, b), (a, b), True)
    points = tuple(nodes[i] for i in order)
    length = sum(distance(p, q) for p, q in itertools.pairwise(points))
    return WalkPath(length, points, False)
