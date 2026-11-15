"""positions.jsonl + kitchen -> action segments (the "zones" source of actions.jsonl).

Per worker, every sample gets a label:
- inside a trip found by trips.py (trip.t0 <= t < trip.t1): `fetch` or `carry` with the trip's target;
- at rest within WORK_STAND_M of the worker's home or own stand point: `work` at their station;
- at rest within WORK_STAND_M of another station's stand point: `work` at that station;
- at rest anywhere else: `idle`;
- moving and not in a trip: `walk`.
Consecutive equal labels form a run; runs also split at gaps longer than MAX_GAP_S (no
segment covers a gap, except a trip, which is kept whole and noted). A run lasts until
the next run starts, or until its last sample before a gap. Walk/idle/work runs shorter
than MIN_SEGMENT_S are absorbed into a touching non-trip neighbour.

Being still at home counts as `work` even while waiting for an order: positions alone
cannot tell waiting from working. The ML labeller may refine that later.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass, replace

from dryrun_vision.actions.anomalies import unknown_worker_notes, worker_notes
from dryrun_vision.actions.constants import MAX_GAP_S, MIN_SEGMENT_S, WORK_STAND_M
from dryrun_vision.actions.trips import Trip, WorkerMotion, worker_motion, worker_samples, worker_trips
from dryrun_vision.formats.actions import ActionKind, ActionSegment, sort_segments
from dryrun_vision.formats.base import round_time
from dryrun_vision.formats.positions import PositionSample
from dryrun_vision.geometry.floor import Vec2, distance
from dryrun_vision.kitchen import Kitchen, KitchenItem, Leg, menu_legs, trip_targets

Label = tuple[ActionKind, str | None, int | None]
"""(kind, boxId, trip index). The trip index keeps two back-to-back trips to one target apart."""
TRIP_KINDS: frozenset[str] = frozenset({"fetch", "carry"})


@dataclass(frozen=True)
class SegmentationResult:
    segments: tuple[ActionSegment, ...]
    """File order (t0, then workerId), ready for write_actions."""
    trips: tuple[Trip, ...]
    """The trips the fetch/carry segments come from (same definition as src/core/trips.ts)."""
    warnings: tuple[str, ...]
    """Anomalies in plain sentences: gaps, jumps, unknown workers, trips across gaps."""


@dataclass(frozen=True)
class _Run:
    label: Label
    start: int
    end: int
    """Index of the last sample in the run (inclusive)."""


def _rest_label(p: Vec2, own: KitchenItem, home: Vec2, stations: Sequence[KitchenItem]) -> Label:
    if distance(p, home) <= WORK_STAND_M or distance(p, own.stand) <= WORK_STAND_M:
        return ("work", own.id, None)
    near = [(distance(p, s.stand), s.id) for s in stations if distance(p, s.stand) <= WORK_STAND_M]
    return ("work", min(near)[1], None) if near else ("idle", None, None)


def _labels(
    m: WorkerMotion, own: KitchenItem, stations: Sequence[KitchenItem], trips: Sequence[Trip]
) -> list[Label]:
    labels: list[Label] = []
    for k, sample in enumerate(m.samples):
        trip = next(((i, tr) for i, tr in enumerate(trips) if tr.t0 <= sample.t < tr.t1), None)
        if trip is not None:
            labels.append((trip[1].kind, trip[1].target_id, trip[0]))
        elif m.rest[k]:
            labels.append(_rest_label(m.smoothed[k], own, m.home, stations))
        else:
            labels.append(("walk", None, None))
    return labels


def _joined(samples: Sequence[PositionSample], i: int) -> bool:
    """True when sample i+1 follows sample i without a gap."""
    return i + 1 < len(samples) and samples[i + 1].t - samples[i].t <= MAX_GAP_S


def _runs(samples: Sequence[PositionSample], labels: Sequence[Label]) -> list[_Run]:
    runs: list[_Run] = []
    for i, label in enumerate(labels):
        prev = runs[-1] if runs else None
        same_trip = prev is not None and label == prev.label and label[0] in TRIP_KINDS
        if prev is not None and label == prev.label and (_joined(samples, i - 1) or same_trip):
            runs[-1] = replace(prev, end=i)
        else:
            runs.append(_Run(label, i, i))
    return runs


def _t1(samples: Sequence[PositionSample], r: _Run) -> float:
    return samples[r.end + 1].t if _joined(samples, r.end) else samples[r.end].t


def _touch(samples: Sequence[PositionSample], a: _Run, b: _Run) -> bool:
    return b.start == a.end + 1 and _joined(samples, a.end)


def _absorb_short(samples: Sequence[PositionSample], runs: Sequence[_Run]) -> list[_Run]:
    out: list[_Run] = []
    for i, r in enumerate(runs):
        short = r.label[0] not in TRIP_KINDS and _t1(samples, r) - samples[r.start].t < MIN_SEGMENT_S
        prev = out[-1] if out else None
        nxt = runs[i + 1] if i + 1 < len(runs) else None
        if short and prev is not None and prev.label[0] not in TRIP_KINDS and _touch(samples, prev, r):
            out[-1] = replace(prev, end=r.end)
        elif short and nxt is not None and nxt.label[0] not in TRIP_KINDS and _touch(samples, r, nxt):
            out.append(replace(r, label=nxt.label))  # merged with nxt below
        else:
            out.append(r)
    return _merge_equal(samples, out)


def _merge_equal(samples: Sequence[PositionSample], runs: Sequence[_Run]) -> list[_Run]:
    out: list[_Run] = []
    for r in runs:
        prev = out[-1] if out else None
        if prev is not None and prev.label == r.label and _touch(samples, prev, r):
            out[-1] = replace(prev, end=r.end)
        else:
            out.append(r)
    return out


def _to_segments(
    worker_id: str, samples: Sequence[PositionSample], runs: Sequence[_Run]
) -> list[ActionSegment]:
    segs: list[ActionSegment] = []
    for r in runs:
        t0, t1 = round_time(samples[r.start].t), round_time(_t1(samples, r))
        if t1 > t0:
            segs.append(ActionSegment(worker_id=worker_id, t0=t0, t1=t1, kind=r.label[0], box_id=r.label[1]))
    return segs


def _trip_gap_notes(worker_id: str, samples: Sequence[PositionSample], trips: Sequence[Trip]) -> list[str]:
    notes: list[str] = []
    for tr in trips:
        inside = [p.t for p in samples if tr.t0 <= p.t <= tr.t1]
        gap = max((b - a for a, b in itertools.pairwise(inside)), default=0.0)
        if gap > MAX_GAP_S:
            notes.append(
                f'Worker "{worker_id}": the {tr.kind} trip at t={tr.t0:.3f} s spans a gap of {gap:.1f} s.'
            )
    return notes


def _segment_worker(
    kitchen: Kitchen, worker_id: str, samples: Sequence[PositionSample], legs: tuple[Leg, ...]
) -> tuple[list[ActionSegment], tuple[Trip, ...], list[str]]:
    own = kitchen.home_station(worker_id)
    m = worker_motion(samples, own.stand)
    trips = worker_trips(worker_id, m, trip_targets(kitchen, own.id, legs))
    labels = _labels(m, own, kitchen.stations, trips)
    runs = _absorb_short(m.samples, _runs(m.samples, labels))
    return _to_segments(worker_id, m.samples, runs), trips, _trip_gap_notes(worker_id, m.samples, trips)


def segment_actions(kitchen: Kitchen, samples: Sequence[PositionSample]) -> SegmentationResult:
    """Zone-based action segments for every worker in the kitchen. Never raises on odd data."""
    legs = menu_legs(kitchen)
    segments: list[ActionSegment] = []
    trips: list[Trip] = []
    warnings: list[str] = list(unknown_worker_notes(kitchen, samples))
    for w in kitchen.workers:
        mine = worker_samples(samples, w.id)
        warnings.extend(worker_notes(kitchen, w.id, mine))
        if not mine:
            continue
        segs, wtrips, notes = _segment_worker(kitchen, w.id, mine, legs)
        segments.extend(segs)
        trips.extend(wtrips)
        warnings.extend(notes)
    return SegmentationResult(sort_segments(segments), tuple(trips), tuple(warnings))
