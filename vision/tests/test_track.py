from pathlib import Path

import pytest

pytest.importorskip("cv2")

from dryrun_vision.detect import PersonBox
from dryrun_vision.formats import read_tracks, write_tracks
from dryrun_vision.track import TrackedBox, TrackProgress, track_video
from dryrun_vision.video import VideoError
from fakes import EnumeratingTracker, LevelDetector
from videos import HEIGHT, WIDTH, write_video


@pytest.fixture
def video(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4", frames=12, fps=6.0)


def test_track_video_writes_valid_tracks(video: Path, tmp_path: Path):
    run = track_video(video, LevelDetector(), EnumeratingTracker())
    assert run.header.video.fps == 6.0 and run.header.video.frames == 12
    assert (run.header.detector, run.header.tracker) == ("fake-detector", "fake-tracker")
    first = [d for d in run.detections if d.frame == 0]
    assert [d.track_id for d in first] == [10, 11]
    d = next(d for d in run.detections if d.frame == 5 and d.track_id == 10)
    assert (d.x, d.y, d.w, d.h, d.score) == (7.0, 4.0, 10.0, 36.0, 0.9)
    assert d.t == pytest.approx(5 / 6)
    out = tmp_path / "tracks.jsonl"
    write_tracks(out, run.header, run.detections)
    assert len(read_tracks(out).detections) == len(run.detections) == 24


def test_boxes_are_clipped_to_the_picture(video: Path):
    run = track_video(video, LevelDetector(), EnumeratingTracker())
    d = next(d for d in run.detections if d.track_id == 11)
    assert (d.x, d.y) == (0.0, 30.0)
    assert d.w == 6.0 and d.y + d.h == HEIGHT
    assert all(e.x + e.w <= WIDTH for e in run.detections)


def test_stride_and_time_limit(video: Path):
    run = track_video(video, LevelDetector(), EnumeratingTracker(), stride=4, max_seconds=1.5)
    assert sorted({d.frame for d in run.detections}) == [0, 4, 8]
    assert run.stats.frames_read == 3


def test_progress_is_reported(video: Path):
    seen: list[TrackProgress] = []
    run = track_video(video, LevelDetector(), EnumeratingTracker(), progress=seen.append)
    assert [p.frames_done for p in seen] == list(range(1, 13))
    assert seen[-1].frames_total == 12
    assert run.stats.frames_read == 12 and run.stats.seconds >= 0
    assert run.stats.fps > 0


def test_unreadable_video(tmp_path: Path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00" * 100)
    with pytest.raises(VideoError):
        track_video(bad, LevelDetector(), EnumeratingTracker())


def test_box_that_falls_outside_is_dropped(video: Path):
    class _Outside:
        name = "t"

        def update(self, boxes: tuple[PersonBox, ...]) -> tuple[TrackedBox, ...]:
            return (TrackedBox(1, PersonBox(WIDTH + 1.0, 0.0, WIDTH + 9.0, 5.0, 0.5)),)

    run = track_video(video, LevelDetector(), _Outside())
    assert run.detections == ()
