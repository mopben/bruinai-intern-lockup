"""`review-table` and `apply-review`: a person corrects actions.jsonl; provenance is kept beside it."""

from __future__ import annotations

import argparse
from pathlib import Path

from dryrun_vision.commands.args import output_file
from dryrun_vision.formats import read_actions
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.review import apply_review, provenance_path, write_review


def register(sub: argparse._SubParsersAction) -> None:
    t = sub.add_parser(
        "review-table", help="Write review.csv: one row per action segment, to correct by hand."
    )
    t.add_argument("actions", type=Path, help="actions.jsonl to review")
    t.add_argument("--run", type=Path, help="run folder: show station names next to box ids")
    t.add_argument("--out", type=output_file, required=True, help="the review .csv to write")
    t.set_defaults(func=run_table)
    a = sub.add_parser(
        "apply-review",
        help="Apply a filled-in review.csv; writes actions.jsonl and actions.provenance.json beside it.",
    )
    a.add_argument("actions", type=Path, help="actions.jsonl the table was made from")
    a.add_argument("review", type=Path, help="the filled-in review .csv")
    a.add_argument("--out", type=output_file, required=True, help="the corrected actions.jsonl to write")
    a.set_defaults(func=run_apply)


def run_table(args: argparse.Namespace) -> int:
    actions = read_actions(args.actions)
    names = {} if args.run is None else {i.id: i.name for i in load_kitchen(args.run).items}
    write_review(args.out, actions, names)
    n = len(actions.segments)
    print(f"Wrote {n} rows to {args.out}. Fill in the correct_* columns; an empty cell keeps the value.")
    return 0


def run_apply(args: argparse.Namespace) -> int:
    result = apply_review(args.actions, args.review, args.out)
    c = result.provenance.counts
    print(
        f"Wrote {args.out} ({len(result.actions.segments)} segments) and {provenance_path(args.out).name}: "
        f"model labels kept {c.model_labels_kept} of {c.model_labels}, changed {c.model_labels_changed}, "
        f"removed {c.model_labels_removed}; labels added by hand {c.labels_added_by_hand}; "
        f"kinds changed {c.kinds_changed}, times changed {c.times_changed}, "
        f"segments deleted {c.segments_deleted}."
    )
    return 0
