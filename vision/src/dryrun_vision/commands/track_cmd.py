"""`dryrun-vision track <video> --out tracks.jsonl`: person boxes with track ids (RF-DETR + ByteTrack)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dryrun_vision.commands.args import output_file, positive_float, positive_int, probability
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.detect import DEFAULT_MIN_SCORE, DEFAULT_SIZE, RFDETR_SIZES, Detector
from dryrun_vision.detect.device import DEVICES
from dryrun_vision.formats import write_tracks
from dryrun_vision.track import Tracker, TrackProgress, TrackRun

PROGRESS_EVERY_S = 2.0
"""Seconds of wall clock between progress lines on stderr."""


def add_detector_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--stride", type=positive_int, default=1, help="process every Nth frame (default 1)")
    p.add_argument("--device", choices=DEVICES, default="auto", help="auto picks mps, then cuda, then cpu")
    p.add_argument("--max-seconds", type=positive_float, help="stop after this much video time")
    p.add_argument("--model-size", choices=tuple(RFDETR_SIZES), default=DEFAULT_SIZE, help="RF-DETR size")
    p.add_argument("--min-score", type=probability, default=DEFAULT_MIN_SCORE, help="drop weaker boxes")
    p.add_argument("--weights-dir", type=Path, help="where the weights are kept (default: rfdetr's cache)")


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("track", help="Find and track people in a video; write tracks.jsonl.")
    p.add_argument("video", type=Path, help="the video file (.mp4, .mov, ...)")
    p.add_argument("--out", type=output_file, required=True, help="where to write tracks.jsonl")
    add_detector_args(p)
    p.set_defaults(func=run)


def build_detector(args: argparse.Namespace) -> Detector:
    """The real detector (tests replace this function)."""
    from dryrun_vision.detect import RFDetrDetector, resolve_device  # noqa: PLC0415 - ml extra, imported only when used

    device = resolve_device(args.device)
    print(f"Loading RF-DETR {args.model_size} on {device} ...", file=sys.stderr)
    return RFDetrDetector(args.model_size, device, args.min_score, args.weights_dir)


def build_tracker(fps: float) -> Tracker:
    """The real tracker, fed at `fps` frames per second (tests replace this function)."""
    from dryrun_vision.track import ByteTrackTracker  # noqa: PLC0415 - ml extra, imported only when used

    return ByteTrackTracker(fps)


class _Progress:
    def __init__(self) -> None:
        self._last = -PROGRESS_EVERY_S

    def __call__(self, p: TrackProgress) -> None:
        if p.seconds - self._last < PROGRESS_EVERY_S and p.frames_done != p.frames_total:
            return
        self._last = p.seconds
        share = 100 * p.frames_done / p.frames_total if p.frames_total else 0.0
        rate = p.frames_done / p.seconds if p.seconds > 0 else 0.0
        print(
            f"  frame {p.frames_done}/{p.frames_total} ({share:.0f}%), {rate:.1f} frames/s", file=sys.stderr
        )


def track_to_file(args: argparse.Namespace, video: Path, out: Path) -> TrackRun:
    """Runs detection and tracking on `video` and writes `out` (shared with `run`)."""
    from dryrun_vision.track import track_video  # noqa: PLC0415 - ml extra, imported only when used
    from dryrun_vision.video import probe_video  # noqa: PLC0415 - ml extra, imported only when used

    info = probe_video(video)
    detector = build_detector(args)
    tracker = build_tracker(info.fps / args.stride)
    result = track_video(
        video, detector, tracker, stride=args.stride, max_seconds=args.max_seconds, progress=_Progress()
    )
    print_warnings(result.warnings)
    write_tracks(out, result.header, result.detections)
    return result


def run(args: argparse.Namespace) -> int:
    result = track_to_file(args, args.video, args.out)
    ids = len({d.track_id for d in result.detections})
    print(
        f"Wrote {len(result.detections)} boxes in {ids} tracks ({result.stats.frames_read} frames, "
        f"{result.stats.fps:.1f} frames/s) to {args.out}"
    )
    return 0
