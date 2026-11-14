"""`dryrun-vision render <video> --tracks tracks.jsonl --out check.mp4`: draw the tracking on the video."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from dryrun_vision.commands.args import add_start_offset, clock_of, output_file, positive_float
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import (
    ActionSegment,
    Detection,
    TracksFile,
    read_actions,
    read_calibration,
    read_tracks,
)
from dryrun_vision.identity import ANCHORS
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.positions.stage import identity_stage
from dryrun_vision.render import BoxLabel, frame_labels, hex_to_bgr, render_video


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("render", help="Draw boxes, ids and actions onto the video (.mp4) to check by eye.")
    p.add_argument("video", type=Path, help="the video the tracks came from")
    p.add_argument("--tracks", type=Path, required=True, help="tracks.jsonl")
    p.add_argument("--out", type=output_file, required=True, help="the .mp4 to write")
    p.add_argument("--calibration", type=Path, help="with --run: name the boxes by worker")
    p.add_argument("--run", type=Path, help="run folder (kitchen) for worker names and colours")
    p.add_argument("--anchor", choices=ANCHORS, default="head")
    p.add_argument("--actions", type=Path, help="actions.jsonl: show each worker's current action")
    add_start_offset(p)
    p.add_argument("--max-seconds", type=positive_float, help="only the first S seconds")
    p.set_defaults(func=run)


def _identity(args: argparse.Namespace, tracks: TracksFile) -> tuple[dict[int, str], dict, dict]:
    if (args.calibration is None) != (args.run is None):
        raise FormatError("Give --calibration and --run together to name workers (or neither).")
    if args.calibration is None:
        return {}, {}, {}
    cal = read_calibration(args.calibration)
    kitchen = load_kitchen(args.run)
    ident = identity_stage(tracks, cal, kitchen, args.anchor)
    names = {tid: p.name for p in ident.people for tid in p.track_ids}
    colours = {w.id: hex_to_bgr(w.color) for w in kitchen.workers}
    box_names = {i.id: i.name for i in kitchen.items}
    return names, colours, box_names


def run(args: argparse.Namespace) -> int:
    tracks = read_tracks(args.tracks)
    if args.actions is not None and args.run is None:
        raise FormatError("--actions needs --calibration and --run (actions are per worker).")
    names, colours, box_names = _identity(args, tracks)
    actions: tuple[ActionSegment, ...] = () if args.actions is None else read_actions(args.actions).segments
    named = args.run is not None
    clock = clock_of(args)

    def labels_for(_index: int, t: float, dets: Sequence[Detection]) -> tuple[BoxLabel, ...]:
        return frame_labels(
            dets,
            names if named else None,
            colours=colours,
            actions=actions,
            run_t=clock.run_time(t),
            box_names=box_names,
        )

    stats = render_video(args.video, tracks.detections, args.out, labels_for, max_seconds=args.max_seconds)
    print(f"Wrote {stats.frames} frames ({stats.codec}) to {args.out}")
    return 0
