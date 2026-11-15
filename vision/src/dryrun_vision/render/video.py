"""Write the labelled video: read a frame, draw its labels, write it. Streams; nothing held in memory."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.formats import Detection
from dryrun_vision.render.draw import BoxLabel, draw_labels
from dryrun_vision.video import VideoError, probe_video, read_frames
from dryrun_vision.video.reader import cv2_module

CODECS = ("avc1", "mp4v")
"""H.264 first (plays everywhere); OpenCV builds without it fall back to MPEG-4 Part 2."""

LabelsFor = Callable[[int, float, Sequence[Detection]], tuple[BoxLabel, ...]]
"""(frame index, video time, that frame's detections) -> what to draw."""


@dataclass(frozen=True)
class RenderStats:
    frames: int
    codec: str


def _writer(out: Path, fps: float, size: tuple[int, int]) -> tuple[object, str]:
    cv2 = cv2_module()
    for codec in CODECS:
        w = cv2.VideoWriter(str(out), cv2.VideoWriter.fourcc(*codec), fps, size)
        if w.isOpened():
            return w, codec
        w.release()
    raise VideoError(f"Could not write {out}: OpenCV has no usable mp4 encoder ({', '.join(CODECS)}).")


def render_video(
    video: Path,
    detections: Sequence[Detection],
    out: Path,
    labels_for: LabelsFor,
    *,
    max_seconds: float | None = None,
    header_for: Callable[[float], str] = lambda t: f"t = {t:.2f} s",
) -> RenderStats:
    """Every frame of `video` (up to max_seconds) with its labels drawn, written to `out` (.mp4)."""
    info = probe_video(video)
    by_frame: dict[int, list[Detection]] = defaultdict(list)
    for d in detections:
        by_frame[d.frame].append(d)
    cv2 = cv2_module()
    writer, codec = _writer(out, info.fps, (info.width, info.height))
    n = 0
    try:
        for frame in read_frames(video, max_seconds=max_seconds):
            labels = labels_for(frame.index, frame.t, by_frame.get(frame.index, []))
            writer.write(draw_labels(frame.image, labels, cv2, header_for(frame.t)))  # type: ignore[attr-defined]
            n += 1
    finally:
        writer.release()  # type: ignore[attr-defined]
    return RenderStats(n, codec)
