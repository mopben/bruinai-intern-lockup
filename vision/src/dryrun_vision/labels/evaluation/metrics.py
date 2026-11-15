"""Frame and segment metrics for action labelling (temporal action segmentation conventions).

Sequences are per-frame labels; None means "no label given". `ignore` (the background label,
e.g. SIL) is left out of the segment metrics, as in MS-TCN's edit score and F1@k.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import groupby

Seq = Sequence[str | None]
NO_LABEL = "(none)"


@dataclass(frozen=True)
class Run:
    label: str | None
    start: int
    end: int
    """Exclusive."""

    @property
    def length(self) -> int:
        return self.end - self.start


def runs_of(seq: Seq) -> tuple[Run, ...]:
    out: list[Run] = []
    start = 0
    for label, group in groupby(seq):
        n = sum(1 for _ in group)
        out.append(Run(label, start, start + n))
        start += n
    return tuple(out)


def _check(gt: Seq, pred: Seq) -> None:
    if len(gt) != len(pred):
        raise ValueError(f"{len(gt)} truth frames but {len(pred)} predicted frames")


def correct_and_total(gt: Seq, pred: Seq, ignore: str | None = None) -> tuple[int, int]:
    """Frames where pred == gt, and frames counted (gt != ignore). An unlabelled frame is wrong."""
    _check(gt, pred)
    pairs = [(g, p) for g, p in zip(gt, pred, strict=True) if g != ignore]
    return sum(1 for g, p in pairs if g == p), len(pairs)


def confusion(gt: Seq, pred: Seq, labels: Sequence[str]) -> tuple[tuple[int, ...], ...]:
    """Rows: truth in `labels` order. Columns: `labels`, then one for "no label"."""
    _check(gt, pred)
    col = {lab: i for i, lab in enumerate(labels)}
    rows = [[0] * (len(labels) + 1) for _ in labels]
    for g, p in zip(gt, pred, strict=True):
        if g in col:
            rows[col[g]][col.get(p, len(labels)) if p is not None else len(labels)] += 1
    return tuple(tuple(r) for r in rows)


def _levenshtein(a: Sequence[str | None], b: Sequence[str | None]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def _foreground(seq: Seq, ignore: str | None) -> tuple[Run, ...]:
    return tuple(r for r in runs_of(seq) if r.label is not None and r.label != ignore)


def edit_score(gt: Seq, pred: Seq, ignore: str | None = None) -> float:
    """100 * (1 - Levenshtein(segment labels) / max(segment counts)); 100 when both are empty."""
    _check(gt, pred)
    a = [r.label for r in _foreground(gt, ignore)]
    b = [r.label for r in _foreground(pred, ignore)]
    longest = max(len(a), len(b))
    return 100.0 if longest == 0 else 100.0 * (1 - _levenshtein(a, b) / longest)


def _iou(a: Run, b: Run) -> float:
    inter = max(0, min(a.end, b.end) - max(a.start, b.start))
    return inter / (a.length + b.length - inter)


def f1_counts(gt: Seq, pred: Seq, threshold: float, ignore: str | None = None) -> tuple[int, int, int]:
    """(true positives, false positives, false negatives) at an IoU threshold, one match per truth segment."""
    _check(gt, pred)
    truth = _foreground(gt, ignore)
    used = [False] * len(truth)
    tp = fp = 0
    for p in _foreground(pred, ignore):
        cands = [(i, _iou(p, t)) for i, t in enumerate(truth) if t.label == p.label]
        best = max(cands, key=lambda c: c[1], default=(-1, 0.0))
        if best[1] >= threshold and not used[best[0]]:
            tp, used[best[0]] = tp + 1, True
        else:
            fp += 1
    return tp, fp, len(truth) - sum(used)


def f1(tp: int, fp: int, fn: int) -> float:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return 0.0 if precision + recall == 0 else 100.0 * 2 * precision * recall / (precision + recall)


def boundary_errors(
    gt: Seq, pred: Seq, fps: float, threshold: float = 0.5, ignore: str | None = None
) -> tuple[tuple[float, float], ...]:
    """For each truth segment found (same label, IoU >= threshold): |start error|, |end error| in seconds."""
    _check(gt, pred)
    preds = _foreground(pred, ignore)
    out = []
    for t in _foreground(gt, ignore):
        cands = [p for p in preds if p.label == t.label and _iou(p, t) >= threshold]
        if cands:
            p = max(cands, key=lambda c: _iou(c, t))
            out.append((abs(p.start - t.start) / fps, abs(p.end - t.end) / fps))
    return tuple(out)
