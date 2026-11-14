"""argparse value checks with plain-sentence messages (shared by the ML subcommands)."""

from __future__ import annotations

import argparse
from pathlib import Path

from dryrun_vision.clock import RunClock
from dryrun_vision.labels.providers.call_guard import DEFAULT_MAX_CALLS, CallPolicy
from dryrun_vision.labels.providers.gemini import GEMINI_MODEL, GeminiOptions


def positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'"{text}" is not a whole number.') from exc
    if value < 1:
        raise argparse.ArgumentTypeError(f"must be 1 or more, not {value}.")
    return value


def positive_float(text: str) -> float:
    try:
        value = float(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'"{text}" is not a number.') from exc
    if not value > 0:
        raise argparse.ArgumentTypeError(f"must be more than 0, not {value}.")
    return value


def probability(text: str) -> float:
    try:
        value = float(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'"{text}" is not a number.') from exc
    if not 0 <= value <= 1:
        raise argparse.ArgumentTypeError(f"must be from 0 to 1, not {value}.")
    return value


def non_negative_float(text: str) -> float:
    try:
        value = float(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'"{text}" is not a number.') from exc
    if value < 0:
        raise argparse.ArgumentTypeError(f"must be 0 or more, not {value}.")
    return value


def output_file(text: str) -> Path:
    """A file to write: its folder must exist (it is not created)."""
    path = Path(text)
    if not path.parent.is_dir():
        raise argparse.ArgumentTypeError(f"the folder {path.parent} does not exist.")
    if path.is_dir():
        raise argparse.ArgumentTypeError(f"{path} is a folder; give a file name.")
    return path


START_OFFSET_HELP = "seconds of video before the run started: run time = video time - this (default 0)"


def add_start_offset(p: argparse.ArgumentParser) -> None:
    """The one clock flag. positions, label, run and render all read it the same way."""
    p.add_argument("--start-offset", type=non_negative_float, default=0.0, help=START_OFFSET_HELP)


def clock_of(args: argparse.Namespace) -> RunClock:
    return RunClock(start_offset_s=args.start_offset)


def add_gemini_args(p: argparse.ArgumentParser) -> None:
    """Only used with --provider gemini."""
    p.add_argument("--gemini-model", default=GEMINI_MODEL, help=f"Gemini model (default {GEMINI_MODEL})")
    p.add_argument(
        "--gemini-max-calls", type=positive_int, default=DEFAULT_MAX_CALLS,
        help=f"stop calling Gemini after this many requests in this run (default {DEFAULT_MAX_CALLS})",
    )  # fmt: skip


def gemini_options(args: argparse.Namespace) -> GeminiOptions:
    return GeminiOptions(model=args.gemini_model, policy=CallPolicy(max_calls=args.gemini_max_calls))
