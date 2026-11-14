"""Where each worker is in the picture over time: the labeller's input from the identity stage.

`WorkerBoxes` is the contract: per worker, a time-sorted sequence of (video time, pixel box).
`worker_boxes_from_identity` builds it from the identity result (stitched tracks assigned to
workers), the same people positions.jsonl is made from. `worker_boxes_from_tracks` takes an explicit
trackId -> workerId map instead (the `label --track-worker` override).
Boxes stay in video time; the labeller converts run time to video time with its RunClock.
"""

from __future__ import annotations

import bisect
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from itertools import groupby, pairwise

from dryrun_vision.formats import Detection
from dryrun_vision.identity import IdentityResult
from dryrun_vision.labels.crop import Box


@dataclass(frozen=True)
class TimedBox:
    t: float
    """Seconds since the start of the video (the tracks.jsonl clock)."""
    box: Box


@dataclass(frozen=True)
class WorkerBoxes:
    """One worker's pixel box over time, sorted by `t` (strictly increasing)."""

    worker_id: str
    boxes: tuple[TimedBox, ...]

    def __post_init__(self) -> None:
        if any(b.t <= a.t for a, b in pairwise(self.boxes)):
            raise ValueError(f'boxes of worker "{self.worker_id}" must be sorted by time, one per time')

    def box_at(self, t: float, max_gap_s: float) -> Box | None:
        """The box seen closest to `t`, if it was seen within `max_gap_s`."""
        if not self.boxes:
            return None
        times = [b.t for b in self.boxes]
        i = bisect.bisect_left(times, t)
        near = [j for j in (i - 1, i) if 0 <= j < len(times)]
        best = min(near, key=lambda j: abs(times[j] - t))
        return self.boxes[best].box if abs(times[best] - t) <= max_gap_s else None


def _box(d: Detection) -> Box:
    return Box(d.x, d.y, d.w, d.h)


def worker_boxes_from_tracks(
    detections: Iterable[Detection], track_to_worker: Mapping[int, str]
) -> tuple[WorkerBoxes, ...]:
    """Groups detections by worker. Unmapped tracks are left out; at one frame the best score wins."""
    mapped = sorted(
        ((track_to_worker[d.track_id], d) for d in detections if d.track_id in track_to_worker),
        key=lambda wd: wd[0],
    )
    return tuple(
        _one_per_frame(worker_id, (d for _, d in group))
        for worker_id, group in groupby(mapped, key=lambda wd: wd[0])
    )


def _one_per_frame(worker_id: str, detections: Iterable[Detection]) -> WorkerBoxes:
    ordered = sorted(detections, key=lambda d: (d.frame, -d.score))
    best = [next(g) for _, g in groupby(ordered, key=lambda d: d.frame)]
    return WorkerBoxes(worker_id, tuple(TimedBox(d.t, _box(d)) for d in best))


def worker_boxes_from_identity(identity: IdentityResult) -> dict[str, WorkerBoxes]:
    """Each identified person's boxes, all their stitched fragments together, keyed by worker id.

    Tracks identity left out (customers, flickers) give no boxes. At one frame the best score wins.
    """
    return {p.name: _one_per_frame(p.name, p.detections) for p in identity.people}
