from pathlib import Path

import numpy as np
import pytest

from dryrun_vision.video import VideoError, VideoFrames, count_frames, probe_video
from labelling.helpers import frame_index


def test_meta(make_video):
    with VideoFrames(make_video(frames=30, size=(64, 48), fps=10)) as v:
        assert (v.meta.width, v.meta.height, v.meta.fps) == (64, 48, 10)


def test_frames_at_picks_the_frame_shown_at_each_time(make_video):
    with VideoFrames(make_video(frames=40)) as v:
        got = list(v.frames_at([0.0, 0.26, 0.26, 1.04, 3.9]))
    assert [i for i, _ in got] == [0, 1, 2, 3, 4]
    assert [frame_index(f) for _, f in got] == [0, 2, 2, 10, 39]  # frame k covers [k/10, (k+1)/10)


def test_frames_are_rgb(make_video):
    with VideoFrames(make_video(frames=5)) as v:
        _, f = next(v.frames_at([0.0]))
    assert f.shape == (48, 64, 3) and f.dtype == np.uint8
    r, g, b = f[2, 2]
    assert r > 200 and g < 60 and b < 60


def test_frames_at_seeks_over_long_gaps(make_video):
    with VideoFrames(make_video(frames=50, fps=10), seek_min_frames=5) as v:
        got = [frame_index(f) for _, f in v.frames_at([0.0, 0.3, 2.0, 4.55])]
    assert got == [0, 3, 20, 45]


def test_frames_past_the_end_are_left_out(make_video):
    with VideoFrames(make_video(frames=10)) as v:
        got = list(v.frames_at([0.5, 2.0, 5.0]))
    assert [i for i, _ in got] == [0]


def test_times_must_be_sorted(make_video):
    with VideoFrames(make_video(frames=10)) as v, pytest.raises(ValueError, match="sorted"):
        list(v.frames_at([0.5, 0.2]))


def test_missing_video_is_a_plain_error(tmp_path: Path):
    with pytest.raises(VideoError, match="does not exist"):
        VideoFrames(tmp_path / "nope.avi")
    with pytest.raises(VideoError, match="does not exist"):
        count_frames(tmp_path / "nope.avi")


def test_not_a_video_is_a_plain_error(tmp_path: Path):
    bad = tmp_path / "bad.avi"
    bad.write_text("hello")
    with pytest.raises(VideoError, match="could not be opened as a video"):
        VideoFrames(bad)


def test_meta_is_the_same_as_probe(make_video):
    path = make_video(frames=12, fps=10)
    with VideoFrames(path) as v:
        assert v.meta == probe_video(path)


def test_count_frames_decodes(make_video):
    assert count_frames(make_video(frames=23)) == 23
