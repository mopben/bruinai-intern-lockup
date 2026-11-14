"""People -> PositionSample lines: project each box at the worker's height, reject, resample."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.actions.constants import ROOM_MARGIN_M
from dryrun_vision.clock import NO_OFFSET, RunClock
from dryrun_vision.formats import CalibrationFile, PositionSample
from dryrun_vision.geometry import CameraModel, Vec2
from dryrun_vision.identity import Anchor, IdentityResult, Person, floor_point, worker_head_height
from dryrun_vision.kitchen import Kitchen
from dryrun_vision.positions.resample import PRODUCT_HZ, resample_track

POSITION_ROOM_MARGIN_M = ROOM_MARGIN_M
"""Metres. A floor point further than this outside the room bounds is a bad box (or a wrong height)
and is dropped before resampling: the same margin at which the action segmentation flags samples."""


@dataclass(frozen=True)
class PositionsResult:
    samples: tuple[PositionSample, ...]
    """Time order; at equal times, people in identity order."""
    rejected: dict[str, int]
    """Per person, boxes dropped for landing outside the room (only people with any)."""
    warnings: tuple[str, ...]


def _floor_track(
    person: Person, model: CameraModel, cal: CalibrationFile | None, kitchen: Kitchen | None, anchor: Anchor
) -> tuple[list[float], list[Vec2], int]:
    height = worker_head_height(cal, person.name)
    times: list[float] = []
    points: list[Vec2] = []
    rejected = 0
    for d in person.detections:
        p = floor_point(model, d, anchor, height)
        if p is None or (kitchen is not None and not kitchen.bounds.contains(p, POSITION_ROOM_MARGIN_M)):
            rejected += 1
            continue
        times.append(d.t)
        points.append(p)
    return times, points, rejected


def _samples(name: str, ticks: Sequence[tuple[float, Vec2]]) -> list[PositionSample]:
    return [PositionSample(t=t, worker_id=name, x=p.x, z=p.z) for t, p in ticks]


def build_positions(
    identity: IdentityResult,
    model: CameraModel,
    cal: CalibrationFile | None,
    kitchen: Kitchen | None,
    *,
    anchor: Anchor = "head",
    clock: RunClock = NO_OFFSET,
    hz: float = PRODUCT_HZ,
) -> PositionsResult:
    """10 Hz samples for every person. Times are run times (`clock`); earlier ticks are dropped."""
    samples: list[PositionSample] = []
    rejected: dict[str, int] = {}
    warnings: list[str] = []
    for person in identity.people:
        times, points, bad = _floor_track(person, model, cal, kitchen, anchor)
        if bad:
            rejected = {**rejected, person.name: bad}
            warnings.append(
                f'"{person.name}": {bad} of {len(person.detections)} boxes landed outside the room '
                f"(more than {POSITION_ROOM_MARGIN_M} m beyond its bounds) and were left out."
            )
        samples.extend(_samples(person.name, resample_track(times, points, hz, clock)))
    ordered = sorted(samples, key=lambda s: s.t)
    return PositionsResult(tuple(ordered), rejected, tuple(warnings))
