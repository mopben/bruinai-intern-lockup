"""Plain-sentence notes about position data that looks wrong. Never raises."""

from __future__ import annotations

import itertools
from collections import Counter
from collections.abc import Sequence

from dryrun_vision.actions.constants import MAX_GAP_S, MAX_PLAUSIBLE_SPEED_MPS, ROOM_MARGIN_M
from dryrun_vision.formats.positions import PositionSample
from dryrun_vision.geometry.floor import Vec2, distance
from dryrun_vision.kitchen import Kitchen


def unknown_worker_notes(kitchen: Kitchen, samples: Sequence[PositionSample]) -> tuple[str, ...]:
    known = {w.id for w in kitchen.workers}
    unknown = Counter(p.worker_id for p in samples if p.worker_id not in known)
    return tuple(
        f'Positions name worker "{wid}", who is not in layout.json: {n} samples ignored.'
        for wid, n in sorted(unknown.items())
    )


def _gap_note(worker_id: str, samples: Sequence[PositionSample]) -> str | None:
    gaps = [b.t - a.t for a, b in itertools.pairwise(samples) if b.t - a.t > MAX_GAP_S]
    if not gaps:
        return None
    return (
        f'Worker "{worker_id}": {len(gaps)} gap{"s" if len(gaps) > 1 else ""} longer than {MAX_GAP_S:g} s '
        f"({sum(gaps):.1f} s unseen in all); no actions are given for those times."
    )


def _jump_note(worker_id: str, samples: Sequence[PositionSample]) -> str | None:
    jumps = 0
    repeats = 0
    for a, b in itertools.pairwise(samples):
        dt = b.t - a.t
        if dt == 0:
            repeats += 1
        elif distance(Vec2(a.x, a.z), Vec2(b.x, b.z)) / dt > MAX_PLAUSIBLE_SPEED_MPS:
            jumps += 1
    parts = []
    if jumps:
        parts.append(f"{jumps} jump{'s' if jumps > 1 else ''} faster than {MAX_PLAUSIBLE_SPEED_MPS:g} m/s")
    if repeats:
        parts.append(f"{repeats} repeated time{'s' if repeats > 1 else ''}")
    return f'Worker "{worker_id}": {" and ".join(parts)} (tracking noise?).' if parts else None


def _outside_note(kitchen: Kitchen, worker_id: str, samples: Sequence[PositionSample]) -> str | None:
    n = sum(1 for p in samples if not kitchen.bounds.contains(Vec2(p.x, p.z), ROOM_MARGIN_M))
    if n == 0:
        return None
    plural = "s" if n > 1 else ""
    return f'Worker "{worker_id}": {n} sample{plural} more than {ROOM_MARGIN_M:g} m outside the room.'


def worker_notes(kitchen: Kitchen, worker_id: str, samples: Sequence[PositionSample]) -> tuple[str, ...]:
    """Notes for one worker's time-sorted samples: gaps, jumps, repeated times, samples outside the room."""
    if not samples:
        return (f'Worker "{worker_id}" has no positions; no actions for them.',)
    notes = (
        _gap_note(worker_id, samples),
        _jump_note(worker_id, samples),
        _outside_note(kitchen, worker_id, samples),
    )
    return tuple(n for n in notes if n is not None)
