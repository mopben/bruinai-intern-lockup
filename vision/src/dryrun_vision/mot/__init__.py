"""Tracking evaluation against MOTChallenge-style ground truth, and the Tsai camera of 3D MOT 2015."""

from dryrun_vision.mot.gt import GtBox, read_mot_gt
from dryrun_vision.mot.metrics import IOU_THRESHOLD, Match, TrackingMetrics, evaluate_tracking, iou

__all__ = ["IOU_THRESHOLD", "GtBox", "Match", "TrackingMetrics", "evaluate_tracking", "iou", "read_mot_gt"]
