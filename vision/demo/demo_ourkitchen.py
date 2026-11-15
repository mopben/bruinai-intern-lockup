"""Section 0: our own kitchen (2026-11-14), on the user's stabilised phone video.

Boxes are the tracker's on that video, named by hand (TRACK_MAP); bystanders are left out. The
actions are the run folder's, as the pipeline wrote them ("pipeline") and with the reviewer's
suggested corrections applied by `apply-review` ("corrected"), each label marked by its source.
No positions: the camera was too low to measure them on this clip (docs/VISION.md).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from demo_common import REPO, VISION, DemoError, px, require, seconds
from demo_media import encode, poster, probe

from dryrun_vision.formats import read_tracks
from dryrun_vision.formats.actions import read_actions
from dryrun_vision.review import read_provenance

KITCHEN = VISION / "runs/kitchen"
VIDEO = KITCHEN / "user-stable.mp4"
TRACKS = KITCHEN / "user-stable.tracks.jsonl"
RUN = REPO / "recordings/kitchen-combo-1"
PIPELINE = RUN / "actions.jsonl"
CORRECTED = RUN / "actions.suggested.jsonl"
CORRECTED_PROVENANCE = RUN / "actions.suggested.provenance.json"
TRACK_MAP = ((1, "drink", 0.0, 99.0), (3, "chips", 0.0, 17.0), (10, "chips", 17.0, 99.0))
"""(track id on user-stable.tracks.jsonl, worker, from s, to s): by hand, checked on frames. Track 10
was a man at the dining table until about 17 s, then took over the chips worker after his id 3 ended."""
WORKERS = (
    ("drink", "Drink", "beige hoodie, island door end"),
    ("chips", "Chips", "black hoodie, island dining end"),
)
OUT_WIDTH = 1280
MAX_BYTES = 8 * 1000 * 1000
POSTER_FRAME = 150
HINT = "Make it as in vision/runs/kitchen (stabilise, track, apply-review); see docs/VISION.md."


def _boxes(n: int) -> list[list[list[int]]]:
    out: list[list[list[int]]] = [[] for _ in range(n)]
    index = {w: i for i, (w, _, _) in enumerate(WORKERS)}
    for d in read_tracks(require(TRACKS, "The tracks of the user's video", HINT)).detections:
        for tid, worker, t0, t1 in TRACK_MAP:
            if d.track_id == tid and t0 <= d.t < t1 and d.frame < n:
                out[d.frame].append([index[worker], px(d.x), px(d.y), px(d.w), px(d.h)])
    return out


def _segments(path: Path, label_source: dict[tuple[str, float], str]) -> list[list[Any]]:
    segs = read_actions(require(path, f"The actions file {path.name}", HINT)).segments
    out = []
    for s in segs:
        src = label_source.get((s.worker_id, seconds(s.t0)), "model" if s.label else "none")
        out.append([s.worker_id, seconds(s.t0), seconds(s.t1), s.kind, s.label, src])
    return out


def build() -> dict[str, Any]:
    video = encode(
        require(VIDEO, "The user's stabilised video", HINT), "our-kitchen", fps=30.0, width=OUT_WIDTH
    )
    if video.stat().st_size > MAX_BYTES:
        raise DemoError(f"{video.name} is {video.stat().st_size} bytes, over 8 MB; raise its CRF.")
    info, src = probe(video), probe(VIDEO)
    poster(video, POSTER_FRAME, "our-kitchen")
    prov = read_provenance(require(CORRECTED_PROVENANCE, "The provenance of the suggested corrections", HINT))
    corrected_src = {(p.worker_id, seconds(p.t0)): p.label for p in prov.segments}
    c = prov.counts
    return {
        "video": "media/our-kitchen.mp4", "poster": "media/our-kitchen.jpg", "w": src.width, "h": src.height,
        "fps": info.fps, "frames": info.frames, "startFrame": POSTER_FRAME, "tracks": _boxes(info.frames),
        "workers": [{"id": w, "name": n, "who": who} for w, n, who in WORKERS],
        "pipeline": _segments(PIPELINE, {}), "corrected": _segments(CORRECTED, corrected_src),
        "counts": {
            "modelLabels": c.model_labels, "kept": c.model_labels_kept, "changed": c.model_labels_changed,
            "removed": c.model_labels_removed, "added": c.labels_added_by_hand, "kinds": c.kinds_changed,
        },
        "bytes": video.stat().st_size,
    }  # fmt: skip
