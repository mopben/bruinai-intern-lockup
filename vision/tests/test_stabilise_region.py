"""Stabilising on a region of interest (parallax), measuring the rest, and the cropped viewer video."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("cv2")

from dryrun_vision.cli import main
from dryrun_vision.errors import DryRunError
from dryrun_vision.formats import ImagePoint, read_stabilisation
from dryrun_vision.stabilise import (
    CropRect,
    StabiliseError,
    read_region,
    region_mask,
    stabilise_video,
    viewer_crop,
)
from dryrun_vision.video import probe_video, read_frames
from shaky import (
    FG_RECT,
    HEIGHT,
    WIDTH,
    grid_error_in_px,
    layer_offset,
    shake_near,
    write_parallax_video,
    write_shaky_video,
)

REGION_TOLERANCE_PX = 1.0
"""Recovered vs true near-layer homography inside the region, through an mp4v round trip."""
INSET_PX = 12
"""The region given to stabilise is the near layer shrunk by this, so no far-layer pixel is in it."""


def _region_file(path: Path, rect: tuple[int, int, int, int]) -> Path:
    x0, y0, x1, y1 = rect
    poly = [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]
    path.write_text(json.dumps({"format": "dryrun.stabilisation-region", "version": 1, "polygons": [poly]}))
    return path


def _inset(rect: tuple[int, int, int, int], d: int) -> tuple[int, int, int, int]:
    return (rect[0] + d, rect[1] + d, rect[2] - d, rect[3] - d)


def test_read_region_and_mask(tmp_path: Path):
    region = read_region(_region_file(tmp_path / "r.json", (10, 20, 50, 40)))
    assert region.polygons[0][0] == ImagePoint(x=10, y=20)
    mask = region_mask((HEIGHT, WIDTH), region)
    assert mask[30, 30] == 255 and mask[10, 30] == 0 and mask[30, 60] == 0


@pytest.mark.parametrize(
    ("body", "words"),
    [
        ({"format": "dryrun.stabilisation-region", "version": 1, "polygons": []}, "polygons"),
        (
            {"format": "dryrun.stabilisation-region", "version": 1, "polygons": [[{"x": 1, "y": 2}]]},
            "polygons",
        ),
        ({"format": "dryrun.region", "version": 1, "polygons": []}, "format"),
    ],
)
def test_bad_region_files(tmp_path: Path, body: dict, words: str):
    path = tmp_path / "r.json"
    path.write_text(json.dumps(body))
    with pytest.raises(DryRunError, match=words):
        read_region(path)


def test_region_outside_the_picture_is_refused(tmp_path: Path):
    video = write_shaky_video(tmp_path / "v.mp4", frames=3)
    region = read_region(_region_file(tmp_path / "r.json", (WIDTH + 10, 0, WIDTH + 90, 50)))
    with pytest.raises(StabiliseError, match="region"):
        stabilise_video(video, tmp_path / "s.mp4", region=region)


def test_whole_frame_fit_follows_the_bigger_far_layer(tmp_path: Path):
    """Without a region the fit locks onto the far layer, so the near layer is off by the parallax."""
    video = write_parallax_video(tmp_path / "p.mp4", frames=10)
    report = stabilise_video(video, tmp_path / "s.mp4").report
    errors = [
        grid_error_in_px(np.array(f.homography).reshape(3, 3), shake_near(f.frame), _inset(FG_RECT, INSET_PX))
        for f in report.frames
    ]
    assert max(errors) > 2 * REGION_TOLERANCE_PX
    assert all(f.outside_median_px is None for f in report.frames)


def test_region_fit_follows_the_near_layer_and_measures_the_rest(tmp_path: Path):
    video = write_parallax_video(tmp_path / "p.mp4", frames=10)
    region = read_region(_region_file(tmp_path / "r.json", _inset(FG_RECT, INSET_PX)))
    result = stabilise_video(video, tmp_path / "s.mp4", region=region)
    report = result.report
    assert report.region == region.polygons
    for f in report.frames:
        h = np.array(f.homography).reshape(3, 3)
        assert grid_error_in_px(h, shake_near(f.frame), _inset(FG_RECT, INSET_PX)) < REGION_TOLERANCE_PX
        if abs(layer_offset(f.frame)) > 3.0:
            assert f.outside_median_px is not None
            assert f.outside_median_px == pytest.approx(abs(layer_offset(f.frame)), abs=1.5)
    assert report.summary.outside_median_px is not None


def test_viewer_crop_of_known_translations():
    """Frames shifted by up to +-10 px right/left and 6 px down: the shared area is known exactly."""
    hs = [
        np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], dtype=np.float64)
        for dx, dy in [(0, 0), (10, 0), (-10, 6)]
    ]
    crop = viewer_crop(hs, WIDTH, HEIGHT, min_coverage=1.0)
    assert crop.x >= 10 and crop.x + crop.width <= WIDTH - 10
    assert crop.y >= 6 and crop.y + crop.height <= HEIGHT
    assert crop.width / crop.height == pytest.approx(WIDTH / HEIGHT, rel=0.03)
    best_height = (WIDTH - 20) * HEIGHT / WIDTH  # the 300 px shared width limits it
    assert crop.height >= best_height - 16  # within two grid cells of the best
    assert crop.width % 2 == 0 and crop.height % 2 == 0


def test_viewer_crop_may_ignore_a_rare_outlier():
    hs = [np.eye(3)] * 99 + [np.array([[1, 0, 80.0], [0, 1, 0], [0, 0, 1]])]
    assert viewer_crop(hs, WIDTH, HEIGHT, min_coverage=0.99).width >= WIDTH - 16
    assert viewer_crop(hs, WIDTH, HEIGHT, min_coverage=1.0).width <= WIDTH - 80


def test_viewer_crop_with_no_shared_area_is_refused():
    hs = [np.eye(3), np.array([[1, 0, 1000.0], [0, 1, 0], [0, 0, 1]])]
    with pytest.raises(StabiliseError, match="no part of the picture"):
        viewer_crop(hs, WIDTH, HEIGHT, min_coverage=1.0)


def test_viewer_video_is_the_crop_without_black_borders(tmp_path: Path):
    video = write_shaky_video(tmp_path / "v.mp4", frames=12)
    viewer = tmp_path / "viewer.mp4"
    report = stabilise_video(video, tmp_path / "s.mp4", viewer_out=viewer).report
    crop = report.viewer_crop
    assert isinstance(crop, CropRect)
    info = probe_video(viewer)
    assert (info.width, info.height, info.frames) == (crop.width, crop.height, 12)
    darkest = min(float(f.image.min(axis=2).mean(axis=0).min()) for f in read_frames(viewer))
    assert darkest > 20  # no black column anywhere
    full = [f.image for f in read_frames(tmp_path / "s.mp4")]
    first = next(iter(read_frames(viewer))).image
    window = full[0][crop.y : crop.y + crop.height, crop.x : crop.x + crop.width]
    assert np.abs(first.astype(int) - window).mean() < 6  # same pixels, offset by the crop


def test_cli_region_and_viewer(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_parallax_video(tmp_path / "p.mp4", frames=6)
    region = _region_file(tmp_path / "r.json", _inset(FG_RECT, INSET_PX))
    report, viewer = tmp_path / "r.out.json", tmp_path / "viewer.mp4"
    argv = ["stabilise", str(video), "--out", str(tmp_path / "s.mp4"), "--region", str(region)]
    assert main([*argv, "--report", str(report), "--viewer-out", str(viewer)]) == 0
    out = capsys.readouterr().out
    assert "inside the region" in out and "outside it" in out and "viewer" in out
    data = read_stabilisation(report)
    assert data.viewer_crop is not None and data.region is not None


def test_cli_bad_region_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_shaky_video(tmp_path / "v.mp4", frames=3)
    bad = tmp_path / "r.json"
    bad.write_text("{")
    assert main(["stabilise", str(video), "--out", str(tmp_path / "s.mp4"), "--region", str(bad)]) == 1
    assert "not valid JSON" in capsys.readouterr().err
