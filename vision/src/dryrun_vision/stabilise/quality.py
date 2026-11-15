"""Is a registration good enough to warp with? Plain-sentence reasons when it is not (pure numpy)."""

from __future__ import annotations

import math

import numpy as np

from dryrun_vision.geometry.linalg import FloatArray
from dryrun_vision.stabilise.register import Registration

MIN_INLIERS = 40
"""Matches that must agree with the homography. A homography has 8 unknowns; 40 agreeing points
spread over the picture leave little room for a chance fit (the kitchen clip has 500-1500)."""
MAX_RMS_PX = 2.5
"""Pixels. Above this the picture does not move as one plane: the camera moved (parallax), or the
lens bends straight lines more than a homography can follow. Measured: 0.9-1.6 px on the 1080p
ultra-wide kitchen clip, under 0.5 px on the generated test clip."""
MAX_SHIFT_SHARE = 0.25
"""A homography moving the picture's corners by more than this share of its diagonal is a wrong
fit (a handheld camera at one spot shifts by a few percent)."""
MAX_POOR_SHARE = 0.05
"""Share of frames that may be poor before the whole video is refused. A few poor frames (motion
blur, someone walking right past the lens) borrow the last good frame's homography."""


def corner_shift_px(h: FloatArray, width: float, height: float) -> float:
    """Mean distance (pixels) the four image corners move under h."""
    corners = np.array([[0, 0, 1], [width, 0, 1], [0, height, 1], [width, height, 1]], dtype=np.float64)
    moved = corners @ np.asarray(h, dtype=np.float64).T
    xy = moved[:, :2] / moved[:, 2:3]
    return float(np.mean(np.hypot(xy[:, 0] - corners[:, 0], xy[:, 1] - corners[:, 1])))


def problem_of(reg: Registration, width: float, height: float) -> str | None:
    """Why this registration should not be used, or None if it is good."""
    if reg.homography is None:
        return f"no homography found ({reg.matches} feature matches)"
    if reg.inliers < MIN_INLIERS:
        return f"only {reg.inliers} inliers of {reg.matches} matches (need {MIN_INLIERS})"
    if reg.rms_px is None or reg.rms_px > MAX_RMS_PX:
        rms = "unknown" if reg.rms_px is None else f"{reg.rms_px:.2f} px"
        return f"residual {rms} is more than {MAX_RMS_PX} px"
    shift = corner_shift_px(reg.homography, width, height)
    limit = MAX_SHIFT_SHARE * math.hypot(width, height)
    if not math.isfinite(shift) or shift > limit:
        return f"implausible: it moves the corners {shift:.0f} px (more than {limit:.0f} px)"
    return None
