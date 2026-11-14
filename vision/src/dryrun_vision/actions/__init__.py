"""Zone-based action segmentation: positions + kitchen -> actions.jsonl segments."""

from dryrun_vision.actions.constants import (
    HOME_SEARCH_M,
    MAX_GAP_S,
    MIN_SEGMENT_S,
    REST_SPEED_MPS,
    TRIP_EXCURSION_M,
    TRIP_HOME_M,
    TRIP_MATCH_M,
    WORK_STAND_M,
)
from dryrun_vision.actions.motion import rest_flags, resting_home, smooth_positions
from dryrun_vision.actions.segment import SegmentationResult, segment_actions
from dryrun_vision.actions.trips import Trip, detect_trips

__all__ = [
    "HOME_SEARCH_M",
    "MAX_GAP_S",
    "MIN_SEGMENT_S",
    "REST_SPEED_MPS",
    "TRIP_EXCURSION_M",
    "TRIP_HOME_M",
    "TRIP_MATCH_M",
    "WORK_STAND_M",
    "SegmentationResult",
    "Trip",
    "detect_trips",
    "rest_flags",
    "resting_home",
    "segment_actions",
    "smooth_positions",
]
