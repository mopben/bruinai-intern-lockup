"""`dryrun-vision` command line. Each subcommand lives in dryrun_vision.commands.

To add a subcommand: write a module with `register(subparsers)` that adds a parser
and sets `func=<handler(args) -> int>`, then list it in COMMANDS below.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence
from types import ModuleType

from dryrun_vision.commands import (
    actions_cmd,
    eval_cmd,
    eval_labels_cmd,
    eval_tracking_cmd,
    label_cmd,
    positions_cmd,
    render_cmd,
    run_cmd,
    track_cmd,
)
from dryrun_vision.errors import DryRunError

COMMANDS: tuple[ModuleType, ...] = (actions_cmd, eval_cmd, label_cmd, eval_labels_cmd)
COMMANDS += (track_cmd, positions_cmd, run_cmd, render_cmd, eval_tracking_cmd)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dryrun-vision", description="Dry Run vision pipeline.")
    sub = parser.add_subparsers(dest="command", required=True, metavar="<command>")
    for module in COMMANDS:
        module.register(sub)
    return parser


class _StderrWarnings(logging.Handler):
    """Warnings from the readers and the kitchen ("dryrun_vision" logger) as "warning: ..." lines."""

    def emit(self, record: logging.LogRecord) -> None:
        print(f"warning: {record.getMessage()}", file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    """Runs one subcommand. Returns the exit code: 0 ok, 1 a problem with the input (message on stderr)."""
    args = build_parser().parse_args(argv)
    logger = logging.getLogger("dryrun_vision")
    handler = _StderrWarnings(logging.WARNING)
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        return int(args.func(args))
    except DryRunError as exc:
        print(f"dryrun-vision: {exc}", file=sys.stderr)
        return 1
    finally:
        logger.removeHandler(handler)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
