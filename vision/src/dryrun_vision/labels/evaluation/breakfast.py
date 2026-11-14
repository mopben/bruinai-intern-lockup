"""The Breakfast Actions subset in vision/data/breakfast (see DATASETS.md): clips, labels, split.

Label files are `start-end label` lines, 1-based inclusive frames; label frame k is decoded
frame k-1 at t = (k-1)/fps. The last segment overruns the video by a frame or two; it is clamped.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.labels.errors import LabelError

BACKGROUND = "SIL"
_NAME = re.compile(r"^(P\d+)_([a-z]+\d+)_P\d+_([a-z]+)$")
_LINE = re.compile(r"^(\d+)-(\d+)\s+(\S+)$")


@dataclass(frozen=True)
class BreakfastClip:
    name: str
    person: str
    camera: str
    activity: str
    video: Path
    labels: Path


def discover_clips(root: Path) -> tuple[BreakfastClip, ...]:
    """Every video in root/videos with a coarse label file, sorted by name."""
    videos = sorted((root / "videos").glob("*.avi"))
    if not videos:
        raise LabelError(f"No .avi videos in {root / 'videos'}. Fetch the data with scripts/fetch_data.sh.")
    out = []
    for v in videos:
        m = _NAME.match(v.stem)
        labels = root / "labels_coarse" / f"{v.stem}.txt"
        if m is None or not labels.is_file():
            raise LabelError(f"{v.name} does not look like a Breakfast clip with a coarse label file.")
        out.append(BreakfastClip(v.stem, m.group(1), m.group(2), m.group(3), v, labels))
    return tuple(out)


def read_frame_labels(path: Path, n_frames: int) -> tuple[str, ...]:
    """One label per decoded frame (0-based)."""
    frames: list[str | None] = [None] * n_frames
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        m = _LINE.match(line.strip())
        if m is None:
            raise LabelError(f"{path.name} line {no}: expected 'start-end label', got {line.strip()!r}.")
        start, end = int(m.group(1)) - 1, min(int(m.group(2)), n_frames)
        frames[start:end] = [m.group(3)] * max(0, end - start)
    missing = [i for i, f in enumerate(frames) if f is None]
    if missing:
        raise LabelError(f"{path.name} gives no label for frame {missing[0] + 1} (1-based).")
    return tuple(f for f in frames if f is not None)


def split_by_person(
    clips: Sequence[BreakfastClip],
) -> tuple[tuple[BreakfastClip, ...], tuple[BreakfastClip, ...]]:
    """(development, held-out): people sorted by id, alternately dev / held-out. Fixed before any run."""
    people = sorted({c.person for c in clips})
    dev_people = set(people[0::2])
    return (
        tuple(c for c in clips if c.person in dev_people),
        tuple(c for c in clips if c.person not in dev_people),
    )
