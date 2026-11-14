"""`dryrun-vision positions <tracks.jsonl> --calibration cal.json --run <folder> --out positions.jsonl`."""

from __future__ import annotations

import argparse
from pathlib import Path

from dryrun_vision.commands.args import add_start_offset, clock_of, output_file
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.formats import read_calibration, read_tracks, write_positions
from dryrun_vision.identity import ANCHORS
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.positions.stage import PositionsStage, positions_stage, started_at


def add_positions_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--calibration", type=Path, required=True, help="camera calibration exported by /camera")
    p.add_argument(
        "--run", type=Path, required=True, help="run folder with scan.json, setup.json, layout.json"
    )
    p.add_argument(
        "--anchor",
        choices=ANCHORS,
        default="head",
        help="head: top of the box at the worker's height (default); foot: bottom of the box on the floor",
    )
    add_start_offset(p)


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("positions", help="Turn tracks.jsonl into per-worker positions.jsonl (10 Hz).")
    p.add_argument("tracks", type=Path, help="tracks.jsonl from `track`")
    p.add_argument("--out", type=output_file, required=True, help="where to write positions.jsonl")
    add_positions_args(p)
    p.set_defaults(func=run)


def stage_from_args(args: argparse.Namespace, tracks_path: Path) -> PositionsStage:
    """Reads the inputs named on the command line and runs identity + positions (shared with `run`)."""
    tracks = read_tracks(tracks_path)
    cal = read_calibration(args.calibration)
    kitchen = load_kitchen(args.run)
    return positions_stage(
        tracks, cal, kitchen, started_at(args.run), anchor=args.anchor, clock=clock_of(args)
    )


def summary_lines(stage: PositionsStage) -> list[str]:
    """Plain-words summary of who was found (shared with `run`)."""
    lines: list[str] = []
    for p in stage.identity.people:
        n = sum(1 for s in stage.positions.samples if s.worker_id == p.name)
        ids = ", ".join(str(i) for i in p.track_ids)
        lines.append(f"  {p.name}: {n} samples, {p.t0:.1f}-{p.t1:.1f} s of video, from track(s) {ids}")
    for d in stage.identity.dropped:
        ids = ", ".join(str(i) for i in d.track_ids)
        lines.append(f"  left out track(s) {ids} ({d.seconds:.1f} s): {d.reason}")
    return lines


def run(args: argparse.Namespace) -> int:
    stage = stage_from_args(args, args.tracks)
    print_warnings((*stage.identity.warnings, *stage.positions.warnings))
    write_positions(args.out, stage.header, stage.positions.samples)
    print(
        f"Wrote {len(stage.positions.samples)} samples for {len(stage.identity.people)} workers to {args.out}"
    )
    print("\n".join(summary_lines(stage)))
    return 0
