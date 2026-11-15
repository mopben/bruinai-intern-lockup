from pathlib import Path

import pytest

from dryrun_vision.errors import FormatError
from dryrun_vision.geometry import Vec2, distance, model_from_calibration, project_at
from dryrun_vision.mot.tsai import TsaiCamera, read_tsai
from dryrun_vision.mot.tsai_calibration import (
    calibration_fit,
    calibration_from_tsai,
    ground_to_floor,
    world_to_ours,
)

PETS_TXT = (
    "768 576 7.95e+02 7.52e+02 4.85e-03 4.65e-03 5.1273271277e-03 4.65e-03 3.2422149053e+02 "
    "2.8256650051e+02 1.0937855397e+00 5.5549183034e+00 5.1113043639e-03 8.2873214225e+02 "
    "-3.1754796051e+03 3.5469298547e+04 2.0405458695e+00 -8.9337703748e-01 -4.3056124791e-01"
)
GT_REGION = ((-12.0, -12.0), (6.0, 6.0))


@pytest.fixture
def cam(tmp_path: Path) -> TsaiCamera:
    p = tmp_path / "View_001.txt"
    p.write_text("\n".join(PETS_TXT.split()) + "\n")
    return read_tsai(p)


def test_reads_the_19_numbers(cam: TsaiCamera):
    assert (cam.width, cam.height) == (768, 576)
    assert cam.focal == pytest.approx(5.5549183034) and cam.rz == pytest.approx(-0.43056124791)


def test_reproduces_the_documented_ground_truth_check(cam: TsaiCamera):
    # gt.txt row 1: person 9 at (-4.1554, -7.3591) m; box (499, 158, 31.03, 75.17).
    u, v = cam.world_to_pixel((-4155.4, -7359.1, 0.0))
    assert u == pytest.approx(499 + 31.03 / 2 - 1.5, abs=0.6)
    assert v == pytest.approx(158 + 75.17 - 1.5, abs=0.6)


def test_pixel_to_ground_inverts_world_to_pixel(cam: TsaiCamera):
    for x, y in [(-4155.4, -7359.1), (0.0, 0.0), (-11306.0, -5599.5)]:
        u, v = cam.world_to_pixel((x, y, 0.0))
        gx, gy = cam.pixel_to_ground(u, v)
        assert gx == pytest.approx(x, abs=1.0) and gy == pytest.approx(y, abs=1.0)


def test_camera_height_is_about_7_metres(cam: TsaiCamera):
    assert cam.centre()[2] == pytest.approx(7070, abs=50)


def test_frame_conversion():
    assert world_to_ours((1.0, 2.0, 3.0)) == (1.0, 3.0, -2.0)
    assert ground_to_floor((1.5, -2.0)) == Vec2(1.5, 2.0)


def test_calibration_from_tsai_fits_our_pinhole_model(cam: TsaiCamera):
    cal = calibration_from_tsai(cam, GT_REGION)
    assert cal.image_size.width == 768 and cal.format == "dryrun.camera-calibration"
    floor = [p for p in cal.pairs if p.world.y == 0]
    tops = [p for p in cal.pairs if p.world.y > 0]
    assert len(floor) >= 12 and len(tops) >= 4
    m = model_from_calibration(cal)
    assert m.method == "box-tops"
    # A ground point projects about where the Tsai camera puts it (distortion is small here).
    u, v = cam.world_to_pixel((-4155.4, -7359.1, 1700.0))
    ours = project_at(m, ground_to_floor((-4.1554, -7.3591)), 1.7)
    assert distance(Vec2(*ours), Vec2(u, v)) < 3.0
    fit = calibration_fit(cam, m, GT_REGION)
    assert fit.median_px < 1.5 and fit.worst_px < 6.0
    assert fit.floor_median_cm < 10.0


def test_bad_file(tmp_path: Path):
    p = tmp_path / "View_001.txt"
    p.write_text("1 2 3\n")
    with pytest.raises(FormatError, match="19 numbers"):
        read_tsai(p)
    with pytest.raises(FormatError, match="does not exist"):
        read_tsai(tmp_path / "nope.txt")


def test_gt_region_needs_evaluated_rows():
    from dryrun_vision.mot import GtBox  # noqa: PLC0415
    from dryrun_vision.mot.report import gt_region  # noqa: PLC0415

    with pytest.raises(FormatError, match="no evaluated"):
        gt_region([GtBox(0, 1, 0, 0, 1, 1, 0, (0.0, 0.0))])


def test_calibration_fit_off_the_picture_is_a_plain_error(cam: TsaiCamera, monkeypatch: pytest.MonkeyPatch):
    from dryrun_vision.mot import tsai_calibration as tc  # noqa: PLC0415

    region = GT_REGION
    model = model_from_calibration(calibration_from_tsai(cam, region))
    monkeypatch.setattr(tc, "_pixel", lambda *_a: None)
    with pytest.raises(FormatError, match="not in the picture"):
        tc.calibration_fit(cam, model, region)
