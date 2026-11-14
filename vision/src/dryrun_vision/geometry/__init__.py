"""Calibration and projection maths (numpy port of src/camera/* and src/core/geometry.ts, path.ts)."""

from dryrun_vision.geometry.calibration import SolvedCalibration, model_from_calibration, solve_calibration
from dryrun_vision.geometry.camera_model import (
    CameraModel,
    camera_position,
    height_homography,
    image_to_floor_at,
    model_from_lens,
    model_from_tops,
    project_at,
    solve_hat_height,
)
from dryrun_vision.geometry.floor import OrientedRect, Vec2, distance
from dryrun_vision.geometry.homography import apply_homography, solve_homography
from dryrun_vision.geometry.projection import anchor_pixel, detection_floor_point

__all__ = [
    "CameraModel",
    "OrientedRect",
    "SolvedCalibration",
    "Vec2",
    "anchor_pixel",
    "apply_homography",
    "camera_position",
    "detection_floor_point",
    "distance",
    "height_homography",
    "image_to_floor_at",
    "model_from_calibration",
    "model_from_lens",
    "model_from_tops",
    "project_at",
    "solve_calibration",
    "solve_hat_height",
    "solve_homography",
]
