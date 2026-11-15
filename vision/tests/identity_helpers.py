"""Build fragments straight from floor paths (no camera) for identity unit tests."""

from __future__ import annotations

from collections.abc import Callable

from dryrun_vision.formats import Detection
from dryrun_vision.geometry import Vec2
from dryrun_vision.identity import Fragment

Path = Callable[[float], tuple[float, float]]


def frag(track_id: int, t0: float, t1: float, path: Path, fps: float = 10.0) -> Fragment:
    """Detections every 1/fps s from t0 to t1 (inclusive) at the floor points path(t)."""
    n = round((t1 - t0) * fps) + 1
    times = [t0 + k / fps for k in range(n)]
    dets = tuple(
        Detection(frame=round(t * fps), t=t, track_id=track_id, x=0.0, y=0.0, w=1.0, h=1.0, score=0.9)
        for t in times
    )
    return Fragment(track_id, dets, tuple(Vec2(*path(t)) for t in times))


def still(x: float, z: float) -> Path:
    return lambda _t: (x, z)


def walk(a: tuple[float, float], b: tuple[float, float], t0: float, t1: float) -> Path:
    def at(t: float) -> tuple[float, float]:
        u = min(1.0, max(0.0, (t - t0) / (t1 - t0)))
        return (a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]))

    return at
