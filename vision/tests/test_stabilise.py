"""Camera-motion compensation: register every frame to a reference frame and warp it there."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("cv2")

import cv2

from dryrun_vision.formats import read_stabilisation
from dryrun_vision.stabilise import (
    MAX_POOR_SHARE,
    MAX_RMS_PX,
    MIN_INLIERS,
    PersonBox,
    Registration,
    StabiliseError,
    corner_shift_px,
    find_features,
    person_mask,
    problem_of,
    register,
    stabilise_video,
)
from dryrun_vision.video import VideoError, read_frames
from dryrun_vision.video import writer as video_writer
from shaky import HEIGHT, WIDTH, frame, grid_error_px, scene, shake, write_shaky_video

IN_MEMORY_TOLERANCE_PX = 0.75
"""Recovered vs true homography, largest grid-point disagreement, frames never compressed."""
VIDEO_TOLERANCE_PX = 1.0
"""The same through an mp4v round trip (compression noise moves features a little)."""


def gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


@pytest.fixture(scope="module")
def big() -> np.ndarray:
    return scene()


@pytest.mark.parametrize("k", [1, 3, 5, 8, 13])
def test_register_recovers_the_known_shake(big: np.ndarray, k: int):
    ref = find_features(gray(frame(big, shake(0))))
    moved = find_features(gray(frame(big, shake(k))))
    reg = register(moved, ref)
    assert reg.homography is not None
    assert reg.inliers >= MIN_INLIERS
    assert reg.rms_px is not None and reg.rms_px < 0.5
    assert grid_error_px(reg.homography, shake(k)) < IN_MEMORY_TOLERANCE_PX
    assert problem_of(reg, WIDTH, HEIGHT) is None


def test_registration_arrays_are_read_only(big: np.ndarray):
    ref = find_features(gray(frame(big, shake(0))))
    reg = register(find_features(gray(frame(big, shake(2)))), ref)
    assert reg.homography is not None
    with pytest.raises(ValueError):
        reg.homography[0, 0] = 2.0
    with pytest.raises(ValueError):
        ref.points[0, 0] = 1.0


def test_flat_frame_has_no_registration(big: np.ndarray):
    ref = find_features(gray(frame(big, shake(0))))
    flat = find_features(np.full((HEIGHT, WIDTH), 128, np.uint8))
    reg = register(flat, ref)
    assert reg.homography is None and reg.inliers == 0 and reg.rms_px is None
    assert "no homography" in (problem_of(reg, WIDTH, HEIGHT) or "")


def test_person_mask_blanks_boxes_with_a_margin_and_clips():
    mask = person_mask((100, 200), [PersonBox(50, 20, 20, 40), PersonBox(-30, 80, 50, 60)], margin=0.1)
    assert mask.dtype == np.uint8 and mask.shape == (100, 200)
    assert mask[40, 60] == 0  # inside the first box
    assert mask[18, 48] == 0  # inside the 10 % margin (2 px each side here, 4 px top/bottom)
    assert mask[10, 60] == 255  # well above it
    assert mask[99, 0] == 0  # the second box, clipped at the image edge
    assert mask[5, 190] == 255


def test_masked_regions_give_no_features(big: np.ndarray):
    img = gray(frame(big, shake(0)))
    box = PersonBox(100, 60, 120, 120)
    feats = find_features(img, person_mask(img.shape, [box], margin=0.0))
    assert len(feats.points) > 0
    inside = (
        (feats.points[:, 0] >= box.x)
        & (feats.points[:, 0] < box.x + box.w)
        & (feats.points[:, 1] >= box.y)
        & (feats.points[:, 1] < box.y + box.h)
    )
    assert not inside.any()


@pytest.mark.parametrize(
    ("reg", "words"),
    [
        (Registration(np.eye(3), matches=30, inliers=MIN_INLIERS - 1, rms_px=0.5), "inliers"),
        (Registration(np.eye(3), matches=300, inliers=200, rms_px=MAX_RMS_PX + 0.1), "residual"),
        (Registration(np.diag([3.0, 3.0, 1.0]), matches=300, inliers=200, rms_px=0.5), "implausible"),
    ],
)
def test_problem_of_names_the_reason(reg: Registration, words: str):
    problem = problem_of(reg, WIDTH, HEIGHT)
    assert problem is not None and words in problem


def test_corner_shift_of_a_translation():
    h = np.array([[1, 0, 3.0], [0, 1, 4.0], [0, 0, 1]])
    assert corner_shift_px(h, WIDTH, HEIGHT) == pytest.approx(5.0)
    assert corner_shift_px(np.eye(3), WIDTH, HEIGHT) == pytest.approx(0.0)


def test_stabilise_video_end_to_end(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=14)
    out, report_path = tmp_path / "stable.mp4", tmp_path / "stable.json"
    result = stabilise_video(video, out, report=report_path)
    assert result.warnings == ()
    report = read_stabilisation(report_path)
    assert report == result.report
    assert report.reference_frame == 0 and len(report.frames) == 14
    assert report.video.width == WIDTH and report.video.frames == 14
    for f in report.frames:
        h = np.array(f.homography).reshape(3, 3)
        assert f.ok and f.used_frame == f.frame
        assert grid_error_px(h, shake(f.frame)) < VIDEO_TOLERANCE_PX, f.frame
    assert report.summary.frames_poor == 0
    assert report.summary.shift_max_px > 5.0
    assert report.summary.rms_median_px is not None and report.summary.rms_median_px < 1.0

    stable = [f.image for f in read_frames(out)]
    shaky = [f.image for f in read_frames(video)]
    assert len(stable) == 14 and stable[0].shape == (HEIGHT, WIDTH, 3)
    inner = (slice(40, HEIGHT - 40), slice(40, WIDTH - 40))  # never outside the shaken frame
    before = np.mean([np.abs(s[inner].astype(int) - shaky[0][inner]).mean() for s in shaky[1:]])
    after = np.mean([np.abs(s[inner].astype(int) - stable[0][inner]).mean() for s in stable[1:]])
    assert after < before / 3


def test_reference_frame_other_than_zero(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=8)
    result = stabilise_video(video, tmp_path / "s.mp4", reference_frame=4)
    ref_from_frame = {f.frame: np.array(f.homography).reshape(3, 3) for f in result.report.frames}
    np.testing.assert_allclose(ref_from_frame[4], np.eye(3), atol=1e-9)
    truth = np.linalg.inv(shake(4)) @ shake(2)  # frame 2 -> scene -> frame 4
    assert grid_error_px(ref_from_frame[2], truth) < VIDEO_TOLERANCE_PX


def test_masking_with_person_boxes(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=6)
    boxes = {k: (PersonBox(10, 10, 60, 120),) for k in range(6)}
    result = stabilise_video(video, tmp_path / "s.mp4", boxes=boxes)
    assert result.report.masked_people
    assert all(f.ok for f in result.report.frames)


def test_a_few_poor_frames_warn_and_reuse_the_last_good_one(tmp_path: Path):
    n = 2 * round(1 / MAX_POOR_SHARE)  # one blank frame stays under the share
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=n, blank=frozenset({5}))
    result = stabilise_video(video, tmp_path / "s.mp4", report=tmp_path / "r.json")
    poor = [f for f in result.report.frames if not f.ok]
    assert [f.frame for f in poor] == [5]
    assert poor[0].used_frame == 4 and poor[0].problem
    assert poor[0].homography == result.report.frames[4].homography
    assert len(result.warnings) == 1 and "frame 5" in result.warnings[0]


def test_too_many_poor_frames_fail_but_write_the_report(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=10, blank=frozenset({3, 4, 5, 6}))
    out, report = tmp_path / "s.mp4", tmp_path / "r.json"
    with pytest.raises(StabiliseError, match="4 of 10 frames") as err:
        stabilise_video(video, out, report=report)
    assert "one spot" in str(err.value)
    assert not out.exists()
    assert read_stabilisation(report).summary.frames_poor == 4


def test_flat_reference_frame_is_refused(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=4, blank=frozenset({0}))
    with pytest.raises(StabiliseError, match="reference frame 0 has too little texture"):
        stabilise_video(video, tmp_path / "s.mp4")


def test_reference_frame_beyond_the_video(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=4)
    with pytest.raises(StabiliseError, match="has 4 frames"):
        stabilise_video(video, tmp_path / "s.mp4", reference_frame=4)


def test_report_with_a_bad_homography_is_refused(tmp_path: Path):
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=3)
    good = tmp_path / "r.json"
    stabilise_video(video, tmp_path / "s.mp4", report=good)
    data = json.loads(good.read_text())
    data["frames"][1]["homography"] = [1.0, 0.0]
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(data))
    with pytest.raises(Exception, match="homography"):
        read_stabilisation(bad)


def test_a_poor_frame_before_the_reference_borrows_the_next_good_one(tmp_path: Path):
    n = 2 * round(1 / MAX_POOR_SHARE)
    video = write_shaky_video(tmp_path / "shaky.mp4", frames=n, blank=frozenset({0}))
    result = stabilise_video(video, tmp_path / "s.mp4", reference_frame=3)
    first = result.report.frames[0]
    assert not first.ok and first.used_frame == 1


class _ClosedWriter:
    def __init__(self, *_args: object) -> None:
        pass

    @staticmethod
    def fourcc(*_codes: str) -> int:
        return 0

    def isOpened(self) -> bool:  # noqa: N802 - OpenCV's name
        return False

    def release(self) -> None:
        pass


class _NoEncoderCv2:
    VideoWriter = _ClosedWriter


def test_no_mp4_encoder_is_a_plain_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(video_writer, "cv2_module", lambda: _NoEncoderCv2)
    with pytest.raises(VideoError, match="no usable mp4 encoder"):
        video_writer.open_writer(tmp_path / "x.mp4", 10.0, (WIDTH, HEIGHT))
