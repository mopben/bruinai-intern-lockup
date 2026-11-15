"""Compare pipeline output with a fixture: floor error and zone-action agreement."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import fmean, median

from dryrun_vision.formats import ActionSegment, PositionSample
from synth import FIXTURE_MAX_GAP_S, _interp

GRID_S = 0.1
"""Seconds. Action labels are compared on this grid (the product's sample period)."""


@dataclass(frozen=True)
class FloorError:
    worker_id: str
    samples: int
    mean_cm: float
    p95_cm: float
    worst_cm: float


def floor_errors(
    ours: Sequence[PositionSample], truth: dict[str, list[PositionSample]]
) -> tuple[FloorError, ...]:
    out: list[FloorError] = []
    for w, ref in truth.items():
        errs = []
        for s in (s for s in ours if s.worker_id == w):
            p = _interp(ref, s.t)
            if p is not None:
                errs.append(math.hypot(s.x - p[0], s.z - p[1]) * 100)
        errs.sort()
        p95 = errs[min(len(errs) - 1, int(0.95 * len(errs)))] if errs else math.nan
        out.append(
            FloorError(w, len(errs), fmean(errs) if errs else math.nan, p95, max(errs, default=math.nan))
        )
    return tuple(out)


def coverage(ours: Sequence[PositionSample], truth: dict[str, list[PositionSample]]) -> dict[str, float]:
    """Share of 10 Hz ticks covered by the fixture that the pipeline also has a sample for."""
    out: dict[str, float] = {}
    for w, ref in truth.items():
        have = {round(s.t * 10) for s in ours if s.worker_id == w}
        ticks = [
            k for k in range(math.ceil(ref[0].t * 10), math.floor(ref[-1].t * 10) + 1) if _interp(ref, k / 10)
        ]
        out[w] = sum(1 for k in ticks if k in have) / len(ticks)
    return out


def _label_at(segs: Sequence[ActionSegment], t: float) -> tuple[str, str | None] | None:
    s = next((s for s in segs if s.t0 <= t < s.t1), None)
    return None if s is None else (s.kind, s.box_id)


def label_agreement(
    ours: Sequence[ActionSegment], ref: Sequence[ActionSegment], worker: str
) -> tuple[float, float]:
    """(share of reference-labelled ticks with the same label, share of them we label at all)."""
    mine = [s for s in ours if s.worker_id == worker]
    theirs = [s for s in ref if s.worker_id == worker]
    end = max(s.t1 for s in theirs)
    same = labelled = total = 0
    for k in range(math.ceil(end / GRID_S)):
        t = k * GRID_S
        r = _label_at(theirs, t)
        if r is None:
            continue
        total += 1
        o = _label_at(mine, t)
        labelled += o is not None
        same += o == r
    return same / total, labelled / total


@dataclass(frozen=True)
class SegmentMatch:
    matched: int
    total: int
    boundary_median_s: float
    boundary_worst_s: float


def segment_match(
    ours: Sequence[ActionSegment], ref: Sequence[ActionSegment], kinds: frozenset[str]
) -> SegmentMatch:
    """Reference segments of these kinds with an overlapping one of ours of the same kind and box."""
    deltas: list[float] = []
    matched = total = 0
    for r in (s for s in ref if s.kind in kinds):
        total += 1
        cands = [
            o
            for o in ours
            if o.worker_id == r.worker_id
            and o.kind == r.kind
            and o.box_id == r.box_id
            and o.t0 < r.t1
            and r.t0 < o.t1
        ]
        if not cands:
            continue
        best = min(cands, key=lambda o: abs(o.t0 - r.t0) + abs(o.t1 - r.t1))
        matched += 1
        deltas.extend((abs(best.t0 - r.t0), abs(best.t1 - r.t1)))
    return SegmentMatch(matched, total, median(deltas) if deltas else math.nan, max(deltas, default=math.nan))


__all__ = [
    "FIXTURE_MAX_GAP_S",
    "FloorError",
    "SegmentMatch",
    "coverage",
    "floor_errors",
    "label_agreement",
    "segment_match",
]
