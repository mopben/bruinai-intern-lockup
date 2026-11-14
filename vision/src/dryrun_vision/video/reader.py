"""Frames from a video file with OpenCV: a streaming strided read (`read_frames`, for the tracker).

Skipped frames (stride) are grabbed without decoding. Times are index / fps: a
variable-frame-rate video (some phone recordings) gets evenly spaced times.
OpenCV is imported on first use so the package imports without the ml extra.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from dryrun_vision.errors import DryRunError
from dryrun_vision.formats import VideoInfo

ImageArray = npt.NDArray[np.uint8]


class VideoError(DryRunError):
    """The video could not be read, or the reading options make no sense."""


@dataclass(frozen=True, eq=False)
class Frame:
    index: int
    """0-based frame number in the video."""
    t: float
    """Seconds from the start of the video (index / fps)."""
    image: ImageArray
    """Height x width x 3, BGR (OpenCV order), read-only."""


def cv2_module() -> Any:  # noqa: ANN401 - OpenCV has no type stubs worth the name
    """OpenCV, imported on first use (the ml extra)."""
    try:
        import cv2  # noqa: PLC0415 - ml extra, imported only when used
    except ImportError as exc:
        raise VideoError(
            "Reading video needs OpenCV from the ml extra. Install it with: uv sync --extra ml"
        ) from exc
    return cv2


def open_capture(path: Path) -> Any:  # noqa: ANN401
    """An opened cv2.VideoCapture. Raises VideoError for a missing or unreadable file."""
    if not path.is_file():
        raise VideoError(f"{path} does not exist. Check the path of the video.")
    cv2 = cv2_module()
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        cap.release()
        raise VideoError(f"{path} could not be opened as a video (unknown format or a damaged file).")
    return cap


def capture_info(cap: Any, path: Path) -> VideoInfo:  # noqa: ANN401
    cv2 = cv2_module()
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames = max(0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    if not fps > 0 or width <= 0 or height <= 0:
        raise VideoError(f"{path} could not be opened as a video (no frame rate or picture size in it).")
    return VideoInfo(file=path.name, width=width, height=height, fps=fps, frames=frames)


def probe_video(path: Path) -> VideoInfo:
    """Size, frame rate and frame count (as the container states it) of a video file."""
    cap = open_capture(path)
    try:
        return capture_info(cap, path)
    finally:
        cap.release()


def _check_options(stride: int, max_seconds: float | None) -> None:
    if stride < 1:
        raise VideoError(f"The stride must be 1 or more (every Nth frame), not {stride}.")
    if max_seconds is not None and not max_seconds > 0:
        raise VideoError(f"The time limit must be more than 0 seconds, not {max_seconds}.")


def read_frames(path: Path, stride: int = 1, max_seconds: float | None = None) -> Iterator[Frame]:
    """Every `stride`-th frame from the start, up to `max_seconds` of video time (exclusive).

    Lazy: frames are decoded as the caller asks for them. Raises VideoError for a file that is
    not a readable video. A file that stops decoding part-way simply ends there.
    """
    _check_options(stride, max_seconds)
    cap = open_capture(path)
    try:
        fps = capture_info(cap, path).fps
        index = 0
        while max_seconds is None or index / fps < max_seconds:
            if not cap.grab():
                return
            if index % stride == 0:
                ok, image = cap.retrieve()
                if not ok or image is None:
                    return
                image.setflags(write=False)
                yield Frame(index=index, t=index / fps, image=image)
            index += 1
    finally:
        cap.release()
