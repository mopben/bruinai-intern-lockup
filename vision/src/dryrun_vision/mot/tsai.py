"""The Tsai (1987) camera model of MOTChallenge 3D MOT 2015 (maps/View_001.txt).

World units are millimetres, z up, ground plane z = 0. Formulas as documented in vision/DATASETS.md
(Willson's reference implementation), checked there against every ground-truth row.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields
from pathlib import Path

import numpy as np

from dryrun_vision.errors import FormatError

DISTORTION_ITERATIONS = 20
"""Fixed-point steps to undo radial distortion; kappa1 is tiny here, 20 is far more than needed."""


@dataclass(frozen=True)
class TsaiCamera:
    width: int
    height: int
    ncx: float
    nfx: float
    dx: float
    dy: float
    dpx: float
    dpy: float
    cx: float
    cy: float
    sx: float
    focal: float
    kappa1: float
    tx: float
    ty: float
    tz: float
    rx: float
    ry: float
    rz: float

    def rotation(self) -> np.ndarray:
        sa, ca = math.sin(self.rx), math.cos(self.rx)
        sb, cb = math.sin(self.ry), math.cos(self.ry)
        sg, cg = math.sin(self.rz), math.cos(self.rz)
        return np.array(
            [
                [cb * cg, cg * sa * sb - ca * sg, sa * sg + ca * cg * sb],
                [cb * sg, sa * sb * sg + ca * cg, ca * sb * sg - cg * sa],
                [-sb, cb * sa, ca * cb],
            ]
        )

    def translation(self) -> np.ndarray:
        return np.array([self.tx, self.ty, self.tz])

    def centre(self) -> tuple[float, float, float]:
        """Camera centre in world millimetres."""
        c = -self.rotation().T @ self.translation()
        return float(c[0]), float(c[1]), float(c[2])

    def world_to_pixel(self, xyz_mm: tuple[float, float, float]) -> tuple[float, float]:
        """Pixel of a world point (mm), with radial distortion."""
        xc, yc, zc = self.rotation() @ np.array(xyz_mm) + self.translation()
        xu, yu = self.focal * xc / zc, self.focal * yc / zc
        xd, yd = xu, yu
        for _ in range(DISTORTION_ITERATIONS):
            k = 1 + self.kappa1 * (xd * xd + yd * yd)
            xd, yd = xu / k, yu / k
        return float(xd * self.sx / self.dpx + self.cx), float(yd / self.dpy + self.cy)

    def pixel_to_ground(self, u: float, v: float) -> tuple[float, float]:
        """World (x, y) in mm of the ground point seen at pixel (u, v)."""
        xd, yd = (u - self.cx) * self.dpx / self.sx, (v - self.cy) * self.dpy
        k = 1 + self.kappa1 * (xd * xd + yd * yd)
        r = self.rotation()
        d = r.T @ np.array([xd * k, yd * k, self.focal])
        c = np.array(self.centre())
        s = -c[2] / d[2]
        g = c + s * d
        return float(g[0]), float(g[1])


TSAI_FIELDS = tuple(f.name for f in fields(TsaiCamera))


def read_tsai(path: Path) -> TsaiCamera:
    """maps/View_001.txt: 19 numbers, one per line, in the order of TsaiCamera's fields."""
    if not path.is_file():
        raise FormatError(f"{path} does not exist. Give the path of maps/View_001.txt.")
    try:
        values = [float(v) for v in path.read_text(encoding="utf-8").split()]
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise FormatError(f"{path} could not be read as numbers: {exc}") from exc
    if len(values) != len(TSAI_FIELDS):
        raise FormatError(
            f"{path.name} must hold {len(TSAI_FIELDS)} numbers (Tsai calibration), not {len(values)}."
        )
    kw = dict(zip(TSAI_FIELDS, values, strict=True))
    return TsaiCamera(**{**kw, "width": int(kw["width"]), "height": int(kw["height"])})
