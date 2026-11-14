"""Joining neighbouring windows with the same decision into one piece."""

from __future__ import annotations

from collections.abc import Sequence
from itertools import groupby

from dryrun_vision.labels.smoothing import Decision
from dryrun_vision.labels.windows import Window


def _join(run: Sequence[tuple[Window, Decision]]) -> tuple[Window, Decision]:
    span = Window(run[0][0].t0, run[-1][0].t1)
    label = run[0][1].label
    if label is None:
        return span, Decision(None, None)
    weighted = sum(w.duration * (d.confidence or 0.0) for w, d in run)
    return span, Decision(label, weighted / span.duration)


def merge_runs(
    windows: Sequence[Window], decisions: Sequence[Decision]
) -> tuple[tuple[Window, Decision], ...]:
    """Consecutive windows with the same label (or both unlabelled) become one.

    The joined confidence is the time-weighted mean of the windows' confidences.
    """
    if len(windows) != len(decisions):
        raise ValueError(f"{len(windows)} windows but {len(decisions)} decisions")
    pairs = list(zip(windows, decisions, strict=True))
    return tuple(_join(list(run)) for _, run in groupby(pairs, key=lambda wd: wd[1].label))
