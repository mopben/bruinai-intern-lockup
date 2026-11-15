"""The region to register on: polygons in reference-frame pixels, as a mask."""

from __future__ import annotations

from typing import Any

import numpy as np

from dryrun_vision.formats import StabilisationRegion
from dryrun_vision.video.reader import cv2_module

INSIDE = 255


def region_mask(shape: tuple[int, ...], region: StabilisationRegion) -> Any:  # noqa: ANN401
    """uint8 mask (rows, cols) of an image of `shape`: 255 inside any of the region's polygons."""
    cv2 = cv2_module()
    mask = np.zeros((shape[0], shape[1]), dtype=np.uint8)
    for poly in region.polygons:
        pts = np.array([[p.x, p.y] for p in poly], dtype=np.float64)
        cv2.fillPoly(mask, [np.round(pts).astype(np.int32)], INSIDE)
    return mask
