"""The camera calibration file exactly as the camera page exports it (src/camera/calib-file.ts).

`hatHeights[workerId]` is taken here as the height in metres of the image anchor
point for that worker. The ML tracker anchors on the top-centre of the person box
(the top of the head); workers with no entry use DEFAULT_ANCHOR_HEIGHT_M.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field

from dryrun_vision.formats.base import FrozenModel, Items, read_json_model

DEFAULT_ANCHOR_HEIGHT_M = 1.70
"""Metres. Top of the head of an average adult; used when a worker has no hatHeights entry."""

MIN_HAT_HEIGHT_M = 0.5
MAX_HAT_HEIGHT_M = 2.5
"""Metres. The same plausible range calib-file.ts accepts."""

HatHeight = Annotated[float, Field(ge=MIN_HAT_HEIGHT_M, le=MAX_HAT_HEIGHT_M)]


class ImagePoint(FrozenModel):
    x: float
    y: float


class WorldPoint(FrozenModel):
    x: float
    y: float
    z: float


class PointPair(FrozenModel):
    ref_id: str | None = None
    label: str
    world: WorldPoint
    image: ImagePoint


class ImageSize(FrozenModel):
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class Hsv(FrozenModel):
    h: float = Field(ge=0, le=360)
    s: float = Field(ge=0, le=1)
    v: float = Field(ge=0, le=1)


class CalibrationFile(FrozenModel):
    format: Literal["dryrun.camera-calibration"]
    version: Literal[1]
    saved_at: str
    camera_key: str
    kitchen_key: str
    image_size: ImageSize
    pairs: Items[PointPair]
    hat_heights: dict[str, HatHeight]
    colours: dict[str, Hsv]


def read_calibration(path: Path) -> CalibrationFile:
    return read_json_model(path, CalibrationFile)


def anchor_height(cal: CalibrationFile, worker_id: str) -> float:
    """Metres above the floor of this worker's image anchor point (DEFAULT_ANCHOR_HEIGHT_M if unknown)."""
    return cal.hat_heights.get(worker_id, DEFAULT_ANCHOR_HEIGHT_M)
