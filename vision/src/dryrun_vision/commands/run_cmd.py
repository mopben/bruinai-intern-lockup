"""`dryrun-vision run <video> --calibration cal.json --run <folder> --out <folder>`: the whole chain.

video -> tracks.jsonl -> positions.jsonl -> actions.jsonl, with a short summary in plain words.
With --label the work/idle segments also get model labels (actions.jsonl source "zones+model"), using
the same identity result and the same clock (--start-offset) as positions.jsonl.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from dryrun_vision.actions import segment_actions
from dryrun_vision.commands.args import gemini_options
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.commands.label_cmd import (
    DEFAULT_VOCAB,
    add_label_model_args,
    label_with_model,
    summary,
)
from dryrun_vision.commands.positions_cmd import add_positions_args, stage_from_args, summary_lines
from dryrun_vision.commands.track_cmd import add_detector_args, track_to_file
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import ActionSegment, ActionsHeader, write_actions, write_positions
from dryrun_vision.kitchen import Kitchen, load_kitchen
from dryrun_vision.labels.labeller import LabelSettings
from dryrun_vision.labels.providers.registry import DEFAULT_PROVIDER
from dryrun_vision.labels.scoring import FrameSettings
from dryrun_vision.labels.worker_boxes import worker_boxes_from_identity
from dryrun_vision.positions.stage import PositionsStage


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("run", help="Video to tracks.jsonl, positions.jsonl and actions.jsonl in one go.")
    p.add_argument("video", type=Path, help="the filmed run")
    p.add_argument("--out", type=Path, required=True, help="output folder (created if missing)")
    p.add_argument("--tracks", type=Path, help="reuse this tracks.jsonl instead of running the detector")
    add_positions_args(p)
    add_detector_args(p)
    p.add_argument("--label", action="store_true", help="also label work/idle segments with a model")
    add_label_model_args(p, provider=None, vocab=None)
    p.set_defaults(func=run)


def _check_label_args(args: argparse.Namespace) -> None:
    if not args.label:
        if args.provider is not None or args.vocab is not None:
            raise FormatError("--provider and --vocab are used only with --label.")
        return
    if not args.video.is_file():
        raise FormatError(f"{args.video} does not exist. --label needs the video to look at the workers.")


def _labelled(
    args: argparse.Namespace, stage: PositionsStage, kitchen: Kitchen, segments: tuple[ActionSegment, ...]
) -> tuple[tuple[ActionSegment, ...], ActionsHeader, str]:
    """Model labels from the same people (identity) and the same clock as positions.jsonl."""
    settings = LabelSettings(frames=FrameSettings(crop_mode="tracks", clock=stage.clock))
    result, model = label_with_model(
        segments, args.video, kitchen, worker_boxes_from_identity(stage.identity),
        provider_name=args.provider or DEFAULT_PROVIDER, vocab_path=args.vocab or DEFAULT_VOCAB,
        settings=settings, gemini=gemini_options(args),
    )  # fmt: skip
    header = ActionsHeader(started_at=stage.header.started_at, source="zones+model", model=model)
    return result.segments, header, summary(result)


def _out_dir(path: Path) -> Path:
    if path.exists() and not path.is_dir():
        raise FormatError(f"{path} is a file. Give a folder for the outputs.")
    if not path.parent.is_dir():
        raise FormatError(f"The folder {path.parent} does not exist, so {path.name} cannot be made in it.")
    path.mkdir(exist_ok=True)
    return path


def run(args: argparse.Namespace) -> int:
    _check_label_args(args)
    out = _out_dir(args.out)
    tracks_path = out / "tracks.jsonl"
    if args.tracks is None:
        track_to_file(args, args.video, tracks_path)
    else:
        tracks_path = args.tracks
    stage = stage_from_args(args, tracks_path)
    print_warnings((*stage.identity.warnings, *stage.positions.warnings))
    write_positions(out / "positions.jsonl", stage.header, stage.positions.samples)
    kitchen = load_kitchen(args.run)
    result = segment_actions(kitchen, stage.positions.samples)
    print_warnings(result.warnings)
    segments, header = result.segments, ActionsHeader(started_at=stage.header.started_at, source="zones")
    labels = ""
    if args.label:
        segments, header, labels = _labelled(args, stage, kitchen, segments)
    write_actions(out / "actions.jsonl", header, segments)
    kinds = Counter(s.kind for s in result.segments)
    print(f"Found {len(stage.identity.people)} workers. Wrote to {out}:")
    print(f"  tracks.jsonl{'' if args.tracks is None else ' (reused ' + str(args.tracks) + ')'}")
    print(f"  positions.jsonl: {len(stage.positions.samples)} samples at 10 Hz")
    print(
        f"  actions.jsonl: {len(result.segments)} zone segments ("
        + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
        + f"), {len(result.trips)} trips"
    )
    if labels:
        print(f"  labelled with {header.model}: {labels}")
    print("\n".join(summary_lines(stage)))
    return 0
