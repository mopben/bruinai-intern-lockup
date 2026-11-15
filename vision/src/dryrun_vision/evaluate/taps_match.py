"""Does each "done" tap have a `work` segment by that worker at that station around it?

A segment matches a tap when it contains the tap time, or ends within NEAR_TAP_S of
it. Among matches the one whose end is closest to the tap wins. A done tap without a
workerId may match any worker's segment at that station.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.evaluate.stats import Distribution, distribution
from dryrun_vision.formats.actions import ActionSegment
from dryrun_vision.formats.taps import DoneEvent

NEAR_TAP_S = 2.0
"""Seconds. A work segment ending this close to a done tap (before or after) still matches it.
Workers tap right as they finish, so the segment end should be within a second or two."""


@dataclass(frozen=True)
class TapMatch:
    order_id: str
    step: int
    station_id: str
    worker_id: str | None
    tap_t: float
    segment_t0: float | None
    segment_t1: float | None
    contains: bool
    end_offset_s: float | None
    """segment end minus tap time (negative: the segment ended before the tap)."""


@dataclass(frozen=True)
class TapMatchSummary:
    taps: int
    containing: int
    near: int
    unmatched: int
    without_worker_id: int
    taps_on_shared_segment: int
    """Matched taps whose segment also matched another tap (one long segment covering many orders)."""
    abs_end_offset_s: Distribution
    """|segment end - tap time| over matched taps."""
    abs_end_offset_unshared_s: Distribution
    """The same, only over taps whose segment matched no other tap (a long shared segment's end
    says nothing about when one step finished)."""
    matches: tuple[TapMatch, ...]


def _candidates(tap: DoneEvent, segments: Sequence[ActionSegment]) -> list[ActionSegment]:
    return [
        s
        for s in segments
        if s.kind == "work"
        and s.box_id == tap.station_id
        and (tap.worker_id is None or s.worker_id == tap.worker_id)
        and (s.t0 <= tap.t <= s.t1 or abs(s.t1 - tap.t) <= NEAR_TAP_S)
    ]


def match_tap(tap: DoneEvent, segments: Sequence[ActionSegment]) -> TapMatch:
    cands = _candidates(tap, segments)
    best = min(cands, key=lambda s: abs(s.t1 - tap.t), default=None)
    base = {
        "order_id": tap.order_id,
        "step": tap.step,
        "station_id": tap.station_id,
        "worker_id": tap.worker_id,
        "tap_t": tap.t,
    }
    if best is None:
        return TapMatch(**base, segment_t0=None, segment_t1=None, contains=False, end_offset_s=None)
    return TapMatch(
        **base,
        segment_t0=best.t0,
        segment_t1=best.t1,
        contains=best.t0 <= tap.t <= best.t1,
        end_offset_s=best.t1 - tap.t,
    )


def _segment_key(m: TapMatch) -> tuple[object, ...]:
    return (m.worker_id, m.station_id, m.segment_t0, m.segment_t1)


def _abs_offsets(matches: Sequence[TapMatch]) -> list[float]:
    return [abs(m.end_offset_s) for m in matches if m.end_offset_s is not None]


def match_done_taps(taps: Sequence[DoneEvent], segments: Sequence[ActionSegment]) -> TapMatchSummary:
    matches = tuple(match_tap(t, segments) for t in taps)
    found = [m for m in matches if m.segment_t1 is not None]
    used = Counter(_segment_key(m) for m in found)
    unshared = [m for m in found if used[_segment_key(m)] == 1]
    return TapMatchSummary(
        taps=len(matches),
        containing=sum(1 for m in found if m.contains),
        near=sum(1 for m in found if not m.contains),
        unmatched=len(matches) - len(found),
        without_worker_id=sum(1 for t in taps if t.worker_id is None),
        taps_on_shared_segment=len(found) - len(unshared),
        abs_end_offset_s=distribution(_abs_offsets(found)),
        abs_end_offset_unshared_s=distribution(_abs_offsets(unshared)),
        matches=matches,
    )
