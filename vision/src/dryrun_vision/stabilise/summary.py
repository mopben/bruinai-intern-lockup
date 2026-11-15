"""Numbers and words about a stabilisation: the report summary and the poor-frame list."""

from __future__ import annotations

import statistics
from collections.abc import Sequence

from dryrun_vision.formats import FrameRegistration, StabilisationSummary

OUTSIDE_PERCENTILE = 0.9
"""The summary's high mark of how far the picture outside the region is off."""
POOR_FRAMES_LISTED = 5
"""Poor frames named one by one in a message; the rest are counted."""


def summarise(rows: Sequence[FrameRegistration]) -> StabilisationSummary:
    """Inliers and residual over the well-registered frames; shift over every frame."""
    good = [r for r in rows if r.ok]
    rms = [r.rms_px for r in good if r.rms_px is not None]
    shifts = [r.shift_px for r in rows] or [0.0]
    inliers = [r.inliers for r in good] or [0]
    outside = sorted(r.outside_median_px for r in good if r.outside_median_px is not None)
    return StabilisationSummary(
        frames=len(rows),
        frames_poor=len(rows) - len(good),
        inliers_min=min(inliers),
        inliers_median=float(statistics.median(inliers)),
        rms_median_px=statistics.median(rms) if rms else None,
        rms_max_px=max(rms) if rms else None,
        shift_median_px=statistics.median(shifts),
        shift_max_px=max(shifts),
        outside_median_px=statistics.median(outside) if outside else None,
        outside_p90_px=outside[int(OUTSIDE_PERCENTILE * (len(outside) - 1))] if outside else None,
    )


def poor_frames_text(poor: Sequence[FrameRegistration]) -> str:
    """'frame 5: residual 3.10 px is more than 2.5 px (used frame 4); ...' for the first few."""
    parts = [f"frame {r.frame}: {r.problem} (used frame {r.used_frame})" for r in poor[:POOR_FRAMES_LISTED]]
    more = len(poor) - POOR_FRAMES_LISTED
    return "; ".join(parts) + (f"; and {more} more" if more > 0 else "")
