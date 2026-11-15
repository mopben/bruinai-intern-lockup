"""ByteTrack (Zhang et al. 2022) from Roboflow's `trackers` package (Apache-2.0).

supervision 0.31 no longer ships ByteTrack; it moved to `trackers`. Version 2.1.0 is pinned
in the ml extra because later versions pull in a second OpenCV build (opencv-python next to
opencv-python-headless). `trackers` numbers tracks with one counter shared by the whole
process; this wrapper renumbers them 1, 2, ... in order of first appearance per tracker.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from dryrun_vision.detect.base import DetectorError, PersonBox
from dryrun_vision.track.base import TrackedBox

LOST_SECONDS = 1.0
"""Seconds a lost track is kept for re-association (ByteTrack's default 30 frames at 30 fps).
Longer gaps are bridged later by fragment stitching, which can use floor positions."""
ACTIVATION_SCORE = 0.5
"""A box needs this score to start a new track (fewer tracks from a stray weak box)."""
HIGH_SCORE = 0.5
"""Boxes at or above this are matched first; weaker ones (down to the detector's own minimum) only
extend existing tracks: the ByteTrack idea that keeps a person through partial occlusion."""
MIN_IOU = 0.1
"""Smallest overlap between a predicted track box and a box to match them (trackers' default)."""
CONFIRM_FRAMES = 2
"""A track must be matched this many frames before it gets an id (one-frame flickers get none)."""
TRACKERS_FPS_BASE = 30.0
"""`trackers` states its lost-track buffer in frames at 30 fps and scales it by frame_rate / 30."""


def _bytetrack_class() -> Any:  # noqa: ANN401 - trackers is not typed
    try:
        from trackers import ByteTrackTracker as Impl  # noqa: PLC0415 - ml extra, imported only when used
    except ImportError as exc:
        raise DetectorError("The tracker needs `trackers` from the ml extra: uv sync --extra ml") from exc
    return Impl


def _detections(boxes: tuple[PersonBox, ...]) -> Any:  # noqa: ANN401
    import supervision as sv  # noqa: PLC0415 - ml extra, imported only when used

    xyxy = np.array([[b.x1, b.y1, b.x2, b.y2] for b in boxes], dtype=np.float64).reshape(-1, 4)
    scores = np.array([b.score for b in boxes], dtype=np.float64)
    return sv.Detections(xyxy=xyxy, confidence=scores, class_id=np.zeros(len(boxes), dtype=int))


class ByteTrackTracker:
    """Tracker Protocol over trackers.ByteTrackTracker. `fps` is the rate frames are fed at."""

    def __init__(self, fps: float, lost_seconds: float = LOST_SECONDS) -> None:
        if not fps > 0:
            raise ValueError(f"The frame rate must be more than 0, not {fps}.")
        impl = _bytetrack_class()
        self._impl = impl(
            lost_track_buffer=max(1, round(lost_seconds * TRACKERS_FPS_BASE)),
            frame_rate=fps,
            track_activation_threshold=ACTIVATION_SCORE,
            minimum_consecutive_frames=CONFIRM_FRAMES,
            minimum_iou_threshold=MIN_IOU,
            high_conf_det_threshold=HIGH_SCORE,
        )
        self._ids: dict[int, int] = {}
        self._name = f"bytetrack(trackers 2.1.0, lost {lost_seconds:g} s)"

    @property
    def name(self) -> str:
        return self._name

    def _local_id(self, raw: int) -> int:
        if raw not in self._ids:
            self._ids = {**self._ids, raw: len(self._ids) + 1}
        return self._ids[raw]

    def update(self, boxes: tuple[PersonBox, ...]) -> tuple[TrackedBox, ...]:
        out = self._impl.update(_detections(boxes))
        ids = np.asarray(out.tracker_id).reshape(-1)
        result: list[TrackedBox] = []
        for raw, (x1, y1, x2, y2), score in zip(
            ids.tolist(), out.xyxy.tolist(), out.confidence.tolist(), strict=True
        ):
            if int(raw) >= 0 and x2 > x1 and y2 > y1:
                result.append(
                    TrackedBox(self._local_id(int(raw)), PersonBox(x1, y1, x2, y2, min(1.0, score)))
                )
        return tuple(sorted(result, key=lambda t: t.track_id))
