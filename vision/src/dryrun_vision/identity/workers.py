"""Give stitched tracks to the kitchen's workers.

1. Each worker's resting spot: their home station's stand point; workers sharing a station are
   spread along its stand side (SHARED_SLOT_SPACING_M apart, layout order).
2. Global one-to-one assignment (Hungarian): the score of (track, worker) is the seconds the track
   spends within NEAR_REST_M of the worker's spot; at least MIN_NEAR_S. Most total time wins.
3. Fill: a leftover track joins a worker when it does not overlap that worker's track in time and
   either rests at the worker's spot, or carries on from (or into) it within FILL_MAX_GAP_S and
   walking reach. Anything else is left out, never guessed.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from dryrun_vision.geometry import Vec2, distance
from dryrun_vision.hungarian import assign
from dryrun_vision.identity.constants import (
    END_SPAN_S,
    FILL_MAX_GAP_S,
    MIN_NEAR_S,
    NEAR_REST_M,
    SHARED_SLOT_SPACING_M,
)
from dryrun_vision.identity.fragments import Fragment, end_point, overlaps, start_point
from dryrun_vision.identity.rest import seconds_near, total_seconds
from dryrun_vision.identity.stitch import reach_m
from dryrun_vision.kitchen import Kitchen

Group = tuple[Fragment, ...]
Assigned = Mapping[str, tuple[Group, ...]]


@dataclass(frozen=True)
class WorkerSpot:
    worker_id: str
    station_id: str
    spot: Vec2
    """Where this worker is expected to rest (floor metres)."""
    mates: tuple[str, ...]
    """Every worker at this station, in layout order (just this one when not shared)."""


def worker_spots(kitchen: Kitchen) -> tuple[WorkerSpot, ...]:
    """Resting spot of every worker, in layout order."""
    out: list[WorkerSpot] = []
    for w in kitchen.workers:
        station = kitchen.home_station(w.id)
        mates = tuple(m.id for m in kitchen.workers if m.station_id == w.station_id)
        nx, nz = station.stand.x - station.rect.center.x, station.stand.z - station.rect.center.z
        norm = math.hypot(nx, nz)
        tx, tz = (nz / norm, -nx / norm) if norm > 0 else (1.0, 0.0)
        along = (mates.index(w.id) - (len(mates) - 1) / 2) * SHARED_SLOT_SPACING_M
        spot = Vec2(station.stand.x + tx * along, station.stand.z + tz * along)
        out.append(WorkerSpot(w.id, station.id, spot, mates))
    return tuple(out)


def shared_station_notes(spots: Sequence[WorkerSpot]) -> tuple[str, ...]:
    """One plain warning per station that more than one worker shares."""
    seen: dict[str, tuple[str, ...]] = {s.station_id: s.mates for s in spots if len(s.mates) > 1}
    return tuple(
        f'Workers {", ".join(mates)} share station "{station}". They are told apart only by where they '
        "stand along it (in layout order, left to right as seen facing the station). If they swap "
        "places, their ids swap."
        for station, mates in seen.items()
    )


def _near_score(group: Group, spot: WorkerSpot) -> float:
    s = seconds_near(group, spot.spot, NEAR_REST_M)
    return -s if s >= MIN_NEAR_S else math.inf


def assign_workers(
    groups: Sequence[Group], spots: Sequence[WorkerSpot]
) -> tuple[dict[str, Group], list[Group]]:
    """(worker id -> the group assigned in the global step, groups left over)."""
    cost = [[_near_score(g, s) for s in spots] for g in groups]
    pairs = assign(cost)
    taken = {gi for gi, _ in pairs}
    assigned = {spots[si].worker_id: groups[gi] for gi, si in pairs}
    return assigned, [g for gi, g in enumerate(groups) if gi not in taken]


def _continuity_m(pieces: Sequence[Group], g: Group) -> float:
    """Distance from the worker's track to g where one carries on into the other, else inf."""
    best = math.inf
    first, last = g[0], g[-1]
    for piece in pieces:
        before, after = piece[-1], piece[0]
        gap_in = first.t0 - before.t1
        if 0 < gap_in <= FILL_MAX_GAP_S:
            d = distance(end_point(before, END_SPAN_S), start_point(first, END_SPAN_S))
            best = min(best, d) if d <= reach_m(gap_in) else best
        gap_out = after.t0 - last.t1
        if 0 < gap_out <= FILL_MAX_GAP_S:
            d = distance(end_point(last, END_SPAN_S), start_point(after, END_SPAN_S))
            best = min(best, d) if d <= reach_m(gap_out) else best
    return best


def _fill_target(g: Group, assigned: Assigned, spots: Sequence[WorkerSpot]) -> str | None:
    free = [s for s in spots if s.worker_id in assigned and not overlaps(_flat(assigned[s.worker_id]), g)]
    resting = [(_near_score(g, s), s.worker_id) for s in free]
    resting = [r for r in resting if math.isfinite(r[0])]
    if resting:
        return min(resting)[1]
    joins = [(_continuity_m(assigned[s.worker_id], g), s.worker_id) for s in free]
    joins = [j for j in joins if math.isfinite(j[0])]
    return min(joins)[1] if joins else None


def _flat(pieces: Sequence[Group]) -> tuple[Fragment, ...]:
    return tuple(f for p in pieces for f in p)


def fill_workers(
    assigned: Mapping[str, Group], leftovers: Sequence[Group], spots: Sequence[WorkerSpot]
) -> tuple[dict[str, tuple[Group, ...]], list[Group]]:
    """Joins leftover groups to workers (longest first). Returns (worker -> groups, still left over)."""
    out: dict[str, tuple[Group, ...]] = {w: (g,) for w, g in assigned.items()}
    rest: list[Group] = []
    for g in sorted(leftovers, key=total_seconds, reverse=True):
        target = _fill_target(g, out, spots)
        if target is None:
            rest.append(g)
        else:
            out = {**out, target: (*out[target], g)}
    return out, rest
