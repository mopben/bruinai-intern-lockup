"""Fraction of each worker's observed time spent in each action kind."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.formats.actions import ACTION_KINDS, ActionSegment
from dryrun_vision.formats.positions import PositionSample


@dataclass(frozen=True)
class WorkerTimeShare:
    worker_id: str
    observed_s: float
    """First to last position sample of this worker."""
    fraction: dict[str, float]
    """Per kind: segment time / observed time."""
    uncovered: float
    """Observed time with no segment (gaps, flicker dropped at gaps)."""


def time_share(
    segments: Sequence[ActionSegment], samples: Sequence[PositionSample]
) -> tuple[WorkerTimeShare, ...]:
    """One entry per worker that has positions, in order of first appearance."""
    spans: dict[str, tuple[float, float]] = {}
    for p in samples:
        lo, hi = spans.get(p.worker_id, (p.t, p.t))
        spans = {**spans, p.worker_id: (min(lo, p.t), max(hi, p.t))}
    out: list[WorkerTimeShare] = []
    for wid, (lo, hi) in spans.items():
        span = hi - lo
        mine = [s for s in segments if s.worker_id == wid]
        totals = {k: sum(s.duration for s in mine if s.kind == k) for k in ACTION_KINDS}
        frac = {k: (v / span if span > 0 else 0.0) for k, v in totals.items()}
        out.append(WorkerTimeShare(wid, span, frac, max(0.0, 1.0 - sum(frac.values()))))
    return tuple(out)
