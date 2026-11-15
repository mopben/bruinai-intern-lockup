"""Camera-motion compensation for a handheld video filmed from one spot (needs the ml extra).

Every frame is registered to one reference frame by a homography from static background features
and warped onto it, so one calibration (made on the reference frame) fits the whole video.
"""

from dryrun_vision.formats import CropRect, StabilisationRegion, read_region
from dryrun_vision.stabilise.errors import StabiliseError
from dryrun_vision.stabilise.pipeline import StabiliseResult, stabilise_video
from dryrun_vision.stabilise.quality import (
    MAX_POOR_SHARE,
    MAX_RMS_PX,
    MAX_SHIFT_SHARE,
    MIN_INLIERS,
    corner_shift_px,
    problem_of,
)
from dryrun_vision.stabilise.region import region_mask
from dryrun_vision.stabilise.register import (
    Features,
    PersonBox,
    Registration,
    find_features,
    person_mask,
    register,
)
from dryrun_vision.stabilise.viewer import VIEWER_MIN_COVERAGE, viewer_crop

__all__ = [
    "MAX_POOR_SHARE",
    "MAX_RMS_PX",
    "MAX_SHIFT_SHARE",
    "MIN_INLIERS",
    "VIEWER_MIN_COVERAGE",
    "CropRect",
    "Features",
    "PersonBox",
    "Registration",
    "StabilisationRegion",
    "StabiliseError",
    "StabiliseResult",
    "corner_shift_px",
    "find_features",
    "person_mask",
    "problem_of",
    "read_region",
    "region_mask",
    "register",
    "stabilise_video",
    "viewer_crop",
]
