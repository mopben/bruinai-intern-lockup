"""Run time and video time: the one place where they are converted.

Every product file (positions.jsonl, actions.jsonl, taps.jsonl) counts seconds since the run
started. tracks.jsonl and the video count seconds since the video's first frame. The video usually
starts a little before the run, so

    run time = video time - start_offset_s

Positions, the labeller and the render all take a RunClock, so the command line has one flag for
it (`--start-offset`) and the stages cannot disagree.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class RunClock:
    start_offset_s: float = 0.0
    """Seconds of video before the run started (0 or more)."""

    def __post_init__(self) -> None:
        if not math.isfinite(self.start_offset_s) or self.start_offset_s < 0:
            raise ValueError(
                "The start offset must be 0 or more seconds of video before the run, "
                f"not {self.start_offset_s}."
            )

    def run_time(self, video_t: float) -> float:
        """Seconds since the run started, for a time in the video."""
        return video_t - self.start_offset_s

    def video_time(self, run_t: float) -> float:
        """Seconds since the video's first frame, for a time in the run."""
        return run_t + self.start_offset_s


NO_OFFSET = RunClock()
"""The run started with the video's first frame."""
