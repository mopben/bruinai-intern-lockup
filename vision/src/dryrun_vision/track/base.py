"""A box with a track id, and the interface every tracker meets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from dryrun_vision.detect.base import PersonBox


@dataclass(frozen=True)
class TrackedBox:
    track_id: int
    box: PersonBox


class Tracker(Protocol):
    """Gives the same id to the same person from frame to frame. Fed every processed frame in order."""

    @property
    def name(self) -> str:
        """Short tracker name with its settings, written to the tracks.jsonl header."""
        ...

    def update(self, boxes: tuple[PersonBox, ...]) -> tuple[TrackedBox, ...]:
        """The boxes of this frame that belong to a confirmed track, with its id (ids are >= 1)."""
        ...
