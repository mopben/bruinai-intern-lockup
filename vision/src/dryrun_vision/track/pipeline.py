"""Video -> detector -> tracker -> tracks.jsonl lines, streaming one frame at a time."""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.detect.base import Detector, PersonBox
from dryrun_vision.formats import Detection, TracksHeader, VideoInfo
from dryrun_vision.track.base import Tracker
from dryrun_vision.video import Frame, probe_video, read_frames


@dataclass(frozen=True)
class TrackProgress:
    frames_done: int
    frames_total: int
    """Frames that will be processed (after stride and time limit), from the container's frame count."""
    seconds: float


@dataclass(frozen=True)
class TrackStats:
    frames_read: int
    seconds: float
    """Wall-clock seconds for decoding, detection and tracking together."""

    @property
    def fps(self) -> float:
        """Processed frames per wall-clock second."""
        return self.frames_read / self.seconds if self.seconds > 0 else math.inf


@dataclass(frozen=True)
class TrackRun:
    header: TracksHeader
    detections: tuple[Detection, ...]
    stats: TrackStats
    warnings: tuple[str, ...]


def _planned(info: VideoInfo, stride: int, max_seconds: float | None) -> int:
    last = info.frames if max_seconds is None else min(info.frames, math.ceil(max_seconds * info.fps))
    return math.ceil(last / stride)


def _clip(box: PersonBox, info: VideoInfo) -> tuple[float, float, float, float] | None:
    x1, y1 = max(0.0, box.x1), max(0.0, box.y1)
    x2, y2 = min(float(info.width), box.x2), min(float(info.height), box.y2)
    return (x1, y1, x2 - x1, y2 - y1) if x2 > x1 and y2 > y1 else None


def _frame_detections(frame: Frame, tracked: tuple, info: VideoInfo) -> list[Detection]:
    out: list[Detection] = []
    for tb in tracked:
        clipped = _clip(tb.box, info)
        if clipped is not None:
            x, y, w, h = clipped
            out.append(
                Detection(
                    frame=frame.index, t=frame.t, track_id=tb.track_id, x=x, y=y, w=w, h=h, score=tb.box.score
                )
            )
    return out


def track_video(
    path: Path,
    detector: Detector,
    tracker: Tracker,
    *,
    stride: int = 1,
    max_seconds: float | None = None,
    progress: Callable[[TrackProgress], None] | None = None,
) -> TrackRun:
    """Runs the detector and tracker on every `stride`-th frame. Raises VideoError for a bad video."""
    info = probe_video(path)
    total = _planned(info, stride, max_seconds)
    start = time.perf_counter()
    detections: list[Detection] = []
    done = 0
    last_index = -1
    for frame in read_frames(path, stride=stride, max_seconds=max_seconds):
        detections.extend(_frame_detections(frame, tracker.update(detector.detect(frame.image)), info))
        done += 1
        last_index = frame.index
        if progress is not None:
            progress(TrackProgress(done, total, time.perf_counter() - start))
    warnings = _short_read_notes(info, total, done, last_index)
    header = TracksHeader(
        video=info, detector=detector.name, tracker=tracker.name, stride=stride, frames_read=done
    )
    return TrackRun(header, tuple(detections), TrackStats(done, time.perf_counter() - start), warnings)


def _short_read_notes(info: VideoInfo, planned: int, done: int, last_index: int) -> tuple[str, ...]:
    if done >= planned:
        return ()
    return (
        f"{info.file}: the file says it has {info.frames} frames but decoding stopped after frame "
        f"{last_index} ({done} of {planned} planned frames processed). The rest of the video is missing.",
    )
