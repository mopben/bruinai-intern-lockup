from pathlib import Path

import pytest

pytest.importorskip("cv2")

from dryrun_vision.errors import DryRunError
from dryrun_vision.video import VideoError, probe_video, read_frames
from videos import HEIGHT, WIDTH, level_of, write_video


@pytest.fixture
def video(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4", frames=20, fps=10.0)


def test_probe_reads_size_fps_and_frames(video: Path):
    info = probe_video(video)
    assert (info.width, info.height, info.fps, info.frames) == (WIDTH, HEIGHT, 10.0, 20)
    assert info.file == "clip.mp4"


def test_reads_every_frame_in_order(video: Path):
    frames = list(read_frames(video))
    assert [f.index for f in frames] == list(range(20))
    assert [level_of(f.image) for f in frames] == list(range(20))
    assert frames[3].t == pytest.approx(0.3)
    assert frames[0].image.shape == (HEIGHT, WIDTH, 3)


def test_frames_are_read_only(video: Path):
    frame = next(iter(read_frames(video)))
    with pytest.raises(ValueError):
        frame.image[0, 0, 0] = 1


def test_stride_skips_frames(video: Path):
    frames = list(read_frames(video, stride=3))
    assert [f.index for f in frames] == [0, 3, 6, 9, 12, 15, 18]
    assert [level_of(f.image) for f in frames] == [0, 3, 6, 9, 12, 15, 18]


def test_max_seconds_stops_early(video: Path):
    frames = list(read_frames(video, max_seconds=0.5))
    assert [f.index for f in frames] == [0, 1, 2, 3, 4]


def test_reading_is_lazy(video: Path):
    it = read_frames(video)
    assert next(it).index == 0
    it.close()


def test_missing_file_is_a_plain_error(tmp_path: Path):
    with pytest.raises(VideoError, match="does not exist"):
        probe_video(tmp_path / "nope.mp4")


def test_not_a_video_is_a_plain_error(tmp_path: Path):
    bad = tmp_path / "bad.mp4"
    bad.write_text("hello")
    with pytest.raises(VideoError, match="could not be opened as a video"):
        probe_video(bad)
    with pytest.raises(DryRunError):
        list(read_frames(bad))


@pytest.mark.parametrize(("stride", "max_s"), [(0, None), (1, 0.0), (1, -1.0)])
def test_bad_arguments(video: Path, stride: int, max_s: float | None):
    with pytest.raises(VideoError):
        list(read_frames(video, stride=stride, max_seconds=max_s))
