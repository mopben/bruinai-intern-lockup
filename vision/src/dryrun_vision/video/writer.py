"""Writing .mp4 files with OpenCV (render, stabilise)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from dryrun_vision.video.reader import VideoError, cv2_module

CODECS = ("avc1", "mp4v")
"""H.264 first (plays everywhere); OpenCV builds without it fall back to MPEG-4 Part 2."""


def open_writer(out: Path, fps: float, size: tuple[int, int]) -> tuple[Any, str]:
    """An opened cv2.VideoWriter for `out` at (width, height) `size`, and the codec it uses."""
    cv2 = cv2_module()
    for codec in CODECS:
        w = cv2.VideoWriter(str(out), cv2.VideoWriter.fourcc(*codec), fps, size)
        if w.isOpened():
            return w, codec
        w.release()
    raise VideoError(f"Could not write {out}: OpenCV has no usable mp4 encoder ({', '.join(CODECS)}).")
