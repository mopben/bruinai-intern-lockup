"""Person detection behind a small Protocol, so the model can be swapped (tests use fakes)."""

from dryrun_vision.detect.base import Detector, DetectorError, PersonBox
from dryrun_vision.detect.device import resolve_device
from dryrun_vision.detect.rfdetr_detector import (
    DEFAULT_MIN_SCORE,
    DEFAULT_SIZE,
    RFDETR_SIZES,
    RFDetrDetector,
    person_boxes,
)

__all__ = [
    "DEFAULT_MIN_SCORE",
    "DEFAULT_SIZE",
    "RFDETR_SIZES",
    "Detector",
    "DetectorError",
    "PersonBox",
    "RFDetrDetector",
    "person_boxes",
    "resolve_device",
]
