"""tracks.jsonl: person boxes per video frame with tracker ids, in source-video pixels.

Intermediate file between the detector/tracker and track-to-worker assignment.
`x, y` is the box's top-left corner, `w, h` its size, `t` seconds from the start
of the video, `frame` 0-based. Lines are sorted by frame, then trackId.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from pydantic import Field, field_serializer

from dryrun_vision.formats.base import (
    FrozenModel,
    Items,
    NonEmpty,
    Seconds,
    check_sorted,
    parse_jsonl,
    round_time,
    write_jsonl,
)


class VideoInfo(FrozenModel):
    file: NonEmpty
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    frames: int = Field(ge=0)


class TracksHeader(FrozenModel):
    type: Literal["header"] = "header"
    format: Literal["dryrun.tracks"] = "dryrun.tracks"
    version: Literal[1] = 1
    video: VideoInfo
    detector: NonEmpty
    tracker: NonEmpty
    stride: int | None = Field(default=None, ge=1)
    """Every stride-th frame was processed (written by `track`; older files leave it out)."""
    frames_read: int | None = Field(default=None, ge=0)
    """How many frames were processed: frames 0, stride, ..., stride * (frames_read - 1)."""


class Detection(FrozenModel):
    type: Literal["det"] = "det"
    frame: int = Field(ge=0)
    t: Seconds
    track_id: int
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    score: float = Field(ge=0, le=1)

    @field_serializer("t")
    def _round_t(self, t: float) -> float:
        return round_time(t)


class TracksFile(FrozenModel):
    header: TracksHeader
    detections: Items[Detection]


def _order(d: Detection) -> tuple[int, int]:
    return (d.frame, d.track_id)


def read_tracks(path: Path) -> TracksFile:
    """Reads tracks.jsonl; fails on the first line out of (frame, trackId) order."""
    header, body = parse_jsonl(path, TracksHeader, Detection.model_validate_json, tagged_union=False)
    check_sorted(path.name, body, _order, "frame, then trackId")
    return TracksFile(header=header, detections=tuple(d for _, d in body))


def write_tracks(path: Path, header: TracksHeader, detections: Iterable[Detection]) -> None:
    """Writes tracks.jsonl sorted by frame, then trackId."""
    write_jsonl(path, header, sorted(detections, key=_order))
