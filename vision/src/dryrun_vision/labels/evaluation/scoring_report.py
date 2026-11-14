"""Numbers for one half of the clips: frame accuracy, recall, confusion, segment metrics, baselines."""

from __future__ import annotations

import statistics
from collections import Counter
from collections.abc import Sequence
from typing import Any

from dryrun_vision.labels.evaluation.breakfast import BACKGROUND
from dryrun_vision.labels.evaluation.metrics import (
    NO_LABEL,
    boundary_errors,
    confusion,
    correct_and_total,
    edit_score,
    f1,
    f1_counts,
    runs_of,
)
from dryrun_vision.labels.evaluation.runner import ClipScores, predict_frames

BOUNDARY_IOU = 0.5
F1_IOU = 0.5

Predictions = tuple[tuple[str | None, ...], ...]


def _ratio(a: int, b: int) -> float | None:
    return a / b if b else None


def _boundaries(scores: Sequence[ClipScores], preds: Predictions) -> dict[str, Any]:
    pairs = zip(scores, preds, strict=True)
    errs = [e for cs, p in pairs for e in boundary_errors(cs.truth, p, cs.fps, BOUNDARY_IOU, BACKGROUND)]
    truth_segments = sum(1 for cs in scores for r in runs_of(cs.truth) if r.label != BACKGROUND)
    flat = [x for e in errs for x in e]
    return {
        "found": len(errs),
        "truthSegments": truth_segments,
        "meanStartErrorS": statistics.fmean(e[0] for e in errs) if errs else None,
        "meanEndErrorS": statistics.fmean(e[1] for e in errs) if errs else None,
        "medianErrorS": statistics.median(flat) if flat else None,
    }


def _segments(scores: Sequence[ClipScores], preds: Predictions) -> dict[str, Any]:
    counts = [f1_counts(cs.truth, p, F1_IOU, BACKGROUND) for cs, p in zip(scores, preds, strict=True)]
    tp, fp, fn = (sum(c[i] for c in counts) for i in range(3))
    edits = [edit_score(cs.truth, p, BACKGROUND) for cs, p in zip(scores, preds, strict=True)]
    return {"edit": statistics.fmean(edits), "f1At50": f1(tp, fp, fn), "tp": tp, "fp": fp, "fn": fn}


def _frames(scores: Sequence[ClipScores], preds: Predictions, labels: Sequence[str]) -> dict[str, Any]:
    gt = [g for cs in scores for g in cs.truth]
    pr = [p for ps in preds for p in ps]
    c_all, n_all = correct_and_total(gt, pr)
    c_fg, n_fg = correct_and_total(gt, pr, ignore=BACKGROUND)
    labelled = [(g, p) for g, p in zip(gt, pr, strict=True) if p is not None]
    matrix = confusion(gt, pr, labels)
    recall = {lab: _ratio(row[i], sum(row)) for i, (lab, row) in enumerate(zip(labels, matrix, strict=True))}
    return {
        "frames": n_all,
        "accuracy": c_all / n_all,
        "accuracyNonSil": _ratio(c_fg, n_fg),
        "coverage": len(labelled) / n_all,
        "precision": _ratio(sum(1 for g, p in labelled if g == p), len(labelled)),
        "recall": recall,
        "confusion": {
            "rows": list(labels),
            "columns": [*labels, NO_LABEL],
            "counts": [list(r) for r in matrix],
        },
    }


def half_metrics(
    scores: Sequence[ClipScores], smooth_windows: int, min_confidence: float, labels: Sequence[str]
) -> dict[str, Any]:
    preds = tuple(predict_frames(cs, smooth_windows, min_confidence) for cs in scores)
    return {
        "smoothWindows": smooth_windows,
        "minConfidence": min_confidence,
        **_frames(scores, preds, labels),
        "segments": _segments(scores, preds),
        "boundaries": _boundaries(scores, preds),
    }


def _majority(labels: Sequence[str]) -> str | None:
    return Counter(labels).most_common(1)[0][0] if labels else None


def baselines(dev: Sequence[ClipScores], half: Sequence[ClipScores], per_activity: bool) -> dict[str, Any]:
    """Chance = uniform over the clip's candidates. Majority = the dev half's most common label
    (per activity when candidates are restricted by activity), over all frames and over non-SIL."""

    def group(cs: ClipScores) -> str:
        return cs.clip.activity if per_activity else "*"

    majority = {
        g: (_majority([t for cs in dev if group(cs) == g for t in cs.truth]),
            _majority([t for cs in dev if group(cs) == g for t in cs.truth if t != BACKGROUND]))
        for g in {group(cs) for cs in dev}
    }  # fmt: skip
    frames = [(t, cs) for cs in half for t in cs.truth]
    fg = [(t, cs) for t, cs in frames if t != BACKGROUND]
    hit_all = sum(1 for t, cs in frames if majority.get(group(cs), (None, None))[0] == t)
    hit_fg = sum(1 for t, cs in fg if majority.get(group(cs), (None, None))[1] == t)
    return {
        "chance": statistics.fmean(1 / len(cs.labels) for _, cs in frames),
        "chanceNonSil": statistics.fmean(1 / len(cs.labels) for _, cs in fg) if fg else None,
        "majority": hit_all / len(frames),
        "majorityNonSil": _ratio(hit_fg, len(fg)),
        "majorityLabels": {g: {"all": m[0], "nonSil": m[1]} for g, m in sorted(majority.items())},
    }
