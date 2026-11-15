"""Register one frame to the reference frame: SIFT features, ratio-tested matches, RANSAC homography.

A homography is exact when the camera only turns (pans, tilts, rolls) or zooms about one spot,
for every point in the picture however far away. If the camera also moves, near and far things
shift by different amounts (parallax) and no single homography fits: the residual says so.
People move, so their boxes can be masked out of the features (`person_mask`).
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from dryrun_vision.geometry.linalg import FloatArray, frozen
from dryrun_vision.video.reader import cv2_module

MAX_FEATURES = 5000
"""SIFT keypoints per frame. 5000 on a 1080p kitchen frame gives about 600-1500 good matches."""
RATIO_TEST = 0.75
"""Lowe's ratio: keep a match only if it is clearly better than the second best (SIFT paper value)."""
RANSAC_PX = 3.0
"""Pixels. A match further than this from where the homography sends it is an outlier."""
RANSAC_ITERATIONS = 5000
RANSAC_CONFIDENCE = 0.999
MIN_MATCHES = 4
"""A homography needs four point pairs."""
NEIGHBOURS = 2
"""Best and second-best match per feature, for the ratio test."""
OUTSIDE_GATE_PX = 40.0
"""Pixels. Matches outside the region further off than this are mismatches, not parallax."""
MIN_OUTSIDE_MATCHES = 20
"""Fewer matches outside the region than this give no outside measurement."""
PERSON_MARGIN = 0.1
"""Share of a person box's width/height added on each side when masking (arms, hair, shadow)."""
MASK_ON, MASK_OFF = 255, 0


@dataclass(frozen=True)
class PersonBox:
    """A box to leave out of the features, in pixels: top-left x, y and size w, h."""

    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True, eq=False)
class Features:
    points: FloatArray
    """N x 2 keypoint positions (x, y) in pixels. Read-only."""
    descriptors: npt.NDArray[np.float32]
    """N x 128 SIFT descriptors. Read-only."""
    in_region: npt.NDArray[np.bool_] | None = None
    """Reference features only: which lie inside the region to register on (None: all). Read-only."""


@dataclass(frozen=True, eq=False)
class Registration:
    homography: FloatArray | None
    """3x3: this frame's pixels -> reference pixels, or None if none was found. Read-only."""
    matches: int
    inliers: int
    rms_px: float | None
    """Root-mean-square reprojection error of the inliers, pixels (inside the region, if one is used)."""
    outside_matches: int = 0
    outside_median_px: float | None = None
    """Median misfit of the matches outside the region (only with a region and enough of them)."""

    def __post_init__(self) -> None:
        if self.homography is not None:
            object.__setattr__(self, "homography", frozen(self.homography))


def _read_only(a: npt.NDArray[Any]) -> npt.NDArray[Any]:
    out = np.array(a, copy=True)
    out.flags.writeable = False
    return out


def person_mask(shape: tuple[int, ...], boxes: Iterable[PersonBox], margin: float = PERSON_MARGIN) -> Any:  # noqa: ANN401
    """uint8 mask of an image of `shape` (rows, cols, ...): 255 where features may be found, 0 on people."""
    rows, cols = shape[0], shape[1]
    mask = np.full((rows, cols), MASK_ON, dtype=np.uint8)
    for b in boxes:
        x0 = max(0, math.floor(b.x - margin * b.w))
        y0 = max(0, math.floor(b.y - margin * b.h))
        x1 = min(cols, math.ceil(b.x + b.w * (1 + margin)))
        y1 = min(rows, math.ceil(b.y + b.h * (1 + margin)))
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = MASK_OFF
    return mask


def find_features(
    gray: npt.NDArray[np.uint8],
    mask: npt.NDArray[np.uint8] | None = None,
    region: npt.NDArray[np.uint8] | None = None,
) -> Features:
    """SIFT keypoints and descriptors of a greyscale image, outside the mask's zeros.

    `region` (reference frame only): a mask of the same size whose non-zero pixels are the region
    to register on; features elsewhere are kept, to measure how much the rest of the picture moves.
    """
    cv2 = cv2_module()
    keypoints, descriptors = cv2.SIFT_create(MAX_FEATURES).detectAndCompute(gray, mask)
    points = np.array([k.pt for k in keypoints], dtype=np.float64).reshape(-1, 2)
    desc = np.zeros((0, 128), np.float32) if descriptors is None else descriptors.astype(np.float32)
    inside = None
    if region is not None:
        rows = np.clip(points[:, 1].astype(int), 0, region.shape[0] - 1)
        cols = np.clip(points[:, 0].astype(int), 0, region.shape[1] - 1)
        inside = _read_only(region[rows, cols] > 0)
    return Features(_read_only(points), _read_only(desc), inside)


def _matched_points(
    frame: Features, reference: Features
) -> tuple[FloatArray, FloatArray, npt.NDArray[np.bool_]]:
    """Matched (frame px, reference px) and whether each reference point is in the region."""
    if len(frame.points) < MIN_MATCHES or len(reference.points) < MIN_MATCHES:
        return np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0, bool)
    cv2 = cv2_module()
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(frame.descriptors, reference.descriptors, k=NEIGHBOURS)
    good = [p[0] for p in pairs if len(p) == NEIGHBOURS and p[0].distance < RATIO_TEST * p[1].distance]
    src = np.array([frame.points[m.queryIdx] for m in good]).reshape(-1, 2)
    dst = np.array([reference.points[m.trainIdx] for m in good]).reshape(-1, 2)
    flags = reference.in_region
    inside = np.ones(len(good), bool) if flags is None else np.array([flags[m.trainIdx] for m in good], bool)
    return src, dst, inside


def misfit_px(h: FloatArray, src: FloatArray, dst: FloatArray) -> FloatArray:
    """Per match: distance (px) between where h sends the frame point and its reference point."""
    pts = np.column_stack([src, np.ones(len(src))]) @ np.asarray(h).T
    mapped = pts[:, :2] / pts[:, 2:3]
    return np.hypot(mapped[:, 0] - dst[:, 0], mapped[:, 1] - dst[:, 1])


def _outside(h: FloatArray, src: FloatArray, dst: FloatArray) -> tuple[int, float | None]:
    err = misfit_px(h, src, dst)
    err = err[err < OUTSIDE_GATE_PX]
    return len(err), (float(np.median(err)) if len(err) >= MIN_OUTSIDE_MATCHES else None)


def register(
    frame: Features, reference: Features, *, prior: FloatArray | None = None, gate_px: float = math.inf
) -> Registration:
    """The homography taking `frame` pixels to `reference` pixels, with its inliers and residual.

    Only matches to reference features in the region are fitted. With `prior`, only matches that
    `prior` already sends within `gate_px` of their reference point are used.
    """
    src, dst, inside = _matched_points(frame, reference)
    use = inside if prior is None else inside & (misfit_px(prior, src, dst) < gate_px)
    if use.sum() < MIN_MATCHES:
        return Registration(None, matches=int(use.sum()), inliers=0, rms_px=None)
    cv2 = cv2_module()
    h, inlier_mask = cv2.findHomography(
        src[use], dst[use], cv2.RANSAC, RANSAC_PX, maxIters=RANSAC_ITERATIONS, confidence=RANSAC_CONFIDENCE
    )
    if h is None or inlier_mask is None or not np.all(np.isfinite(h)):
        return Registration(None, matches=int(use.sum()), inliers=0, rms_px=None)
    h = h / h[2, 2]
    keep = inlier_mask.ravel().astype(bool)
    rms = float(np.sqrt(np.mean(misfit_px(h, src[use][keep], dst[use][keep]) ** 2))) if keep.any() else None
    n_out, out_px = _outside(h, src[~inside], dst[~inside]) if reference.in_region is not None else (0, None)
    return Registration(h, int(use.sum()), int(keep.sum()), rms, n_out, out_px)
