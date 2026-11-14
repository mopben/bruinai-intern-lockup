"""Plain-text tables of an eval-labels result (the JSON has everything; this is the readable part)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

_ROWS = ("raw", "smoothed", "thresholded")
_HALVES = (("dev", "dev"), ("heldOut", "held-out"))
_LABEL_W = 13


def _pct(x: float | None) -> str:
    return "   -" if x is None else f"{100 * x:4.1f}"


def _num(x: float | None, fmt: str = "5.1f") -> str:
    return "    -" if x is None else format(x, fmt)


def _metric_row(name: str, m: dict[str, Any]) -> str:
    b, s = m["boundaries"], m["segments"]
    bound = f"{_num(b['meanStartErrorS'], '4.1f')}/{_num(b['meanEndErrorS'], '4.1f')}"
    return (
        f"  {name:<20} {_pct(m['accuracy'])}  {_pct(m['accuracyNonSil'])}  {_pct(m['coverage'])}  "
        f"{_pct(m['precision'])}  {s['edit']:5.1f}  {s['f1At50']:5.1f}  {bound:>11}  "
        f"{b['found']:>2}/{b['truthSegments']:<3}"
    )


def _baseline_row(b: dict[str, Any]) -> str:
    return (
        f"  {'chance':<20} {_pct(b['chance'])}  {_pct(b['chanceNonSil'])}\n"
        f"  {'majority (dev)':<20} {_pct(b['majority'])}  {_pct(b['majorityNonSil'])}"
    )


def _recall(m: dict[str, Any]) -> str:
    parts = [f"{lab} {_pct(r).strip()}" for lab, r in m["recall"].items() if r is not None]
    return "  recall %: " + ", ".join(parts)


def _confusion(m: dict[str, Any]) -> list[str]:
    c = m["confusion"]
    cols = [*(str(i + 1) for i in range(len(c["rows"]))), "none"]
    lines = [
        "  confusion (frames; rows truth, columns predicted in the same numbered order):",
        " " * (_LABEL_W + 6) + " ".join(f"{x:>5}" for x in cols),
    ]
    for i, (lab, row) in enumerate(zip(c["rows"], c["counts"], strict=True)):
        if sum(row):
            lines.append(f"  {i + 1:>2} {lab[:_LABEL_W]:<{_LABEL_W}} " + " ".join(f"{v:>5}" for v in row))
    return lines


def format_experiment(title: str, r: dict[str, Any]) -> str:
    t = r["tunedOnDev"]
    head = (
        f"{title}  (tuned on dev: smooth {t['smoothWindows']} windows, min confidence {t['minConfidence']}; "
        f"{r['windowsPerSecond']:.1f} windows/s over {r['windows']} windows)"
    )
    names = ("acc", "nSIL", "cov", "prec")
    cols = "  " + " " * 20 + " " + "  ".join(f"{n:>4}" for n in names)
    cols += f"  {'edit':>5}  {'F1@.5':>5}  {'bound s/e':>11}  found"
    lines = [head, cols]
    for key, name in _HALVES:
        half = r[key]
        lines.append(f" {name} ({len(half['clips'])} clips, {half['raw']['frames']} frames)")
        lines.extend(_metric_row(row, half[row]) for row in _ROWS)
        lines.append(_baseline_row(half["baselines"]))
    lines.append(" held-out, smoothed:")
    lines.append(_recall(r["heldOut"]["smoothed"]))
    lines.extend(_confusion(r["heldOut"]["smoothed"]))
    return "\n".join(lines)


def format_all(results: Sequence[tuple[str, dict[str, Any]]]) -> str:
    legend = (
        "acc = frame accuracy (unlabelled frames count as wrong), nSIL = accuracy on non-SIL frames, "
        "cov = share of frames labelled,\nprec = accuracy on labelled frames, edit / F1@.5 = segment "
        "metrics without SIL, bound s/e = mean start/end error (s) of found segments."
    )
    return "\n\n".join([legend, *(format_experiment(title, r) for title, r in results)])
