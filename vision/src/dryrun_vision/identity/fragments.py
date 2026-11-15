"""Fragments (one tracker id each) and people (time-ordered, non-overlapping fragments)."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from itertools import groupby
from statistics import median

from dryrun_vision.formats import Detection
from dryrun_vision.geometry import Vec2

FloorOf = Callable[[Detection], Vec2 | None]


@dataclass(frozen=True)
class Fragment:
    """One tracker id: its detections (time order) and their floor points at the nominal height."""

    track_id: int
    detections: tuple[Detection, ...]
    points: tuple[Vec2, ...]

    def __post_init__(self) -> None:
        if not self.detections or len(self.detections) != len(self.points):
            raise ValueError("A fragment needs one floor point per detection, and at least one detection.")

    @property
    def t0(self) -> float:
        return self.detections[0].t

    @property
    def t1(self) -> float:
        return self.detections[-1].t

    @property
    def times(self) -> tuple[float, ...]:
        return tuple(d.t for d in self.detections)


@dataclass(frozen=True)
class Person:
    """One person: fragments in time order that never overlap in time."""

    name: str
    fragments: tuple[Fragment, ...]

    def __post_init__(self) -> None:
        for a, b in zip(self.fragments, self.fragments[1:], strict=False):
            if not b.t0 > a.t1:
                raise ValueError(f"Fragments {a.track_id} and {b.track_id} of {self.name} overlap in time.")

    @property
    def track_ids(self) -> tuple[int, ...]:
        return tuple(f.track_id for f in self.fragments)

    @property
    def t0(self) -> float:
        return self.fragments[0].t0

    @property
    def t1(self) -> float:
        return self.fragments[-1].t1

    @property
    def times(self) -> tuple[float, ...]:
        return tuple(t for f in self.fragments for t in f.times)

    @property
    def points(self) -> tuple[Vec2, ...]:
        return tuple(p for f in self.fragments for p in f.points)

    @property
    def detections(self) -> tuple[Detection, ...]:
        return tuple(d for f in self.fragments for d in f.detections)


def overlaps(a: Iterable[Fragment], b: Iterable[Fragment]) -> bool:
    """True when any fragment of `a` shares time with any fragment of `b` (touching ends count)."""
    bs = tuple(b)
    return any(x.t0 <= y.t1 and y.t0 <= x.t1 for x in a for y in bs)


def merged(name: str, *groups: Iterable[Fragment]) -> Person:
    """A person from several fragment groups, time-ordered. Raises ValueError if any overlap."""
    return Person(name, tuple(sorted((f for g in groups for f in g), key=lambda f: f.t0)))


def build_fragments(detections: Iterable[Detection], floor_of: FloorOf) -> tuple[Fragment, ...]:
    """Groups detections by trackId; detections with no floor point (above the horizon) are left out."""
    out: list[Fragment] = []
    by_id = sorted(detections, key=lambda d: (d.track_id, d.frame))
    for track_id, group in groupby(by_id, key=lambda d: d.track_id):
        pairs = [(d, p) for d in group if (p := floor_of(d)) is not None]
        if pairs:
            out.append(Fragment(track_id, tuple(d for d, _ in pairs), tuple(p for _, p in pairs)))
    return tuple(sorted(out, key=lambda f: (f.t0, f.track_id)))


def _median_point(points: Iterable[Vec2]) -> Vec2:
    pts = tuple(points)
    return Vec2(median(p.x for p in pts), median(p.z for p in pts))


def end_point(f: Fragment, span_s: float) -> Vec2:
    """Median floor point over the last span_s seconds of the fragment."""
    return _median_point(p for d, p in zip(f.detections, f.points, strict=True) if d.t >= f.t1 - span_s)


def start_point(f: Fragment, span_s: float) -> Vec2:
    """Median floor point over the first span_s seconds of the fragment."""
    return _median_point(p for d, p in zip(f.detections, f.points, strict=True) if d.t <= f.t0 + span_s)
