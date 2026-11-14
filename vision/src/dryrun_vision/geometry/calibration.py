"""Calibration file -> camera model and per-point errors (port of src/camera/calibration.ts).

Floor pairs (|y| <= FLOOR_EPS_M) give the floor homography. With MIN_TOP_POINTS or
more pairs above the floor the "box-tops" method gives `up`; otherwise "lens".
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.errors import CalibrationError
from dryrun_vision.formats.calibration import CalibrationFile, ImageSize, PointPair
from dryrun_vision.geometry.camera_model import (
    CameraModel,
    image_to_floor_at,
    model_from_lens,
    model_from_tops,
)
from dryrun_vision.geometry.floor import Vec2
from dryrun_vision.geometry.homography import solve_homography

FLOOR_EPS_M = 0.01
"""Metres. Points within this of the floor count as floor points."""
MIN_FLOOR_POINTS = 4
MIN_TOP_POINTS = 2
SUSPECT_MIN_CM = 5.0
"""Centimetres. A click worth flagging as wrong is at least this far off."""
SUSPECT_IMPROVEMENT = 0.5
"""Leaving the suspect out must cut the RMS error to below this fraction."""
CM_PER_M = 100.0


@dataclass(frozen=True)
class SolvedCalibration:
    model: CameraModel
    errors_cm: tuple[float, ...]
    """Per pair: floor distance between where its click maps and where it should be, cm."""
    rms_cm: float
    floor_count: int
    top_count: int
    suspect: int | None
    """Index of the pair that is most likely a wrong click, if one clearly is."""


def _is_floor(p: PointPair) -> bool:
    return abs(p.world.y) <= FLOOR_EPS_M


def _error_cm(model: CameraModel, p: PointPair) -> float:
    g = image_to_floor_at(model, (p.image.x, p.image.y), p.world.y)
    return math.inf if g is None else math.hypot(g.x - p.world.x, g.z - p.world.z) * CM_PER_M


def _rms(values: Sequence[float]) -> float:
    return math.sqrt(sum(v * v for v in values) / len(values))


def _solve_model(pairs: Sequence[PointPair], size: ImageSize) -> tuple[CameraModel, int, int]:
    floor = [p for p in pairs if _is_floor(p)]
    tops = [p for p in pairs if p.world.y > FLOOR_EPS_M]
    if len(floor) < MIN_FLOOR_POINTS:
        k = MIN_FLOOR_POINTS - len(floor)
        raise CalibrationError(
            f"Match {k} more floor point{'' if k == 1 else 's'} (at least {MIN_FLOOR_POINTS})."
        )
    h = solve_homography([(p.world.x, p.world.z) for p in floor], [(p.image.x, p.image.y) for p in floor])
    centroid = Vec2(sum(p.world.x for p in floor) / len(floor), sum(p.world.z for p in floor) / len(floor))
    if len(tops) >= MIN_TOP_POINTS:
        model = model_from_tops(h, tops)
    else:
        model = model_from_lens(h, size.width, size.height, centroid)
    return model, len(floor), len(tops)


def _without(pairs: Sequence[PointPair], i: int) -> list[PointPair]:
    return [*pairs[:i], *pairs[i + 1 :]]


def _leave_one_out_rms(pairs: Sequence[PointPair], size: ImageSize, i: int) -> float | None:
    rest = _without(pairs, i)
    try:
        model, _, _ = _solve_model(rest, size)
    except CalibrationError:
        return None
    return _rms([_error_cm(model, q) for q in rest])


def _find_suspect(
    pairs: Sequence[PointPair], size: ImageSize, rms_cm: float, floor_n: int, top_n: int
) -> int | None:
    if rms_cm < SUSPECT_MIN_CM / 2:
        return None
    best: tuple[int, float] | None = None
    for i, p in enumerate(pairs):
        is_top = p.world.y > FLOOR_EPS_M
        if (top_n <= MIN_TOP_POINTS) if is_top else (floor_n <= MIN_FLOOR_POINTS):
            continue
        rms = _leave_one_out_rms(pairs, size, i)
        if rms is not None and (best is None or rms < best[1]):
            best = (i, rms)
    if best is None:
        return None
    i, rms = best
    try:
        own_model, _, _ = _solve_model(_without(pairs, i), size)
        own_err = _error_cm(own_model, pairs[i])
    except CalibrationError:
        own_err = 0.0
    return i if rms < rms_cm * SUSPECT_IMPROVEMENT and own_err > SUSPECT_MIN_CM else None


def solve_calibration(pairs: Sequence[PointPair], image_size: ImageSize) -> SolvedCalibration:
    """Same model as solveCalibration in calibration.ts. Raises CalibrationError in plain words."""
    model, floor_n, top_n = _solve_model(pairs, image_size)
    errors = tuple(_error_cm(model, p) for p in pairs)
    rms = _rms(errors)
    suspect = _find_suspect(pairs, image_size, rms, floor_n, top_n)
    return SolvedCalibration(model, errors, rms, floor_n, top_n, suspect)


def model_from_calibration(cal: CalibrationFile) -> CameraModel:
    """The camera model for an exported calibration file."""
    return solve_calibration(cal.pairs, cal.image_size).model
