"""`dryrun-vision stabilise` on generated shaky clips: output, report, masking and plain errors."""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("cv2")

from dryrun_vision.cli import main
from dryrun_vision.formats import Detection, TracksHeader, VideoInfo, read_stabilisation, write_tracks
from dryrun_vision.video import probe_video
from shaky import HEIGHT, WIDTH, write_shaky_video


def _tracks(path: Path, width: int, frames: int) -> Path:
    info = VideoInfo(file="shaky.mp4", width=width, height=HEIGHT, fps=10.0, frames=frames)
    dets = [
        Detection(frame=k, t=k / 10, track_id=1, x=10, y=10, w=50, h=100, score=0.9) for k in range(frames)
    ]
    write_tracks(path, TracksHeader(video=info, detector="test", tracker="test"), dets)
    return path


def test_stabilise_command(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=6)
    out, report = tmp_path / "stable.mp4", tmp_path / "stable.json"
    tracks = _tracks(tmp_path / "tracks.jsonl", WIDTH, 6)
    argv = ["stabilise", str(video), "--out", str(out), "--report", str(report), "--tracks", str(tracks)]
    assert main(argv) == 0
    text = capsys.readouterr().out
    assert "Registered 6 of 6 frames to frame 0" in text and "inliers" in text and "residual" in text
    assert probe_video(out).frames == 6
    assert read_stabilisation(report).masked_people


def test_tracks_of_another_video_are_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=3)
    tracks = _tracks(tmp_path / "tracks.jsonl", WIDTH * 2, 3)
    argv = ["stabilise", str(video), "--out", str(tmp_path / "s.mp4"), "--tracks", str(tracks)]
    assert main(argv) == 1
    err = capsys.readouterr().err
    assert "640x240" in err and "320x240" in err and "Traceback" not in err


def test_poor_registration_fails_in_plain_words(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=6, blank=frozenset({1, 2, 3}))
    assert main(["stabilise", str(video), "--out", str(tmp_path / "s.mp4")]) == 1
    err = capsys.readouterr().err
    assert "3 of 6 frames" in err and "Traceback" not in err


def test_missing_video_is_a_plain_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["stabilise", str(tmp_path / "nope.mp4"), "--out", str(tmp_path / "s.mp4")]) == 1
    assert "does not exist" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--reference-frame", "-1"], "must be 0 or more"),
        (["--reference-frame", "two"], "not a whole number"),
        (["--out", "/no/such/folder/s.mp4"], "does not exist"),
        (["--report", "/no/such/folder/r.json"], "does not exist"),
    ],
)
def test_argument_checks(tmp_path: Path, capsys: pytest.CaptureFixture[str], argv: list[str], message: str):
    base = ["stabilise", str(tmp_path / "v.mp4"), "--out", str(tmp_path / "s.mp4")]
    with pytest.raises(SystemExit):
        main([*base, *argv])
    assert message in capsys.readouterr().err


def test_same_file_in_and_out_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=3)
    assert main(["stabilise", str(video), "--out", str(video)]) == 1
    assert "would overwrite" in capsys.readouterr().err
