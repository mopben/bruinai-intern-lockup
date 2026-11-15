"""The real RF-DETR + ByteTrack on real frames. Opt-in (see ml_paths.py)."""

from pathlib import Path

import pytest
from ml_paths import DATA, ML, WEIGHTS

from dryrun_vision.detect import RFDetrDetector, resolve_device
from dryrun_vision.mot import evaluate_tracking, read_mot_gt
from dryrun_vision.track import ByteTrackTracker, track_video

pytestmark = ML

PETS = DATA / "mot15-3d" / "PETS09-S2L1"
CAFE = DATA / "stock-cafe" / "mixkit-coffee-bar-waiter-813-720.mp4"


def _need(path: Path) -> Path:
    if not path.exists():
        pytest.skip(f"{path} is missing (vision/scripts/fetch_data.sh)")
    return path


def test_pets_first_seconds_find_most_people():
    video = _need(PETS / "PETS09-S2L1.mp4")
    det = RFDetrDetector("medium", resolve_device("auto"), weights_dir=WEIGHTS)
    run = track_video(video, det, ByteTrackTracker(7.0), max_seconds=5.0)
    m, _ = evaluate_tracking(read_mot_gt(_need(PETS / "gt" / "gt.txt")), run.detections, range(35))
    assert m.recall > 0.8 and m.precision > 0.8


def test_cafe_clip_finds_the_barista():
    run = track_video(
        _need(CAFE),
        RFDetrDetector("medium", resolve_device("auto"), weights_dir=WEIGHTS),
        ByteTrackTracker(24.0),
        max_seconds=2.0,
    )
    frames_with_someone = {d.frame for d in run.detections}
    assert len(frames_with_someone) >= 40
