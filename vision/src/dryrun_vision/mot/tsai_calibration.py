"""A Dry Run calibration file (our pinhole model) made from a Tsai camera, and how well it fits.

Frames. Tsai world: x, y on the ground, z up, millimetres. Ours: x to the right, y up, z toward
the viewer, metres. Mapping: ours = (X, Z, -Y) / 1000. It is a rotation (determinant +1), so
handedness is kept; a ground point (X, Y) becomes floor point (x, z) = (X, -Y) / 1000.

Pairs. Floor points on a FLOOR_GRID x FLOOR_GRID grid over the region people walk in, and points
TOP_HEIGHTS_M above some of them, each projected through the Tsai model (with its lens distortion)
to the pixel it appears at; points outside the picture are left out. Our model has no distortion,
so it can only approximate; calibration_fit says by how much.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

import numpy as np

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import CalibrationFile, ImagePoint, ImageSize, PointPair, WorldPoint
from dryrun_vision.geometry import CameraModel, Vec2, image_to_floor_at, project_at
from dryrun_vision.mot.tsai import TsaiCamera

MM_PER_M = 1000.0
CM_PER_M = 100.0
FLOOR_GRID = 6
"""Floor points per side of the grid (36 at most): plenty for a least-squares homography."""
TOP_HEIGHTS_M = (1.0, 1.7)
"""Metres. Raised points fix our model's "up"; 1.7 m is where heads are."""
TOP_EVERY = 3
"""Every 3rd floor grid point also gets the raised points (so about 12 + 12)."""
FIT_GRID = 9
"""Points per side of the denser grid used to measure the fit (not used to make the calibration)."""
FIT_HEIGHTS_M = (0.0, 1.7)
FIXED_SAVED_AT = "2026-11-14T00:00:00.000Z"

Region = tuple[tuple[float, float], tuple[float, float]]
"""((min x, min y), (max x, max y)) of the ground region in the dataset's metres."""


def world_to_ours(xyz: tuple[float, float, float]) -> tuple[float, float, float]:
    """Tsai world (x, y, z up) -> ours (x, y up, z toward the viewer). Same units."""
    return (xyz[0], xyz[2], -xyz[1])


def ground_to_floor(ground_m: tuple[float, float]) -> Vec2:
    """A ground position from gt.txt (metres) -> our floor point."""
    _, _, z = world_to_ours((ground_m[0], ground_m[1], 0.0))
    return Vec2(ground_m[0], z)


def _grid(region: Region, n: int) -> list[tuple[float, float]]:
    (x0, y0), (x1, y1) = region
    return [(float(x), float(y)) for x in np.linspace(x0, x1, n) for y in np.linspace(y0, y1, n)]


def _pixel(cam: TsaiCamera, g: tuple[float, float], h_m: float) -> tuple[float, float] | None:
    u, v = cam.world_to_pixel((g[0] * MM_PER_M, g[1] * MM_PER_M, h_m * MM_PER_M))
    return (u, v) if 0 <= u < cam.width and 0 <= v < cam.height else None


def _pair(cam: TsaiCamera, g: tuple[float, float], h_m: float, label: str) -> PointPair | None:
    px = _pixel(cam, g, h_m)
    if px is None:
        return None
    f = ground_to_floor(g)
    return PointPair(label=label, world=WorldPoint(x=f.x, y=h_m, z=f.z), image=ImagePoint(x=px[0], y=px[1]))


def calibration_from_tsai(cam: TsaiCamera, region: Region, camera_key: str = "tsai") -> CalibrationFile:
    """Floor and raised point pairs projected through the Tsai camera, as a calibration file."""
    pairs: list[PointPair] = []
    for i, g in enumerate(_grid(region, FLOOR_GRID)):
        heights = (0.0, *TOP_HEIGHTS_M) if i % TOP_EVERY == 0 else (0.0,)
        for h in heights:
            p = _pair(cam, g, h, f"grid {i} at {h:g} m")
            if p is not None:
                pairs.append(p)
    return CalibrationFile(
        format="dryrun.camera-calibration",
        version=1,
        saved_at=FIXED_SAVED_AT,
        camera_key=camera_key,
        kitchen_key="none",
        image_size=ImageSize(width=float(cam.width), height=float(cam.height)),
        pairs=tuple(pairs),
        hat_heights={},
        colours={},
    )


@dataclass(frozen=True)
class CalibrationFit:
    points: int
    median_px: float
    """Pixel distance between where our model and the Tsai model put the same world point."""
    worst_px: float
    floor_median_cm: float
    """Floor distance between a pixel's ground point by our model and by the Tsai model (height 0)."""
    floor_worst_cm: float
    head_median_cm: float
    """The same for a pixel seen at head height (1.7 m), the head anchor's case."""
    head_worst_cm: float


def _floor_errors(
    cam: TsaiCamera, m: CameraModel, grid: Sequence[tuple[float, float]], h: float
) -> list[float]:
    out: list[float] = []
    for g in grid:
        px = _pixel(cam, g, h)
        ours = None if px is None else image_to_floor_at(m, px, h)
        if ours is not None:
            truth = ground_to_floor(g)
            out.append(float(np.hypot(ours.x - truth.x, ours.z - truth.z)) * CM_PER_M)
    return out


def calibration_fit(cam: TsaiCamera, m: CameraModel, region: Region) -> CalibrationFit:
    """How far our distortion-free model is from the Tsai model, on a denser grid than the pairs."""
    grid = _grid(region, FIT_GRID)
    px_err: list[float] = []
    for g in grid:
        for h in FIT_HEIGHTS_M:
            tsai = _pixel(cam, g, h)
            ours = project_at(m, tuple(ground_to_floor(g)), h)
            if tsai is not None and ours is not None:
                px_err.append(float(np.hypot(ours[0] - tsai[0], ours[1] - tsai[1])))
    floor, head = _floor_errors(cam, m, grid, 0.0), _floor_errors(cam, m, grid, FIT_HEIGHTS_M[1])
    if not px_err or not floor or not head:
        raise FormatError(
            "The ground-truth area is not in the picture of this camera, so the calibrations cannot be "
            "compared. Check that --tsai belongs to the same sequence as --gt."
        )
    return CalibrationFit(
        len(px_err), median(px_err), max(px_err), median(floor), max(floor), median(head), max(head)
    )
