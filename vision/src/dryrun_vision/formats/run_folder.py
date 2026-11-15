"""One run folder: run.json, scan.json, setup.json, layout.json, taps.jsonl, positions.jsonl."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.errors import FormatError
from dryrun_vision.formats.kitchen_files import (
    Layout,
    RunMeta,
    Scan,
    Setup,
    read_layout,
    read_run_meta,
    read_scan,
    read_setup,
)
from dryrun_vision.formats.positions import PositionsFile, read_positions
from dryrun_vision.formats.taps import TapsFile, read_taps

RUN_FILES = ("run.json", "scan.json", "setup.json", "layout.json", "taps.jsonl", "positions.jsonl")


@dataclass(frozen=True)
class RunFolder:
    path: Path
    meta: RunMeta
    scan: Scan
    setup: Setup
    layout: Layout
    taps: TapsFile
    positions: PositionsFile


def read_run_folder(folder: Path, positions: Path | None = None) -> RunFolder:
    """Reads all six files. `positions` overrides the folder's positions.jsonl (e.g. a tracked one)."""
    if not folder.is_dir():
        raise FormatError(f"{folder} is not a folder. Give the path of a run folder.")
    missing = [f for f in RUN_FILES if not (folder / f).is_file()]
    if missing:
        raise FormatError(f"{folder} is missing {', '.join(missing)}. A run folder needs all six files.")
    return RunFolder(
        path=folder,
        meta=read_run_meta(folder / "run.json"),
        scan=read_scan(folder / "scan.json"),
        setup=read_setup(folder / "setup.json"),
        layout=read_layout(folder / "layout.json"),
        taps=read_taps(folder / "taps.jsonl"),
        positions=read_positions(positions if positions is not None else folder / "positions.jsonl"),
    )
