"""`dryrun-vision actions <run folder>`: zone-based actions.jsonl from positions.jsonl."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dryrun_vision.actions import SegmentationResult, segment_actions
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.formats import ActionsHeader, RunFolder, read_run_folder, write_actions
from dryrun_vision.kitchen import load_kitchen


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("actions", help="Turn a run's positions.jsonl into zone-based actions.jsonl.")
    p.add_argument("run", type=Path, help="run folder (scan, setup, layout, taps, positions)")
    p.add_argument("--positions", type=Path, help="use this positions.jsonl instead of the folder's")
    p.add_argument("--out", type=Path, help="where to write actions.jsonl (default: print to stdout)")
    p.set_defaults(func=run)


def zone_actions(run_folder: Path, positions: Path | None = None) -> tuple[RunFolder, SegmentationResult]:
    """Reads a run folder and segments its positions (shared with eval-actions)."""
    run_data = read_run_folder(run_folder, positions)
    kitchen = load_kitchen(run_folder)
    return run_data, segment_actions(kitchen, run_data.positions.samples)


def run(args: argparse.Namespace) -> int:
    run_data, result = zone_actions(args.run, args.positions)
    header = ActionsHeader(started_at=run_data.positions.header.started_at, source="zones")
    print_warnings(result.warnings)
    if args.out is None:
        print(json.dumps(header.to_json(), separators=(",", ":")))
        for s in result.segments:
            print(json.dumps(s.to_json(), separators=(",", ":")))
        return 0
    write_actions(args.out, header, result.segments)
    print(f"Wrote {len(result.segments)} segments ({len(result.trips)} trips) to {args.out}", file=sys.stdout)
    return 0
