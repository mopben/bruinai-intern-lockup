"""Pixel boxes: expand a person box by margins, clamp it to the image, cut and shrink crops."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from dryrun_vision.labels.constants import CROP_MARGIN_BOTTOM, CROP_MARGIN_SIDE, CROP_MARGIN_TOP


@dataclass(frozen=True)
class Box:
    """Top-left corner `x, y` and size `w, h`, in source-video pixels (like tracks.jsonl)."""

    x: float
    y: float
    w: float
    h: float

    def __post_init__(self) -> None:
        if not (self.w > 0 and self.h > 0):
            raise ValueError(f"a box needs a positive size (got {self.w} x {self.h} px)")


@dataclass(frozen=True)
class CropMargins:
    """Fractions of the box size added around it.

    `side` of the width on the left and on the right, `top` and `bottom` of the height.
    """

    side: float = CROP_MARGIN_SIDE
    top: float = CROP_MARGIN_TOP
    bottom: float = CROP_MARGIN_BOTTOM


def expand_box(box: Box, margins: CropMargins) -> Box:
    dx = box.w * margins.side
    top = box.h * margins.top
    return Box(box.x - dx, box.y - top, box.w + 2 * dx, box.h + top + box.h * margins.bottom)


def clamp_box(box: Box, width: int, height: int) -> Box | None:
    """The part of the box inside a width x height image, or None if nothing is inside."""
    x0, y0 = max(0.0, box.x), max(0.0, box.y)
    x1, y1 = min(float(width), box.x + box.w), min(float(height), box.y + box.h)
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return Box(x0, y0, x1 - x0, y1 - y0)


def centre_box(width: int, height: int, fraction: float) -> Box:
    """A centred box covering `fraction` of the image's width and height."""
    if not 0 < fraction <= 1:
        raise ValueError(f"the centre-crop fraction must be in (0, 1] (got {fraction})")
    w, h = width * fraction, height * fraction
    return Box((width - w) / 2, (height - h) / 2, w, h)


def crop_frame(frame: np.ndarray, box: Box) -> np.ndarray:
    """A copy of the whole pixels covered by `box` (which must lie inside the frame)."""
    x0, y0 = math.floor(box.x), math.floor(box.y)
    x1, y1 = math.ceil(box.x + box.w), math.ceil(box.y + box.h)
    return frame[y0:y1, x0:x1].copy()


def downscale(frame: np.ndarray, max_side: int) -> np.ndarray:
    """The frame shrunk (nearest pixel) so its longer side is at most `max_side`; unchanged if small."""
    h, w = frame.shape[:2]
    longer = max(h, w)
    if longer <= max_side:
        return frame
    scale = max_side / longer
    rows = (np.arange(max(1, round(h * scale))) / scale).astype(int)
    cols = (np.arange(max(1, round(w * scale))) / scale).astype(int)
    return frame[np.ix_(rows, cols)]
