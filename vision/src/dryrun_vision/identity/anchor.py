"""Which point of a person box stands for the person, and at what height above the floor.

- head (default): top-centre of the box, at the worker's anchor height (`hatHeights`, default 1.70 m).
  Works when counters hide the feet, as they usually do in a café.
- foot: bottom-centre of the box, on the floor. Better when the feet are visible (no height to guess).

The head anchor is corrected for the lean of a person in the picture (see lean.py); the foot
anchor is not (LEAN_CORRECTED_ANCHORS).
"""

from __future__ import annotations

from statistics import fmean
from typing import Literal

from dryrun_vision.formats import DEFAULT_ANCHOR_HEIGHT_M, CalibrationFile, Detection, anchor_height
from dryrun_vision.geometry import CameraModel, Vec2, image_to_floor_at
from dryrun_vision.geometry.homography import Pt
from dryrun_vision.identity.lean import lean_corrected

Anchor = Literal["head", "foot"]
ANCHORS: tuple[Anchor, ...] = ("head", "foot")
LEAN_CORRECTED_ANCHORS: frozenset[Anchor] = frozenset({"head"})
"""The lean correction's benefit is shown on synthetic boxes only. On PETS09-S2L1 it helped the head
anchor a little (median 0.309 -> 0.303 m) and hurt the foot anchor (0.198 -> 0.209 m)."""


def anchor_point(det: Detection, anchor: Anchor) -> Pt:
    """The image point of the box that stands for the person, in source pixels."""
    cx = det.x + det.w / 2
    return (cx, det.y) if anchor == "head" else (cx, det.y + det.h)


def floor_point(
    model: CameraModel, det: Detection, anchor: Anchor, head_height_m: float, correct_lean: bool = True
) -> Vec2 | None:
    """Floor point under the person. `head_height_m` is used for the head anchor only.

    With correct_lean (default) and an anchor in LEAN_CORRECTED_ANCHORS the plain top-/bottom-centre
    estimate is refined so that the person's tilted image axis explains the box (identity/lean.py).
    """
    h = head_height_m if anchor == "head" else 0.0
    plain = image_to_floor_at(model, anchor_point(det, anchor), h)
    if not correct_lean or anchor not in LEAN_CORRECTED_ANCHORS:
        return plain
    return lean_corrected(model, det, anchor, head_height_m, plain)


def nominal_head_height(cal: CalibrationFile | None) -> float:
    """Head height to use before anyone is known: the mean of the calibrated heights, else the default."""
    if cal is None or not cal.hat_heights:
        return DEFAULT_ANCHOR_HEIGHT_M
    return fmean(cal.hat_heights.values())


def worker_head_height(cal: CalibrationFile | None, worker_id: str) -> float:
    """This worker's anchor height (calibration hatHeights, else DEFAULT_ANCHOR_HEIGHT_M)."""
    return DEFAULT_ANCHOR_HEIGHT_M if cal is None else anchor_height(cal, worker_id)
