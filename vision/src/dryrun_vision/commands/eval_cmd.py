"""`dryrun-vision eval-actions <run folder>`: compare actions with the run's taps."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dryrun_vision.commands.actions_cmd import zone_actions
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.errors import FormatError
from dryrun_vision.evaluate import evaluate_actions, format_report, report_to_json
from dryrun_vision.formats import read_actions, read_run_folder
from dryrun_vision.kitchen import load_kitchen


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser(
        "eval-actions", help="Compare actions with the run's taps.jsonl and print the numbers."
    )
    p.add_argument("run", type=Path, help="run folder")
    p.add_argument(
        "--actions", type=Path, help="actions.jsonl to evaluate (default: compute zone actions now)"
    )
    p.add_argument("--positions", type=Path, help="positions.jsonl to use instead of the folder's")
    p.add_argument("--json", type=Path, dest="json_out", help="also write the full report as JSON here")
    p.set_defaults(func=run)


def run(args: argparse.Namespace) -> int:
    if args.actions is None:
        run_data, result = zone_actions(args.run, args.positions)
        print_warnings(result.warnings)
        segments, source = result.segments, "zones (computed now)"
    else:
        run_data = read_run_folder(args.run, args.positions)
        actions = read_actions(args.actions)
        segments, source = actions.segments, f"{args.actions.name} ({actions.header.source})"
    report = evaluate_actions(run_data, load_kitchen(args.run), segments, source)
    print(format_report(report))
    if args.json_out is not None:
        try:
            args.json_out.write_text(json.dumps(report_to_json(report), indent=2) + "\n")
        except OSError as exc:
            raise FormatError(f"Could not write {args.json_out}: {exc}") from exc
    return 0
