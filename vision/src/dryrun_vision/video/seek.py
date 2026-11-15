"""Frames at chosen times (the labeller): decode forward, seek over long gaps, never load the video.

The tracker reads every frame in order with `read_frames` (reader.py); the labeller wants a few
frames at sorted times, so it seeks. Both open and probe the file the same way. Frames here are RGB
(what the label models expect); `read_frames` gives BGR (what the detector and the render expect).
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from itertools import pairwise
from pathlib import Path
from types import TracebackType
from typing import Self

import numpy as np

from dryrun_vision.formats import VideoInfo
from dryrun_vision.video.reader import capture_info, cv2_module, open_capture

SEEK_MIN_FRAMES = 30
"""Seek instead of decoding forward when the next wanted frame is this many frames ahead or more."""
FRAME_EPS = 1e-6
"""Float slack when turning a time into a frame index (t = k / fps must give frame k)."""


class VideoFrames:
    """An open video. Use as a context manager; frames come out as RGB uint8 arrays."""

    def __init__(self, path: Path, seek_min_frames: int = SEEK_MIN_FRAMES) -> None:
        self._cv2 = cv2_module()
        self._cap = open_capture(path)
        try:
            self.meta: VideoInfo = capture_info(self._cap, path)
        except BaseException:
            self._cap.release()
            raise
        self._seek_min = seek_min_frames
        self._next = 0  # index of the frame the next grab() returns

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        self._cap.release()

    def frame_of(self, t: float) -> int:
        """The frame on screen at video time `t` (frame k covers [k/fps, (k+1)/fps))."""
        return max(0, int(t * self.meta.fps + FRAME_EPS))

    def _advance_to(self, target: int) -> bool:
        if target - self._next >= self._seek_min:
            self._cap.set(self._cv2.CAP_PROP_POS_FRAMES, target)
            self._next = target
        while self._next < target:
            if not self._cap.grab():
                return False
            self._next += 1
        return True

    def _read(self) -> np.ndarray | None:
        ok, bgr = self._cap.read()
        if not ok:
            return None
        self._next += 1
        return self._cv2.cvtColor(bgr, self._cv2.COLOR_BGR2RGB)

    def frames_at(self, times: Sequence[float]) -> Iterator[tuple[int, np.ndarray]]:
        """(index into `times`, frame) for each video time, in order. Times past the end are left out."""
        if any(b < a for a, b in pairwise(times)):
            raise ValueError("frame times must be sorted from earliest to latest")
        current: tuple[int, np.ndarray] | None = None
        for i, t in enumerate(times):
            target = self.frame_of(t)
            if current is None or current[0] != target:
                if not self._advance_to(target):
                    return
                frame = self._read()
                if frame is None:
                    return
                current = (target, frame)
            yield i, current[1]


def count_frames(path: Path) -> int:
    """Decoded frame count (container headers are often off by a frame or two)."""
    cap = open_capture(path)
    try:
        n = 0
        while cap.grab():
            n += 1
        return n
    finally:
        cap.release()
