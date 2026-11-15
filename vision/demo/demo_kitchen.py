"""Section 2: the synthetic counter-a run from above, its zone actions and the tablet taps."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from demo_common import REPO, DemoError, metres, require, seconds

from dryrun_vision.formats import ActionSegment
from dryrun_vision.formats.taps import DoneEvent, EndEvent
from dryrun_vision.geometry.floor import Vec2

RUN = REPO / "fixtures/counter-a"
RUN_FILES = ("scan.json", "setup.json", "layout.json", "taps.jsonl", "positions.jsonl", "run.json")
KINDS = ("work", "fetch", "carry", "walk", "idle")
NEAR_END_S = 2.0
"""A done tap counts as 'just after' a work segment when it falls this soon after its end."""
HINT = "It is part of the repository; restore it with git."


@dataclass(frozen=True)
class TapCheck:
    taps: int
    inside: int
    near_end: int
    none: int


def _poly(points: Sequence[Vec2]) -> list[list[float]]:
    return [[metres(p.x), metres(p.z)] for p in points]


def _items(kitchen: Any) -> list[dict[str, Any]]:  # noqa: ANN401
    return [
        {"id": it.id, "name": it.name, "role": it.role, "poly": _poly(it.footprint),
         "stand": [metres(it.stand.x), metres(it.stand.z)]}
        for it in kitchen.items
    ]  # fmt: skip


def _positions(samples: Sequence[Any], workers: Sequence[str], hz: float, n: int) -> dict[str, Any]:
    tracks: dict[str, list[Any]] = {w: [None] * n for w in workers}
    for s in samples:
        k = round(s.t * hz)
        if s.worker_id in tracks and 0 <= k < n:
            tracks[s.worker_id][k] = [metres(s.x), metres(s.z)]
    return tracks


def _segments(segs: Sequence[ActionSegment], workers: Sequence[str], names: dict[str, str]) -> list[Any]:
    return [
        [workers.index(s.worker_id), seconds(s.t0), seconds(s.t1), KINDS.index(s.kind),
         names.get(s.box_id or "", "")]
        for s in segs
    ]  # fmt: skip


def check_taps(segs: Sequence[ActionSegment], done: Sequence[DoneEvent]) -> TapCheck:
    """Same question as eval-actions: is each done tap inside its worker's work segment at that station?"""
    inside = near = 0
    for tap in done:
        work = [s for s in segs if s.kind == "work" and s.worker_id == tap.worker_id
                and s.box_id == tap.station_id]  # fmt: skip
        if any(s.t0 <= tap.t <= s.t1 for s in work):
            inside += 1
        elif any(0 <= tap.t - s.t1 <= NEAR_END_S for s in work):
            near += 1
    return TapCheck(len(done), inside, near, len(done) - inside - near)


def _share(segs: Sequence[ActionSegment], worker: str, kind: str) -> float:
    mine = [s for s in segs if s.worker_id == worker]
    total = sum(s.t1 - s.t0 for s in mine)
    return sum(s.t1 - s.t0 for s in mine if s.kind == kind) / total if total else 0.0


def build() -> dict[str, Any]:
    for name in RUN_FILES:
        require(RUN / name, f"The synthetic run file {name}", HINT)
    from dryrun_vision.commands.actions_cmd import zone_actions  # noqa: PLC0415
    from dryrun_vision.kitchen import load_kitchen  # noqa: PLC0415

    run_data, result = zone_actions(RUN)
    kitchen = load_kitchen(RUN)
    if run_data.meta.source != "synthetic":
        raise DemoError(f"{RUN.name}/run.json is not marked synthetic; the page says it is.")
    workers = [w.id for w in kitchen.workers]
    names = {it.id: it.name for it in kitchen.items}
    hz = run_data.positions.header.hz
    events = run_data.taps.events
    end = max((e.t for e in events if isinstance(e, EndEvent)), default=0.0)
    done = [e for e in events if isinstance(e, DoneEvent)]
    n = int(end * hz) + 1
    taps = check_taps(result.segments, done)
    b = kitchen.bounds
    return {
        "title": run_data.meta.title, "duration": seconds(end), "hz": hz,
        "workers": [{"id": w.id, "name": w.name, "station": names[w.station_id]} for w in kitchen.workers],
        "items": _items(kitchen), "walls": [_poly(w.footprint) for w in kitchen.walls],
        "bounds": [metres(b.min_x), metres(b.max_x), metres(b.min_z), metres(b.max_z)],
        "kinds": list(KINDS), "segments": _segments(result.segments, workers, names),
        "taps": [[workers.index(d.worker_id), seconds(d.t)] for d in done if d.worker_id in workers],
        "pos": _positions(run_data.positions.samples, workers, hz, n),
        "numbers": {
            "segments": len(result.segments), "trips": len(result.trips), "taps": taps.taps,
            "tapsInside": taps.inside, "tapsNearEnd": taps.near_end, "tapsNone": taps.none,
            "tillWorkShare": round(_share(result.segments, workers[0], "work"), 3),
        },
    }  # fmt: skip


def sources() -> tuple[Path, ...]:
    return tuple(RUN / n for n in RUN_FILES)
