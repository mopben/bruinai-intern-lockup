"""Section 4: stock café clip 4296 with its tracks and the saved Gemini and SigLIP labels."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from demo_common import VISION, DemoError, px, require, seconds
from demo_media import encode, poster, probe

from dryrun_vision.formats import read_tracks
from dryrun_vision.formats.actions import read_actions

VIDEO = VISION / "data/stock-cafe/mixkit-barista-and-bartenders-working-at-the-bar-4296-720.mp4"
RUN = VISION / "runs/cafe-2026-11-14"
TRACKS = RUN / "barista-4296.tracks.jsonl"
ACTIONS = {
    "gemini": RUN / "barista-4296.gemini-actions.jsonl",
    "siglip": RUN / "barista-4296.siglip-actions.jsonl",
}
POSTER_FRAME = 140
"""The frame docs/VISION.md shows (render-frame140.jpg): both people in view."""


@dataclass(frozen=True)
class Person:
    track: int
    worker: str
    who: str
    by_eye: str


PEOPLE = (
    Person(1, "red", "man, right", "talking to someone"),
    Person(2, "blue", "woman, left", "drying glasses with a cloth (cleaning)"),
)
"""Track to worker as `label --track-worker` was run. docs/VISION.md: Gemini switched to 'talking'
at 4 s for the man (worker red's segment changes at 4.0 s) and at 2 s for the woman (blue)."""
HINT = "Make it with `uv run dryrun-vision track` and `label` (docs/VISION.md, 'Stock café clips')."


def _frames(n: int) -> list[list[list[int]]]:
    out: list[list[list[int]]] = [[] for _ in range(n)]
    for d in read_tracks(require(TRACKS, "The café tracks", HINT)).detections:
        if d.frame < n:
            out[d.frame].append([d.track_id, px(d.x), px(d.y), px(d.w), px(d.h)])
    return out


def _labels(path: Path) -> dict[str, list[Any]]:
    segs = read_actions(require(path, f"The café labels {path.name}", HINT)).segments
    out: dict[str, list[Any]] = {}
    for s in segs:
        if s.label is None:
            raise DemoError(f"{path.name} has a segment without a label; it should come from `label`.")
        out.setdefault(s.worker_id, []).append([seconds(s.t0), seconds(s.t1), s.label, s.confidence])
    return out


def build() -> dict[str, Any]:
    video = encode(require(VIDEO, "The stock café clip 4296", "Fetch it with vision/scripts/fetch_data.sh."),
                   "cafe-4296", fps=30.0)  # fmt: skip
    info = probe(video)
    poster(video, POSTER_FRAME, "cafe-4296")
    labels = {p: _labels(path) for p, path in ACTIONS.items()}
    people = [
        {"track": p.track, "worker": p.worker, "who": p.who, "byEye": p.by_eye,
         **{prov: labels[prov].get(p.worker, []) for prov in labels}}
        for p in PEOPLE
    ]  # fmt: skip
    return {
        "video": "media/cafe-4296.mp4", "poster": "media/cafe-4296.jpg", "w": info.width, "h": info.height,
        "fps": info.fps, "frames": info.frames, "startFrame": POSTER_FRAME, "tracks": _frames(info.frames),
        "people": people,
    }  # fmt: skip


def sources() -> tuple[Path, ...]:
    return (VIDEO, TRACKS, *ACTIONS.values())
