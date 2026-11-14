"""One experiment = provider x candidate setting x crop mode, scored on both halves.

Tuning uses the development half only: the smoothing width that gives the best dev frame
accuracy, then the lowest confidence threshold whose dev precision is highest while still
labelling at least MIN_COVERAGE of the frames. Both are then applied unchanged to the held-out half.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from dryrun_vision.labels.evaluation.runner import ClipScores
from dryrun_vision.labels.evaluation.scoring_report import baselines, half_metrics

SMOOTH_GRID = (1, 3, 5)
THRESHOLD_GRID = (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)
MIN_COVERAGE = 0.5
"""A threshold must still label at least this share of dev frames to be chosen."""


def tune(dev: Sequence[ClipScores], labels: Sequence[str]) -> tuple[int, float, list[dict[str, Any]]]:
    """(smoothing width, threshold, the dev sweep)."""
    by_width = {w: half_metrics(dev, w, 0.0, labels)["accuracy"] for w in SMOOTH_GRID}
    width = max(SMOOTH_GRID, key=lambda w: (by_width[w], -w))
    sweep = []
    for thr in THRESHOLD_GRID:
        m = half_metrics(dev, width, thr, labels)
        sweep.append({"minConfidence": thr, "coverage": m["coverage"], "precision": m["precision"]})
    usable = [s for s in sweep if s["coverage"] >= MIN_COVERAGE and s["precision"] is not None]
    best = max(usable, key=lambda s: (s["precision"], -s["minConfidence"]), default=sweep[0])
    widths = [{"smoothWindows": w, "accuracy": a} for w, a in by_width.items()]
    return width, best["minConfidence"], [*widths, *sweep]


def _windows_per_second(scores: Sequence[ClipScores]) -> float:
    windows = sum(len(cs.windows) for cs in scores)
    seconds = sum(cs.seconds for cs in scores)
    return windows / seconds if seconds > 0 else 0.0


def run_experiment(
    dev: Sequence[ClipScores], held: Sequence[ClipScores], labels: Sequence[str], per_activity: bool
) -> dict[str, Any]:
    width, threshold, sweep = tune(dev, labels)
    halves: dict[str, Any] = {}
    for name, half in (("dev", dev), ("heldOut", held)):
        halves[name] = {
            "clips": [cs.clip.name for cs in half],
            "raw": half_metrics(half, 1, 0.0, labels),
            "smoothed": half_metrics(half, width, 0.0, labels),
            "thresholded": half_metrics(half, width, threshold, labels),
            "baselines": baselines(dev, half, per_activity),
        }
    return {
        "tunedOnDev": {"smoothWindows": width, "minConfidence": threshold, "sweep": sweep},
        "windowsPerSecond": _windows_per_second([*dev, *held]),
        "windows": sum(len(cs.windows) for cs in [*dev, *held]),
        **halves,
    }


def window_dump(scores: Sequence[ClipScores]) -> list[dict[str, Any]]:
    """Raw per-window probabilities, so the numbers can be recomputed without the model."""
    return [
        {
            "clip": cs.clip.name,
            "labels": list(cs.labels),
            "windows": [
                {
                    "t0": w.t0,
                    "t1": w.t1,
                    "frames": s.frames,
                    "probs": None if s.probs is None else list(s.probs),
                }
                for w, s in zip(cs.windows, cs.scores, strict=True)
            ],
        }
        for cs in scores
    ]
