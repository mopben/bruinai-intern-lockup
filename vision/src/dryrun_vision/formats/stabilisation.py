"""The `stabilise` report: per frame, the homography to the reference frame and how well it fits.

`homography` is 9 numbers, row-major, mapping that frame's pixels to the reference frame's
pixels. `inliers` is how many feature matches agreed with it, `rmsPx` their root-mean-square
reprojection error in pixels. A frame whose own registration was poor (`ok` false, `problem`
says why) is warped with the homography of `usedFrame`, the nearest earlier good frame.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field

from dryrun_vision.errors import FormatError
from dryrun_vision.formats.base import FrozenModel, Items, NonEmpty, Seconds, read_json_model
from dryrun_vision.formats.calibration import ImagePoint
from dryrun_vision.formats.tracks import VideoInfo

MIN_POLYGON_POINTS = 3
HOMOGRAPHY_SIZE = 9
"""A 3x3 matrix, row-major."""

Homography = Annotated[Items[float], Field(min_length=HOMOGRAPHY_SIZE, max_length=HOMOGRAPHY_SIZE)]
NonNegative = Annotated[float, Field(ge=0)]
Polygon = Annotated[Items[ImagePoint], Field(min_length=MIN_POLYGON_POINTS)]
"""Reference-frame pixels, in order around the outline."""


class StabilisationRegion(FrozenModel):
    """The part of the reference frame to register on (`--region`): one or more polygons."""

    format: Literal["dryrun.stabilisation-region"]
    version: Literal[1]
    polygons: Annotated[Items[Polygon], Field(min_length=1)]


class CropRect(FrozenModel):
    """The viewer video's window in reference-frame pixels: viewer pixel (u, v) = reference (x + u, y + v)."""

    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class StabilisationThresholds(FrozenModel):
    min_inliers: int = Field(ge=4)
    max_rms_px: float = Field(gt=0)
    max_shift_share: float = Field(gt=0)
    ransac_px: float = Field(gt=0)
    max_poor_share: float = Field(ge=0, le=1)


class FrameRegistration(FrozenModel):
    frame: int = Field(ge=0)
    t: Seconds
    homography: Homography
    matches: int = Field(ge=0)
    inliers: int = Field(ge=0)
    rms_px: NonNegative | None = None
    """Residual of the fit's inliers: all inside the region when one was given."""
    outside_matches: int = Field(default=0, ge=0)
    outside_median_px: NonNegative | None = None
    """With a region: median misfit (px) of matches outside it (parallax of things off its plane)."""
    shift_px: NonNegative
    """Mean distance the four image corners move under the homography that was used."""
    ok: bool
    used_frame: int = Field(ge=0)
    problem: str | None = None


class StabilisationSummary(FrozenModel):
    frames: int = Field(ge=0)
    frames_poor: int = Field(ge=0)
    inliers_min: int = Field(ge=0)
    inliers_median: float = Field(ge=0)
    rms_median_px: NonNegative | None = None
    rms_max_px: NonNegative | None = None
    shift_median_px: NonNegative
    shift_max_px: NonNegative
    outside_median_px: NonNegative | None = None
    outside_p90_px: NonNegative | None = None


class StabilisationReport(FrozenModel):
    format: Literal["dryrun.stabilisation"] = "dryrun.stabilisation"
    version: Literal[1] = 1
    video: VideoInfo
    reference_frame: int = Field(ge=0)
    method: NonEmpty
    masked_people: bool
    region: Items[Polygon] | None = None
    viewer_crop: CropRect | None = None
    thresholds: StabilisationThresholds
    summary: StabilisationSummary
    frames: Items[FrameRegistration]


def read_stabilisation(path: Path) -> StabilisationReport:
    return read_json_model(path, StabilisationReport)


def read_region(path: Path) -> StabilisationRegion:
    return read_json_model(path, StabilisationRegion)


def write_stabilisation(path: Path, report: StabilisationReport) -> None:
    try:
        path.write_text(json.dumps(report.to_json(), indent=1) + "\n", encoding="utf-8")
    except OSError as exc:
        raise FormatError(f"{path} could not be written: {exc}") from exc
