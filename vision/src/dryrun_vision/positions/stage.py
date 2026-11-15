"""tracks.jsonl + calibration + run folder -> people and positions (shared by `positions` and `run`)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.clock import NO_OFFSET, RunClock
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import CalibrationFile, PositionsHeader, TracksFile, read_run_meta, read_taps
from dryrun_vision.geometry import model_from_calibration
from dryrun_vision.identity import Anchor, IdentityResult, identify
from dryrun_vision.kitchen import Kitchen
from dryrun_vision.positions.build import PositionsResult, build_positions
from dryrun_vision.positions.resample import PRODUCT_HZ


@dataclass(frozen=True)
class PositionsStage:
    identity: IdentityResult
    positions: PositionsResult
    header: PositionsHeader
    clock: RunClock
    """How the video's times were turned into run times (the labeller needs the same)."""


def started_at(run_folder: Path) -> str:
    """When the run started: taps.jsonl's header if there is one, else run.json's recordedAt."""
    if (run_folder / "taps.jsonl").is_file():
        return read_taps(run_folder / "taps.jsonl").header.started_at
    if (run_folder / "run.json").is_file():
        return read_run_meta(run_folder / "run.json").recorded_at
    raise FormatError(
        f"{run_folder} has neither taps.jsonl nor run.json, so the run's start time is unknown."
    )


def check_image_size(tracks: TracksFile, cal: CalibrationFile) -> None:
    """The calibration must be for a picture of the same size as the video."""
    v = tracks.header.video
    if (v.width, v.height) != (cal.image_size.width, cal.image_size.height):
        raise FormatError(
            f"The calibration is for a {cal.image_size.width:g}x{cal.image_size.height:g} picture "
            f"but the video {v.file} is {v.width}x{v.height}. "
            "Calibrate on this video (or one of the same size)."
        )


def identity_stage(
    tracks: TracksFile, cal: CalibrationFile, kitchen: Kitchen | None, anchor: Anchor = "head"
) -> IdentityResult:
    """Stitched tracks assigned to workers. Raises FormatError when the calibration does not fit the video."""
    check_image_size(tracks, cal)
    return identify(tracks.detections, model_from_calibration(cal), cal, kitchen, anchor)


def positions_stage(
    tracks: TracksFile,
    cal: CalibrationFile,
    kitchen: Kitchen,
    started: str,
    *,
    anchor: Anchor = "head",
    clock: RunClock = NO_OFFSET,
) -> PositionsStage:
    """Identity, then 10 Hz positions. Raises FormatError when the calibration does not fit the video."""
    ident = identity_stage(tracks, cal, kitchen, anchor)
    model = model_from_calibration(cal)
    pos = build_positions(ident, model, cal, kitchen, anchor=anchor, clock=clock)
    return PositionsStage(ident, pos, PositionsHeader(started_at=started, hz=PRODUCT_HZ), clock)
