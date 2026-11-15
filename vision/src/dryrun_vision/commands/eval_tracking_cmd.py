"""`dryrun-vision eval-tracking <tracks.jsonl> --gt gt.txt [--tsai View_001.txt]`: tracking numbers."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from dryrun_vision.commands.args import output_file, positive_float
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import read_tracks
from dryrun_vision.mot import read_mot_gt
from dryrun_vision.mot.report import DEFAULT_HEAD_M, format_tracking_report, gt_region, tracking_report
from dryrun_vision.mot.tsai import read_tsai
from dryrun_vision.mot.tsai_calibration import calibration_from_tsai


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("eval-tracking", help="Compare tracks.jsonl with MOTChallenge ground truth.")
    p.add_argument("tracks", type=Path, help="tracks.jsonl from `track` on the sequence's video")
    p.add_argument("--gt", type=Path, required=True, help="gt/gt.txt of the sequence")
    p.add_argument("--tsai", type=Path, help="maps/View_001.txt: also measure floor error in metres")
    p.add_argument(
        "--head-height", type=positive_float, default=DEFAULT_HEAD_M, help="assumed head height, m"
    )
    p.add_argument("--write-calibration", type=output_file, help="save the calibration made from --tsai")
    p.add_argument("--json", type=output_file, dest="json_out", help="also write the numbers as JSON")
    p.set_defaults(func=run)


def _write(path: Path, text: str) -> None:
    try:
        path.write_text(text, encoding="utf-8")
    except OSError as exc:
        raise FormatError(f"Could not write {path}: {exc}") from exc


def run(args: argparse.Namespace) -> int:
    if args.write_calibration is not None and args.tsai is None:
        raise FormatError("--write-calibration needs --tsai.")
    tracks = read_tracks(args.tracks)
    gt = read_mot_gt(args.gt)
    tsai = None if args.tsai is None else read_tsai(args.tsai)
    report = tracking_report(tracks, gt, tsai, args.head_height)
    if report.note is not None:
        print_warnings([report.note])
    print(format_tracking_report(report))
    if args.write_calibration is not None and tsai is not None:
        cal = calibration_from_tsai(tsai, gt_region(gt))
        _write(args.write_calibration, json.dumps(cal.to_json(), indent=2) + "\n")
    if args.json_out is not None:
        data = {k: v for k, v in asdict(report).items() if k != "frames"}
        data["metrics_derived"] = {
            "precision": report.metrics.precision,
            "recall": report.metrics.recall,
            "mota": report.metrics.mota,
            "idf1": report.metrics.idf1,
        }
        _write(args.json_out, json.dumps(data, indent=2) + "\n")
    return 0
