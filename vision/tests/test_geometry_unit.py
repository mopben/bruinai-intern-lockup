import numpy as np
import pytest

from dryrun_vision.errors import CalibrationError
from dryrun_vision.formats import Detection, ImageSize, PointPair
from dryrun_vision.geometry import (
    CameraModel,
    anchor_pixel,
    apply_homography,
    camera_position,
    detection_floor_point,
    image_to_floor_at,
    model_from_tops,
    project_at,
    solve_calibration,
    solve_hat_height,
    solve_homography,
)
from dryrun_vision.geometry.linalg import inv3, least_squares, solve_square

# A pinhole camera 2.8 m up looking at the counter (like tools/camera/scene.ts).
F, CX, CY = 950.0, 640.0, 360.0


def _camera() -> np.ndarray:
    c = np.array([2.3, 2.8, 5.0])
    f = np.array([2.2, 0.6, 1.4]) - c
    f /= np.linalg.norm(f)
    right = np.cross(f, [0, 1, 0])
    right /= np.linalg.norm(right)
    down = np.cross(f, right)
    r = np.stack([right, down, f])
    k = np.array([[F, 0, CX], [0, F, CY], [0, 0, 1]])
    return k @ np.hstack([r, (-r @ c)[:, None]])


P = _camera()


def _px(x: float, y: float, z: float) -> tuple[float, float]:
    u, v, w = P @ np.array([x, y, z, 1.0])
    return (u / w, v / w)


def _pair(x: float, y: float, z: float) -> PointPair:
    u, v = _px(x, y, z)
    return PointPair.model_validate(
        {"label": "p", "world": {"x": x, "y": y, "z": z}, "image": {"x": u, "y": v}}
    )


FLOOR = [(0.5, 0, 0.6), (4.0, 0, 0.7), (3.8, 0, 3.2), (0.7, 0, 3.0), (2.2, 0, 1.9)]
TOPS = [(1.0, 0.9, 0.6), (3.0, 0.95, 0.7), (0.6, 1.1, 2.6)]
SIZE = ImageSize(width=1280, height=720)


def test_box_tops_is_exact_for_a_pinhole():
    solved = solve_calibration([_pair(*p) for p in FLOOR + TOPS], SIZE)
    assert solved.model.method == "box-tops"
    assert solved.rms_cm < 1e-6
    hx, hz = 1.9, 2.2
    got = image_to_floor_at(solved.model, _px(hx, 1.65, hz), 1.65)
    assert got is not None
    assert got.x == pytest.approx(hx, abs=1e-9) and got.z == pytest.approx(hz, abs=1e-9)
    assert project_at(solved.model, (hx, hz), 1.65) == pytest.approx(_px(hx, 1.65, hz), abs=1e-6)
    pos = camera_position(solved.model)
    assert pos == pytest.approx((2.3, 2.8, 5.0), abs=1e-6)


def test_lens_fallback_is_exact_with_centred_lens():
    solved = solve_calibration([_pair(*p) for p in FLOOR], SIZE)
    assert solved.model.method == "lens"
    assert "centred lens" in solved.model.note
    got = image_to_floor_at(solved.model, _px(2.0, 1.7, 2.0), 1.7)
    assert got is not None and got.x == pytest.approx(2.0, abs=1e-6)


def test_hat_height_measure():
    m = solve_calibration([_pair(*p) for p in FLOOR + TOPS], SIZE).model
    assert solve_hat_height(m, _px(2.0, 1.66, 1.5), (2.0, 1.5)) == pytest.approx(1.66, abs=1e-9)
    with pytest.raises(CalibrationError, match="not plausible"):
        solve_hat_height(m, _px(2.0, 0.3, 1.5), (2.0, 1.5))


def test_detection_anchor_is_top_centre():
    m = solve_calibration([_pair(*p) for p in FLOOR + TOPS], SIZE).model
    u, v = _px(2.5, 1.7, 2.0)
    det = Detection(frame=0, t=0.0, track_id=1, x=u - 40, y=v, w=80, h=200, score=0.9)
    assert anchor_pixel(det) == (u, v)
    p = detection_floor_point(m, det, 1.7)
    assert p is not None and p.x == pytest.approx(2.5, abs=1e-9) and p.z == pytest.approx(2.0, abs=1e-9)


def test_too_few_floor_points():
    with pytest.raises(CalibrationError, match="2 more floor points"):
        solve_calibration([_pair(*p) for p in FLOOR[:2]], SIZE)


@pytest.mark.parametrize(
    ("src", "message"),
    [
        ([(0, 0), (1, 0), (2, 0), (3, 0)], "line"),
        ([(0, 0), (0, 0), (1, 1), (0, 1)], "same place"),
        ([(0, 0), (1, 0), (2, 0.0001), (0, 1)], "Three of the four"),
        ([(0, 0), (1, 0), (1, 1)], "at least four"),
    ],
)
def test_homography_rejects_degenerate_points(src, message):
    dst = [(10 + 3 * x, 5 + 2 * y) for x, y in src]
    if len(src) == 4 and message == "same place":
        dst = [(0, 0), (1, 0), (1, 1), (0, 1)]
    with pytest.raises(CalibrationError, match=message):
        solve_homography(src, dst)


def test_homography_mismatched_lengths_and_nan():
    with pytest.raises(CalibrationError, match="exactly one"):
        solve_homography([(0, 0)], [])
    with pytest.raises(CalibrationError, match="not a number"):
        solve_homography([(0, 0), (1, 0), (1, 1), (float("nan"), 1)], [(0, 0), (1, 0), (1, 1), (0, 1)])


def test_homography_round_trip():
    src = [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.2)]
    h_true = np.array([[2.0, 0.1, 3], [0.2, 1.5, 1], [0.01, 0.02, 1]])
    dst = [apply_homography(h_true, p) for p in src]
    h = solve_homography(src, dst)
    np.testing.assert_allclose(h, h_true, rtol=1e-9, atol=1e-9)
    assert apply_homography(np.zeros((3, 3)), (1, 1)) is None


def test_model_from_tops_needs_two_high_points():
    h = np.eye(3)
    with pytest.raises(CalibrationError, match="two or more"):
        model_from_tops(h, [_pair(1, 0.1, 1)])


def test_model_is_immutable():
    m = solve_calibration([_pair(*p) for p in FLOOR + TOPS], SIZE).model
    assert isinstance(m, CameraModel)
    with pytest.raises(ValueError):
        m.floor_to_image[0, 0] = 5.0


def test_linalg_singular_cases():
    assert solve_square([[1, 2], [2, 4]], [1, 2]) is None
    assert least_squares([[1, 2]], [1]) is None
    assert least_squares([], []) is None
    assert inv3(np.zeros((3, 3))) is None
    assert image_to_floor_at(CameraModel(np.zeros((3, 3)), np.zeros(3), "lens", ""), (1, 1), 1.0) is None
