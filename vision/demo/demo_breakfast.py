"""Section 3: three held-out Breakfast clips with truth, Gemini and SigLIP labels per frame.

Predictions are made exactly as `eval-labels` makes them (labels/evaluation/runner.py: smoothing
width tuned on the development half, then the window that contains each frame's start time), and
the held-out accuracy is recomputed from all held-out clips and checked against the saved JSON.
"""

from __future__ import annotations

import bisect
import json
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import groupby
from pathlib import Path
from typing import Any

from demo_common import VISION, DemoError, require, share
from demo_media import encode, poster, probe

from dryrun_vision.labels.evaluation.breakfast import BACKGROUND, read_frame_labels
from dryrun_vision.labels.smoothing import smooth_decisions

DATA = VISION / "data/breakfast"
LABELS = VISION / "runs/eval-labels"
PROVIDERS = {"gemini": "gemini-activity-whole", "siglip": "siglip-activity-whole"}
CLIPS = (
    ("P50_webcam02_P50_coffee", "good"),
    ("P23_cam01_P23_tea", "typical"),
    ("P16_cam01_P16_milk", "bad"),
)
"""One clip per held-out person: Gemini's best clip, one near its overall accuracy, its worst."""
ACCURACY_TOLERANCE = 1e-9
FETCH_HINT = "Fetch the data with vision/scripts/fetch_data.sh."
LABEL_HINT = "Make it with `uv run dryrun-vision eval-labels` (docs/VISION.md)."


@dataclass(frozen=True)
class Scored:
    """One provider's saved results: the file's data and its per-clip frame predictions."""

    data: dict[str, Any]
    preds: dict[str, tuple[str | None, ...]]


def _truth(clip: str, n: int) -> tuple[str, ...]:
    path = require(DATA / "labels_coarse" / f"{clip}.txt", f"The label file of {clip}", FETCH_HINT)
    return read_frame_labels(path, n)


def _predict(entry: dict[str, Any], width: int, n: int, fps: float) -> tuple[str | None, ...]:
    probs = [None if w["probs"] is None else tuple(w["probs"]) for w in entry["windows"]]
    decisions = smooth_decisions(probs, entry["labels"], width, 0.0)
    starts = [w["t0"] for w in entry["windows"]]
    return tuple(decisions[max(0, bisect.bisect_right(starts, k / fps) - 1)].label for k in range(n))


def _load(name: str, counts: dict[str, int], fps: float) -> Scored:
    path = require(LABELS / f"{name}.json", f"The saved label results {name}.json", LABEL_HINT)
    data = json.loads(path.read_text(encoding="utf-8"))
    width = data["tunedOnDev"]["smoothWindows"]
    held = set(data["heldOut"]["clips"])
    preds = {
        e["clip"]: _predict(e, width, counts[e["clip"]], fps)
        for e in data["windowScores"]
        if e["clip"] in held
    }
    return Scored(data, preds)


def _accuracy(truth: Sequence[str], pred: Sequence[str | None]) -> float:
    return sum(1 for t, p in zip(truth, pred, strict=True) if t == p) / len(truth)


def _check_total(name: str, s: Scored, truths: dict[str, tuple[str, ...]]) -> None:
    hit = sum(sum(1 for t, p in zip(truths[c], s.preds[c], strict=True) if t == p) for c in s.preds)
    total = sum(len(truths[c]) for c in s.preds)
    saved = s.data["heldOut"]["smoothed"]["accuracy"]
    if abs(hit / total - saved) > ACCURACY_TOLERANCE:
        raise DemoError(
            f"Recomputed {name} held-out accuracy {hit / total:.4f} differs from the saved {saved:.4f}."
        )


def _runs(seq: Sequence[str | None], labels: list[str]) -> list[list[int]]:
    out, start = [], 0
    for lab, group in groupby(seq):
        n = sum(1 for _ in group)
        out.append([start, start + n, -1 if lab is None else labels.index(lab)])
        start += n
    return out


def _clip(
    name: str, kind: str, scored: dict[str, Scored], truth: tuple[str, ...], labels: list[str]
) -> dict[str, Any]:
    src = require(DATA / "videos" / f"{name}.avi", f"The Breakfast clip {name}", FETCH_HINT)
    video = encode(src, name, fps=15.0)
    info = probe(video)
    if info.frames != len(truth):
        raise DemoError(f"{video.name} has {info.frames} frames but {name} has {len(truth)} labelled frames.")
    first = next((i for i, t in enumerate(truth) if t != BACKGROUND), 0)
    poster(video, first, name)
    return {
        "name": name, "person": name.split("_", maxsplit=1)[0], "activity": name.rsplit("_", 1)[1],
        "kind": kind,
        "video": f"media/{name}.mp4", "poster": f"media/{name}.jpg", "w": info.width, "h": info.height,
        "fps": info.fps, "frames": len(truth), "startFrame": first,
        "acc": {p: share(_accuracy(truth, s.preds[name])) for p, s in scored.items()},
        "rows": {"truth": _runs(truth, labels),
                 **{p: _runs(s.preds[name], labels) for p, s in scored.items()}},
    }  # fmt: skip


def _summary(scored: dict[str, Scored], all_seconds: float) -> dict[str, Any]:
    g = scored["gemini"].data
    smoothed = {p: v.data["heldOut"]["smoothed"] for p, v in scored.items()}
    seg = {p: m["segments"] for p, m in smoothed.items()}
    return {
        "gemini": share(smoothed["gemini"]["accuracy"]), "siglip": share(smoothed["siglip"]["accuracy"]),
        "majority": share(g["heldOut"]["baselines"]["majority"]),
        "geminiFound": seg["gemini"]["tp"], "siglipFound": seg["siglip"]["tp"],
        "truthSegments": seg["gemini"]["tp"] + seg["gemini"]["fn"],
        "calls": g["usage"]["calls"], "tokens": g["usage"]["total_tokens"], "wallSeconds": g["wallSeconds"],
        "windows": g["windows"], "videoSeconds": round(all_seconds, 1),
        "heldOutClips": len(g["heldOut"]["clips"]),
    }  # fmt: skip


def build() -> dict[str, Any]:
    videos = sorted(require(DATA / "videos", "The Breakfast videos folder", FETCH_HINT).glob("*.avi"))
    infos = {v.stem: probe(v) for v in videos}
    fps = next(iter(infos.values())).fps
    counts = {k: i.frames for k, i in infos.items()}
    scored = {p: _load(f, counts, fps) for p, f in PROVIDERS.items()}
    truths = {c: _truth(c, counts[c]) for c in scored["gemini"].preds}
    for p, s in scored.items():
        _check_total(p, s, truths)
    labels = sorted({lab for e in scored["gemini"].data["windowScores"] for lab in e["labels"]})
    clips = [_clip(name, kind, scored, truths[name], labels) for name, kind in CLIPS]
    return {"labels": labels, "background": BACKGROUND, "clips": clips,
            "summary": _summary(scored, sum(counts.values()) / fps)}  # fmt: skip


def sources() -> tuple[Path, ...]:
    return (DATA / "videos", DATA / "labels_coarse", *(LABELS / f"{f}.json" for f in PROVIDERS.values()))
