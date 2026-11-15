"""Section 1: PETS09-S2L1 tracks drawn over the video, and floor points in metres."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from demo_common import VISION, DemoError, metres, px, require, share
from demo_media import encode, poster, probe

from dryrun_vision.formats import read_tracks
from dryrun_vision.geometry import model_from_calibration
from dryrun_vision.identity import floor_point
from dryrun_vision.mot import read_mot_gt
from dryrun_vision.mot.report import DEFAULT_HEAD_M, gt_region
from dryrun_vision.mot.tsai import read_tsai
from dryrun_vision.mot.tsai_calibration import calibration_from_tsai, ground_to_floor

SEQ = VISION / "data/mot15-3d/PETS09-S2L1"
VIDEO = SEQ / "PETS09-S2L1.mp4"
GT = SEQ / "gt/gt.txt"
TSAI = SEQ / "maps/View_001.txt"
TRACKS = VISION / "runs/pets/tracks-rerun.jsonl"
EVAL = VISION / "runs/pets/eval-tracks-rerun-2026-11-14b.json"
FOOT_LABEL = "foot (never lean-corrected)"
START_FRAME = 1
"""Frame shown at rest: the tracker's first output frame (frame 0 has no boxes yet)."""
MAP_PAD_M = 1.0
CRF = 30
"""PETS is grainy; CRF 30 keeps it near 5 MB and the people stay sharp enough to check boxes by eye."""
MM_PER_M = 1000.0
FETCH_HINT = "Fetch the data with vision/scripts/fetch_data.sh."
TRACK_HINT = "Make it with `uv run dryrun-vision track` and `eval-tracking` (docs/VISION.md)."


@dataclass(frozen=True)
class PetsNumbers:
    recall: float
    precision: float
    idf1: float
    foot_median_m: float
    gt_people: int
    track_ids: int
    id_switches: int


def _numbers() -> PetsNumbers:
    data = json.loads(require(EVAL, "The PETS tracking evaluation", TRACK_HINT).read_text(encoding="utf-8"))
    derived, metrics = data["metrics_derived"], data["metrics"]
    foot = [f for f in data["floor"] if f["label"] == FOOT_LABEL]
    if not foot:
        raise DemoError(f"{EVAL.name} has no '{FOOT_LABEL}' floor row; run eval-tracking again.")
    return PetsNumbers(
        derived["recall"], derived["precision"], derived["idf1"], foot[0]["median_m"],
        metrics["gt_ids"], metrics["hyp_ids"], metrics["id_switches"],
    )  # fmt: skip


def _frames_of(n: int) -> list[list[Any]]:
    return [[] for _ in range(n)]


def _bounds(points: list[tuple[float, float]]) -> dict[str, float]:
    xs, zs = [p[0] for p in points], [p[1] for p in points]
    return {
        "x0": metres(min(xs) - MAP_PAD_M), "x1": metres(max(xs) + MAP_PAD_M),
        "z0": metres(min(zs) - MAP_PAD_M), "z1": metres(max(zs) + MAP_PAD_M),
    }  # fmt: skip


def _track_frames(n: int) -> list[list[Any]]:
    gt = read_mot_gt(require(GT, "The PETS ground truth", FETCH_HINT))
    tsai = read_tsai(require(TSAI, "The PETS calibration", FETCH_HINT))
    model = model_from_calibration(calibration_from_tsai(tsai, gt_region(gt)))
    tracks = read_tracks(require(TRACKS, "The PETS tracks", TRACK_HINT))
    out = _frames_of(n)
    for d in tracks.detections:
        p = floor_point(model, d, "foot", DEFAULT_HEAD_M, correct_lean=False)
        floor = [None, None] if p is None else [metres(p.x), metres(p.z)]
        out[d.frame].append([d.track_id, px(d.x), px(d.y), px(d.w), px(d.h), *floor])
    return out


def _gt_frames(n: int) -> tuple[list[list[Any]], list[tuple[float, float]]]:
    out, points = _frames_of(n), []
    for g in read_mot_gt(require(GT, "The PETS ground truth", FETCH_HINT)):
        f = ground_to_floor(g.ground)
        points.append((f.x, f.z))
        if g.frame < n:
            out[g.frame].append([g.id, metres(f.x), metres(f.z)])
    return out, points


def _camera() -> list[float]:
    cx, cy, _ = read_tsai(TSAI).centre()
    c = ground_to_floor((cx / MM_PER_M, cy / MM_PER_M))
    return [metres(c.x), metres(c.z)]


def build() -> dict[str, Any]:
    video = encode(require(VIDEO, "The PETS video", FETCH_HINT), "pets", fps=7.0, crf=CRF)
    info = probe(video)
    poster(video, START_FRAME, "pets")
    gt_frames, gt_points = _gt_frames(info.frames)
    n = _numbers()
    return {
        "video": "media/pets.mp4", "poster": "media/pets.jpg", "w": info.width, "h": info.height,
        "fps": info.fps, "frames": info.frames, "startFrame": START_FRAME,
        "tracks": _track_frames(info.frames), "gt": gt_frames, "bounds": _bounds(gt_points),
        "camera": _camera(),
        "numbers": {
            "recall": share(n.recall), "precision": share(n.precision), "idf1": share(n.idf1),
            "footMedianM": metres(n.foot_median_m), "gtPeople": n.gt_people, "trackIds": n.track_ids,
            "idSwitches": n.id_switches,
        },
    }  # fmt: skip


def sources() -> tuple[Path, ...]:
    return (VIDEO, GT, TSAI, TRACKS, EVAL)
