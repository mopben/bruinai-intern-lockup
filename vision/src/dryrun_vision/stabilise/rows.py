"""Per-frame registrations -> report rows: judge each, and give poor frames a good neighbour's fit."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from dryrun_vision.formats import FrameRegistration, StabilisationThresholds, VideoInfo
from dryrun_vision.geometry.linalg import FloatArray
from dryrun_vision.stabilise.quality import (
    MAX_POOR_SHARE,
    MAX_RMS_PX,
    MAX_SHIFT_SHARE,
    MIN_INLIERS,
    corner_shift_px,
    problem_of,
)
from dryrun_vision.stabilise.register import RANSAC_PX, Registration


def _fallback(index: int, good: Sequence[int]) -> int | None:
    """The nearest earlier good frame, else the nearest later one."""
    earlier = [g for g in good if g < index]
    if earlier:
        return earlier[-1]
    later = [g for g in good if g > index]
    return later[0] if later else None


def frame_rows(regs: Sequence[tuple[int, Registration]], info: VideoInfo) -> tuple[FrameRegistration, ...]:
    """One report row per frame, in order. A poor frame uses its fallback's homography."""
    problems = {i: problem_of(r, info.width, info.height) for i, r in regs}
    good = [i for i, _ in regs if problems[i] is None]
    by_index = dict(regs)
    rows: list[FrameRegistration] = []
    for i, reg in regs:
        used = i if problems[i] is None else _fallback(i, good)
        h: FloatArray = np.eye(3) if used is None else by_index[used].homography  # type: ignore[assignment]
        rows.append(
            FrameRegistration(
                frame=i, t=i / info.fps, homography=tuple(float(v) for v in h.ravel()),
                matches=reg.matches, inliers=reg.inliers, rms_px=reg.rms_px,
                outside_matches=reg.outside_matches, outside_median_px=reg.outside_median_px,
                shift_px=corner_shift_px(h, info.width, info.height), ok=problems[i] is None,
                used_frame=i if used is None else used, problem=problems[i],
            )
        )  # fmt: skip
    return tuple(rows)


def thresholds() -> StabilisationThresholds:
    return StabilisationThresholds(
        min_inliers=MIN_INLIERS, max_rms_px=MAX_RMS_PX, max_shift_share=MAX_SHIFT_SHARE,
        ransac_px=RANSAC_PX, max_poor_share=MAX_POOR_SHARE,
    )  # fmt: skip


def homography_of(row: FrameRegistration) -> FloatArray:
    return np.array(row.homography, dtype=np.float64).reshape(3, 3)
