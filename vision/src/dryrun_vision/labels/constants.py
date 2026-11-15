"""Tunable numbers of the action labeller, in one place.

Values marked "dev" were chosen on the development half of the Breakfast subset only
(see labels/evaluation); everything else is a plain engineering default.
"""

from __future__ import annotations

WINDOW_S = 2.0
"""Seconds. A labelled segment is cut into windows of about this length; each gets one label."""
MIN_WINDOW_S = 0.5
"""Seconds. A trailing remainder shorter than this joins the previous window instead."""
FRAMES_PER_WINDOW = 4
"""Frames sampled from each window (centres of equal parts of the window)."""

CROP_MARGIN_SIDE = 0.25
"""Fraction of the person box's width added on the left and on the right (hands, tools)."""
CROP_MARGIN_TOP = 0.05
"""Fraction of the box height added above the head."""
CROP_MARGIN_BOTTOM = 0.10
"""Fraction of the box height added below the box (the counter in front of the worker)."""
BOX_MAX_GAP_S = 0.5
"""Seconds. A worker's box is used for a frame only if it was seen at most this far away in time."""
CENTRE_CROP_FRACTION = 0.6
"""Width and height fraction of the centred crop used when there are no tracks (evaluation variant)."""
MAX_CROP_SIDE_PX = 448
"""Crops are shrunk so their longer side is at most this before they reach a provider."""

SMOOTH_WINDOWS = 3
"""Odd. A window's label is the majority vote of itself and its neighbours within one segment (dev:
chosen in 3 of the 4 Breakfast experiments on the development half). On the held-out half it
changed frame accuracy by under 1 point either way (e.g. 26.8 -> 27.1 %, activity, whole frame)."""
MIN_CONFIDENCE = 0.8
"""Windows whose smoothed probability for the winning label is below this get no label (dev: the
Breakfast "activity" setting, 4-6 candidates like a café station, SigLIP 2, whole frame).

Held-out reality (runs/eval-labels/siglip-activity-whole.json): 0.8 is the top of the search grid,
so the search was clipped, not settled. On the development half it labels 56 % of frames at 0.45
precision; on the held-out half only 25 % at 0.42. A softmax threshold also does not carry over
between candidate sets of different sizes (or between models). Not retuned: treat it as a guess."""
CONFIDENCE_DECIMALS = 3
"""Confidences are written with this many decimals."""
