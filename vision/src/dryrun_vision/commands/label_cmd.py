"""`dryrun-vision label <video>`: add model labels to the work/idle segments of an actions.jsonl."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from dryrun_vision.commands.args import (
    add_gemini_args,
    add_start_offset,
    clock_of,
    gemini_options,
    positive_float,
)
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import (
    ActionSegment,
    ActionsHeader,
    read_actions,
    read_calibration,
    read_tracks,
    write_actions,
)
from dryrun_vision.identity import ANCHORS
from dryrun_vision.kitchen import Kitchen, load_kitchen
from dryrun_vision.labels.constants import MIN_CONFIDENCE, WINDOW_S
from dryrun_vision.labels.labeller import LabelResult, LabelSettings, label_segments
from dryrun_vision.labels.providers.gemini import GeminiOptions
from dryrun_vision.labels.providers.registry import DEFAULT_PROVIDER, make_provider, usage_summary
from dryrun_vision.labels.scoring import CROP_MODES, FrameSettings
from dryrun_vision.labels.vocab import bundled_vocab, read_vocab
from dryrun_vision.labels.worker_boxes import (
    WorkerBoxes,
    worker_boxes_from_identity,
    worker_boxes_from_tracks,
)
from dryrun_vision.positions.stage import identity_stage
from dryrun_vision.video import VideoFrames

DEFAULT_VOCAB = bundled_vocab("cafe")


def add_label_model_args(p: argparse.ArgumentParser, *, provider: str | None, vocab: Path | None) -> None:
    """--provider and --vocab (shared with `run --label`, where they default to None to spot misuse)."""
    p.add_argument(
        "--vocab", type=Path, default=vocab, help=f"label vocabulary JSON (default {DEFAULT_VOCAB.name})"
    )
    p.add_argument(
        "--provider",
        default=provider,
        help=f"{DEFAULT_PROVIDER} (default, local) or gemini (sends frames to Google)",
    )
    add_gemini_args(p)


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("label", help="Label work/idle segments from the video with a zero-shot model.")
    p.add_argument("video", type=Path, help="the run's video")
    p.add_argument("--actions", type=Path, required=True, help="zone actions.jsonl to label")
    p.add_argument(
        "--run", type=Path, required=True, help="run folder (scan, setup, layout) for station names"
    )
    p.add_argument("--tracks", type=Path, help="tracks.jsonl from `track` (without it: whole frames)")
    p.add_argument(
        "--calibration", type=Path, help="with --tracks: find each worker's boxes as `positions` does"
    )
    p.add_argument("--anchor", choices=ANCHORS, default="head", help="as given to positions/run")
    p.add_argument(
        "--track-worker", action="append", default=[], metavar="TRACK=WORKER",
        help="with --tracks, instead of --calibration: trackId to workerId by hand, repeatable",
    )  # fmt: skip
    add_label_model_args(p, provider=DEFAULT_PROVIDER, vocab=DEFAULT_VOCAB)
    p.add_argument("--crop", choices=CROP_MODES, help="tracks (default with --tracks), whole or centre")
    add_start_offset(p)
    p.add_argument(
        "--window", type=positive_float, default=WINDOW_S, help=f"window length in s (default {WINDOW_S})"
    )
    p.add_argument("--min-confidence", type=float, default=MIN_CONFIDENCE, help="below this: no label")
    p.add_argument("--out", type=Path, required=True, help="where to write the labelled actions.jsonl")
    p.set_defaults(func=run)


def parse_track_map(pairs: list[str]) -> dict[int, str]:
    out: dict[int, str] = {}
    for pair in pairs:
        track, sep, worker = pair.partition("=")
        if not sep or not worker or not track.strip().lstrip("-").isdigit():
            raise FormatError(f'--track-worker "{pair}" must look like 3=red (a trackId, "=", a workerId).')
        out = {**out, int(track): worker.strip()}
    return out


def _boxes(args: argparse.Namespace, kitchen: Kitchen) -> dict[str, WorkerBoxes]:
    """Worker boxes: from the identity stage with --calibration, or from an explicit --track-worker map."""
    if args.tracks is None:
        if args.calibration is not None or args.track_worker:
            raise FormatError("--calibration and --track-worker need --tracks tracks.jsonl.")
        return {}
    tracks = read_tracks(args.tracks)
    if args.track_worker:
        mapping = parse_track_map(args.track_worker)
        return {w.worker_id: w for w in worker_boxes_from_tracks(tracks.detections, mapping)}
    if args.calibration is None:
        raise FormatError(
            "Give --calibration (to find the workers as `positions` does) or --track-worker 3=red "
            "to say which track is which worker."
        )
    return worker_boxes_from_identity(
        identity_stage(tracks, read_calibration(args.calibration), kitchen, args.anchor)
    )


def _settings(args: argparse.Namespace) -> LabelSettings:
    crop = args.crop or ("tracks" if args.tracks is not None else "whole")
    if crop == "tracks" and args.tracks is None:
        raise FormatError("--crop tracks needs --tracks tracks.jsonl.")
    if not 0 <= args.min_confidence <= 1:
        raise FormatError(f"--min-confidence must be from 0 to 1 (got {args.min_confidence}).")
    frames = FrameSettings(crop_mode=crop, clock=clock_of(args))
    return LabelSettings(window_s=args.window, min_confidence=args.min_confidence, frames=frames)


def label_with_model(
    segments: Sequence[ActionSegment],
    video: Path,
    kitchen: Kitchen,
    boxes: Mapping[str, WorkerBoxes],
    *,
    provider_name: str,
    vocab_path: Path,
    settings: LabelSettings,
    gemini: GeminiOptions,
) -> tuple[LabelResult, str]:
    """Labels the work/idle segments from the video (shared with `run --label`). Returns (result, model)."""
    vocab = read_vocab(vocab_path)
    provider = make_provider(provider_name, gemini)
    names = {i.id: i.name for i in kitchen.items}
    with VideoFrames(video) as frames:
        result = label_segments(
            segments, station_names=names, vocab=vocab, provider=provider, video=frames,
            boxes=boxes, settings=settings,
        )  # fmt: skip
    print_warnings(result.warnings)
    usage = usage_summary(provider)
    if usage is not None:
        print(f"{provider.name}: {usage}", file=sys.stderr)
    return result, provider.name


def summary(result: LabelResult) -> str:
    labelled = sum(1 for s in result.segments if s.label is not None)
    return (
        f"{len(result.segments)} segments ({labelled} labelled, {result.windows} windows, "
        f"{result.unscored_windows} unscored)"
    )


def run(args: argparse.Namespace) -> int:
    actions = read_actions(args.actions)
    kitchen = load_kitchen(args.run)
    settings = _settings(args)
    boxes = _boxes(args, kitchen)
    result, model = label_with_model(
        actions.segments, args.video, kitchen, boxes,
        provider_name=args.provider, vocab_path=args.vocab, settings=settings,
        gemini=gemini_options(args),
    )  # fmt: skip
    header = ActionsHeader(started_at=actions.header.started_at, source="zones+model", model=model)
    write_actions(args.out, header, result.segments)
    print(f"Wrote {summary(result)} to {args.out}", file=sys.stdout)
    return 0
