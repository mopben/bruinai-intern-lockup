"""Raw tracker output -> people: one per worker with a kitchen, or p1, p2, ... without one."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.formats import CalibrationFile, Detection
from dryrun_vision.geometry import CameraModel
from dryrun_vision.identity.anchor import Anchor, floor_point, nominal_head_height
from dryrun_vision.identity.constants import MIN_FRAGMENT_DETECTIONS, MIN_INSIDE_S, WORK_AREA_MARGIN_M
from dryrun_vision.identity.fragments import Fragment, Person, build_fragments, merged
from dryrun_vision.identity.rest import seconds_inside, total_seconds
from dryrun_vision.identity.stitch import stitch
from dryrun_vision.identity.workers import (
    Group,
    assign_workers,
    fill_workers,
    shared_station_notes,
    worker_spots,
)
from dryrun_vision.kitchen import Kitchen

GENERIC_PREFIX = "p"


@dataclass(frozen=True)
class DroppedTrack:
    track_ids: tuple[int, ...]
    reason: str
    seconds: float


@dataclass(frozen=True)
class IdentityResult:
    people: tuple[Person, ...]
    """Workers in layout order (only those found), or p1, p2, ... by start time."""
    dropped: tuple[DroppedTrack, ...]
    warnings: tuple[str, ...]

    def name_of(self, track_id: int) -> str | None:
        """Who a raw tracker id was assigned to, if anyone."""
        return next((p.name for p in self.people if track_id in p.track_ids), None)


def _dropped(group: Sequence[Fragment], reason: str) -> DroppedTrack:
    return DroppedTrack(tuple(f.track_id for f in group), reason, round(total_seconds(group), 3))


def _generic(groups: Sequence[Group], dropped: list[DroppedTrack]) -> IdentityResult:
    people = tuple(merged(f"{GENERIC_PREFIX}{i + 1}", g) for i, g in enumerate(groups))
    return IdentityResult(people, tuple(dropped), ())


def _with_kitchen(groups: Sequence[Group], kitchen: Kitchen, dropped: list[DroppedTrack]) -> IdentityResult:
    flags = [seconds_inside(g, kitchen.bounds, WORK_AREA_MARGIN_M) >= MIN_INSIDE_S for g in groups]
    inside = [g for g, ok in zip(groups, flags, strict=True) if ok]
    out = [
        _dropped(g, "never inside the working area") for g, ok in zip(groups, flags, strict=True) if not ok
    ]
    spots = worker_spots(kitchen)
    first, leftovers = assign_workers(inside, spots)
    assigned, rest = fill_workers(first, leftovers, spots)
    out += [_dropped(g, "never at a worker's place and not continuous with any worker") for g in rest]
    people = tuple(merged(w.id, *assigned[w.id]) for w in kitchen.workers if w.id in assigned)
    missing = [w.id for w in kitchen.workers if w.id not in assigned]
    warnings = [*shared_station_notes(spots)]
    warnings += [f'Worker "{w}" was not found: no track rested at their station.' for w in missing]
    return IdentityResult(people, tuple(dropped + out), tuple(warnings))


def identify(
    detections: Sequence[Detection],
    model: CameraModel,
    cal: CalibrationFile | None,
    kitchen: Kitchen | None,
    anchor: Anchor = "head",
) -> IdentityResult:
    """Fragments -> stitched tracks -> workers (or generic people). Never changes its inputs."""
    height = nominal_head_height(cal)
    frags = build_fragments(detections, lambda d: floor_point(model, d, anchor, height))
    keep = [f for f in frags if len(f.detections) >= MIN_FRAGMENT_DETECTIONS]
    dropped = [
        _dropped((f,), "too short (a flicker)") for f in frags if len(f.detections) < MIN_FRAGMENT_DETECTIONS
    ]
    groups = stitch(keep)
    return _generic(groups, dropped) if kitchen is None else _with_kitchen(groups, kitchen, dropped)
