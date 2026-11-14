"""Person boxes to floor points: the anchor is the top-centre of the box (top of the head)."""

from __future__ import annotations

from dryrun_vision.formats.tracks import Detection
from dryrun_vision.geometry.camera_model import CameraModel, image_to_floor_at
from dryrun_vision.geometry.floor import Vec2
from dryrun_vision.geometry.homography import Pt


def anchor_pixel(det: Detection) -> Pt:
    """Top-centre of the detection box, in source-video pixels."""
    return (det.x + det.w / 2, det.y)


def detection_floor_point(model: CameraModel, det: Detection, anchor_height_m: float) -> Vec2 | None:
    """Floor point under the detection's anchor, assumed anchor_height_m metres up. None if undefined."""
    return image_to_floor_at(model, anchor_pixel(det), anchor_height_m)
