"""Whole walking trips, timed from rest to rest (port of src/core/trips.ts; see its header comment).

A trip is an excursion further than TRIP_EXCURSION_M from home. It starts at the
last rest near home before leaving and ends at the first rest near home after
coming back. It is matched to the longest fetch/carry leg from the worker's
station whose far stand point the worker came within TRIP_MATCH_M of. An
excursion that matches no leg, or that leaves again before resting at home,
is not a trip.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.actions.constants import TRIP_EXCURSION_M, TRIP_HOME_M, TRIP_MATCH_M
from dryrun_vision.actions.motion import rest_flags, resting_home, smooth_positions
from dryrun_vision.formats.positions import PositionSample
from dryrun_vision.geometry.floor import Vec2, distance
from dryrun_vision.kitchen import Kitchen, LegKind, TripTarget, menu_legs, trip_targets


@dataclass(frozen=True)
class Trip:
    worker_id: str
    kind: LegKind
    target_id: str
    t0: float
    t1: float
    distance_m: float
    """Modelled round-trip distance of the matched leg (full, untrimmed)."""

    @property
    def duration_s(self) -> float:
        return self.t1 - self.t0


@dataclass(frozen=True)
class WorkerMotion:
    """One worker's samples (time-sorted) with smoothed positions, rest flags and home."""

    samples: tuple[PositionSample, ...]
    smoothed: tuple[Vec2, ...]
    rest: tuple[bool, ...]
    home: Vec2
    home_dist: tuple[float, ...]

    def rest_home(self, k: int) -> bool:
        return self.rest[k] and self.home_dist[k] <= TRIP_HOME_M


def worker_motion(samples: Sequence[PositionSample], stand: Vec2) -> WorkerMotion:
    """Smoothing, rest flags and home for one worker's samples (must be time-sorted)."""
    ordered = tuple(samples)
    sm = smooth_positions(ordered)
    rest = rest_flags(ordered, sm)
    home = resting_home(stand, sm, rest)
    return WorkerMotion(ordered, sm, rest, home, tuple(distance(p, home) for p in sm))


def _match(samples: Sequence[PositionSample], targets: Sequence[TripTarget]) -> TripTarget | None:
    best: TripTarget | None = None
    for c in targets:
        reached = any(distance(Vec2(p.x, p.z), c.stand) <= TRIP_MATCH_M for p in samples)
        if reached and (best is None or c.round_trip_m > best.round_trip_m):
            best = c
    return best


def _excursion(m: WorkerMotion, i: int, floor: int) -> tuple[int, int, int, bool]:
    """(start, back, end, ended) of the excursion that is away at sample i."""
    n = len(m.samples)
    s = i - 1
    while s > floor and not m.rest_home(s):
        s -= 1
    back = i
    while back < n and m.home_dist[back] > TRIP_EXCURSION_M:
        back += 1
    e = back
    while e < n and not m.rest_home(e) and m.home_dist[e] <= TRIP_EXCURSION_M:
        e += 1
    return s, back, e, e < n and m.rest_home(e)


def worker_trips(worker_id: str, m: WorkerMotion, targets: Sequence[TripTarget]) -> tuple[Trip, ...]:
    """Matched trips of one worker, in time order."""
    trips: list[Trip] = []
    floor = -1  # a trip may not start at or before this index (no rest since the last one)
    i = 0
    n = len(m.samples)
    while i < n:
        if m.home_dist[i] <= TRIP_EXCURSION_M:
            i += 1
            continue
        s, back, e, ended = _excursion(m, i, floor)
        if s > floor and ended:
            c = _match(m.samples[s : e + 1], targets)
            if c is not None:
                trips.append(
                    Trip(worker_id, c.kind, c.target_id, m.samples[s].t, m.samples[e].t, c.round_trip_m)
                )
        floor = e - 1 if ended else e
        i = max(e, back) + 1
    return tuple(trips)


def worker_samples(samples: Sequence[PositionSample], worker_id: str) -> tuple[PositionSample, ...]:
    """This worker's samples sorted by time (stable). Input is not changed."""
    return tuple(sorted((p for p in samples if p.worker_id == worker_id), key=lambda p: p.t))


def detect_trips(kitchen: Kitchen, samples: Sequence[PositionSample]) -> tuple[Trip, ...]:
    """All matched trips in a position log, for the kitchen's workers (same result as detectTrips)."""
    legs = menu_legs(kitchen)
    out: list[Trip] = []
    for w in kitchen.workers:
        station = kitchen.home_station(w.id)
        mine = worker_samples(samples, w.id)
        if mine:
            out.extend(
                worker_trips(
                    w.id, worker_motion(mine, station.stand), trip_targets(kitchen, station.id, legs)
                )
            )
    return tuple(out)
