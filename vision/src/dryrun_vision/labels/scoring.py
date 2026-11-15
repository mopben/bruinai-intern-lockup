"""Scoring windows with a provider while streaming through the video once, in time order.

Every window asks for a few frames. All requests are sorted by time and served by one forward
pass over the video; a window is scored as soon as its last frame arrives, so only the crops
of windows in progress are held in memory. Finished windows go to the provider through a
Dispatcher (dispatch.py): inline, or on a few threads for a network provider.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np

from dryrun_vision.clock import RunClock
from dryrun_vision.formats import VideoInfo
from dryrun_vision.labels.constants import (
    BOX_MAX_GAP_S,
    CENTRE_CROP_FRACTION,
    FRAMES_PER_WINDOW,
    MAX_CROP_SIDE_PX,
)
from dryrun_vision.labels.crop import (
    Box,
    CropMargins,
    centre_box,
    clamp_box,
    crop_frame,
    downscale,
    expand_box,
)
from dryrun_vision.labels.dispatch import Dispatcher, WindowScore
from dryrun_vision.labels.providers.base import LabelProvider
from dryrun_vision.labels.vocab import Candidate
from dryrun_vision.labels.windows import Window, sample_times
from dryrun_vision.labels.worker_boxes import WorkerBoxes

CropMode = Literal["tracks", "whole", "centre"]
CROP_MODES: tuple[CropMode, ...] = ("tracks", "whole", "centre")


class FrameSource(Protocol):
    @property
    def meta(self) -> VideoInfo: ...

    def frames_at(self, times: Sequence[float]) -> Iterator[tuple[int, np.ndarray]]: ...


@dataclass(frozen=True)
class FrameSettings:
    frames_per_window: int = FRAMES_PER_WINDOW
    crop_mode: CropMode = "tracks"
    """tracks: the worker's box from tracks; whole: the whole frame; centre: a centred crop."""
    margins: CropMargins = field(default_factory=CropMargins)
    centre_fraction: float = CENTRE_CROP_FRACTION
    box_max_gap_s: float = BOX_MAX_GAP_S
    max_crop_side: int = MAX_CROP_SIDE_PX
    clock: RunClock = field(default_factory=RunClock)
    """Windows are in run time, frames and worker boxes in video time; this converts."""


@dataclass(frozen=True)
class WindowJob:
    worker_id: str
    window: Window
    """Run time."""
    candidates: tuple[Candidate, ...]


@dataclass(frozen=True)
class _Request:
    t_video: float
    job: int


def _requests(jobs: Sequence[WindowJob], settings: FrameSettings) -> tuple[_Request, ...]:
    out = [
        _Request(settings.clock.video_time(t), j)
        for j, job in enumerate(jobs)
        for t in sample_times(job.window, settings.frames_per_window)
        if settings.clock.video_time(t) >= 0
    ]
    return tuple(sorted(out, key=lambda r: (r.t_video, r.job)))


def _crop_box(
    req: _Request, job: WindowJob, meta: VideoInfo, boxes: Mapping[str, WorkerBoxes], s: FrameSettings
) -> Box | None:
    if s.crop_mode == "whole":
        return Box(0, 0, meta.width, meta.height)
    if s.crop_mode == "centre":
        return centre_box(meta.width, meta.height, s.centre_fraction)
    worker = boxes.get(job.worker_id)
    box = worker.box_at(req.t_video, s.box_max_gap_s) if worker else None
    return clamp_box(expand_box(box, s.margins), meta.width, meta.height) if box else None


def score_windows(
    jobs: Sequence[WindowJob],
    video: FrameSource,
    provider: LabelProvider,
    boxes: Mapping[str, WorkerBoxes],
    settings: FrameSettings,
) -> tuple[WindowScore, ...]:
    """One score per job, in job order. Frames past the end of the video or without a box are skipped."""
    requests = _requests(jobs, settings)
    remaining = {j: 0 for j in range(len(jobs))}
    for r in requests:
        remaining[r.job] += 1
    crops: dict[int, list[np.ndarray]] = {j: [] for j in range(len(jobs))}
    with Dispatcher(provider) as dispatch:
        for i, frame in video.frames_at([r.t_video for r in requests]):
            req = requests[i]
            box = _crop_box(req, jobs[req.job], video.meta, boxes, settings)
            if box is not None:
                crops[req.job].append(downscale(crop_frame(frame, box), settings.max_crop_side))
            remaining[req.job] -= 1
            if remaining[req.job] == 0:
                dispatch.submit(req.job, crops.pop(req.job), jobs[req.job].candidates)
        for j in list(crops):  # windows whose last frames were past the end of the video
            dispatch.submit(j, crops.pop(j), jobs[j].candidates)
        done = dispatch.results()
    return tuple(done[j] for j in range(len(jobs)))
