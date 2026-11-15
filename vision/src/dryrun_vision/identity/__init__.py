"""Raw tracks -> people: project to the floor, stitch fragments, assign to workers, drop customers."""

from dryrun_vision.identity.anchor import (
    ANCHORS,
    Anchor,
    anchor_point,
    floor_point,
    nominal_head_height,
    worker_head_height,
)
from dryrun_vision.identity.fragments import Fragment, Person, build_fragments
from dryrun_vision.identity.identify import DroppedTrack, IdentityResult, identify
from dryrun_vision.identity.stitch import link_cost, stitch
from dryrun_vision.identity.workers import WorkerSpot, worker_spots

__all__ = [
    "ANCHORS",
    "Anchor",
    "DroppedTrack",
    "Fragment",
    "IdentityResult",
    "Person",
    "WorkerSpot",
    "anchor_point",
    "build_fragments",
    "floor_point",
    "identify",
    "link_cost",
    "nominal_head_height",
    "stitch",
    "worker_head_height",
    "worker_spots",
]
