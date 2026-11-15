"""eval-tracking: tracking metrics, our calibration's fit to the Tsai camera, floor error, stitching."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import Detection, TracksFile, TracksHeader
from dryrun_vision.geometry import CameraModel, model_from_calibration
from dryrun_vision.identity import Anchor, floor_point, identify
from dryrun_vision.mot.gt import GtBox
from dryrun_vision.mot.metrics import Match, TrackingMetrics, evaluate_tracking
from dryrun_vision.mot.tsai import TsaiCamera
from dryrun_vision.mot.tsai_calibration import (
    CalibrationFit,
    Region,
    calibration_fit,
    calibration_from_tsai,
    ground_to_floor,
)

DEFAULT_HEAD_M = 1.70
"""Metres. One assumed head height for everyone (PETS has no per-person heights)."""
P90 = 0.9
UNSTITCHED_OFFSET = 1_000_000
"""Track ids of fragments that stitching left out are shifted by this, so they stay separate."""


@dataclass(frozen=True)
class FloorErrorStats:
    label: str
    n: int
    median_m: float
    p90_m: float
    worst_m: float


@dataclass(frozen=True)
class TrackingReport:
    metrics: TrackingMetrics
    frames: tuple[int, ...]
    fit: CalibrationFit | None
    floor: tuple[FloorErrorStats, ...]
    people: int | None
    """Identities after no-kitchen stitching (None without a calibration)."""
    stitched: TrackingMetrics | None
    note: str | None = None
    """Why the evaluated frames may be off (an older tracks.jsonl), if so."""


def evaluated_frames(header: TracksHeader, gt: Sequence[GtBox]) -> tuple[tuple[int, ...], str | None]:
    """The frames the tracker processed, from the tracks.jsonl header (stride, framesRead), so people
    missed after the last detection still count. Older files without those fields: every frame up
    to the video's frame count (or the last ground-truth frame), with a note to show."""
    if header.stride is not None and header.frames_read is not None:
        return tuple(range(0, header.stride * header.frames_read, header.stride)), None
    last = max([header.video.frames - 1, *(g.frame for g in gt)], default=-1)
    note = (
        "tracks.jsonl does not say which frames were processed (no stride and framesRead in its "
        f"header: made by an older `track`). Evaluating every frame from 0 to {last}; if it was tracked "
        "with --stride, run `track` again."
    )
    return tuple(range(last + 1)), note


def _stats(label: str, errors: Sequence[float]) -> FloorErrorStats:
    if not errors:
        return FloorErrorStats(label, 0, math.nan, math.nan, math.nan)
    s = sorted(errors)
    return FloorErrorStats(label, len(s), median(s), s[min(len(s) - 1, int(P90 * len(s)))], s[-1])


def floor_errors(
    matches: Sequence[Match], model: CameraModel, anchor: Anchor, head_m: float, *, lean: bool, label: str
) -> FloorErrorStats:
    """Metres between our floor point of each matched box and the ground-truth ground position."""
    errs: list[float] = []
    for mt in matches:
        p = floor_point(model, mt.hyp, anchor, head_m, correct_lean=lean)
        if p is not None:
            g = ground_to_floor(mt.gt.ground)
            errs.append(math.hypot(p.x - g.x, p.z - g.z))
    return _stats(label, errs)


def gt_region(gt: Sequence[GtBox]) -> Region:
    pts = [g.ground for g in gt if g.flag == 1]
    if not pts:
        raise FormatError(
            "The ground truth has no evaluated rows (flag 1), so there is no area to calibrate on."
        )
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return ((min(xs), min(ys)), (max(xs), max(ys)))


def _stitched(
    detections: Sequence[Detection], model: CameraModel, head_m: float
) -> tuple[int, list[Detection]]:
    ident = identify(detections, model, None, None, "head")
    person_of = {tid: i + 1 for i, p in enumerate(ident.people) for tid in p.track_ids}
    renamed = [
        d.model_copy(update={"track_id": person_of.get(d.track_id, UNSTITCHED_OFFSET + d.track_id)})
        for d in detections
    ]
    return len(ident.people), renamed


def tracking_report(
    tracks: TracksFile,
    gt: Sequence[GtBox],
    tsai: TsaiCamera | None,
    head_m: float = DEFAULT_HEAD_M,
) -> TrackingReport:
    detections = tracks.detections
    frames, note = evaluated_frames(tracks.header, gt)
    metrics, matches = evaluate_tracking(gt, detections, frames)
    if tsai is None:
        return TrackingReport(metrics, frames, None, (), None, None, note)
    region = gt_region(gt)
    model = model_from_calibration(calibration_from_tsai(tsai, region))
    floor = (
        floor_errors(matches, model, "foot", head_m, lean=False, label="foot (never lean-corrected)"),
        floor_errors(matches, model, "head", head_m, lean=True, label=f"head at {head_m:g} m"),
        floor_errors(
            matches, model, "head", head_m, lean=False, label=f"head at {head_m:g} m, no lean correction"
        ),
    )
    people, renamed = _stitched(detections, model, head_m)
    stitched, _ = evaluate_tracking(gt, renamed, frames)
    fit = calibration_fit(tsai, model, region)
    return TrackingReport(metrics, frames, fit, floor, people, stitched, note)


def _metric_lines(name: str, m: TrackingMetrics) -> list[str]:
    return [
        f"{name}:",
        f"  frames {m.frames}, ground-truth boxes {m.gt} ({m.gt_ids} people), "
        f"our boxes {m.hyp} ({m.hyp_ids} ids)",
        f"  detection at IoU 0.5: precision {m.precision:.3f}, recall {m.recall:.3f} "
        f"(TP {m.tp}, FP {m.fp}, FN {m.fn})",
        f"  MOTA {m.mota:.3f}, IDF1 {m.idf1:.3f}, id switches {m.id_switches}, "
        f"fragmentations {m.fragmentations}",
    ]


def format_tracking_report(r: TrackingReport) -> str:
    lines = _metric_lines("Tracking (raw tracker ids)", r.metrics)
    if r.fit is not None:
        f = r.fit
        lines += [
            "Our pinhole calibration vs the Tsai camera (which has lens distortion):",
            f"  reprojection: median {f.median_px:.2f} px, worst {f.worst_px:.2f} px over {f.points} points",
            f"  floor from a pixel at 0 m: median {f.floor_median_cm:.1f} cm, "
            f"worst {f.floor_worst_cm:.1f} cm",
            f"  floor from a pixel at 1.7 m: median {f.head_median_cm:.1f} cm, "
            f"worst {f.head_worst_cm:.1f} cm",
            "Floor error of matched boxes vs ground truth (metres):",
        ]
        lines += [
            f"  {s.label}: median {s.median_m:.3f}, p90 {s.p90_m:.3f}, worst {s.worst_m:.3f} (n {s.n})"
            for s in r.floor
        ]
    if r.stitched is not None:
        lines.append(f"No-kitchen stitching: {r.people} identities (ground truth has {r.metrics.gt_ids}).")
        lines += _metric_lines("Tracking after stitching", r.stitched)
    return "\n".join(lines)
