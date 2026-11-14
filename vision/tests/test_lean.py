import numpy as np
import pytest

from dryrun_vision.formats import Detection
from dryrun_vision.geometry import Vec2, distance, model_from_calibration, project_at
from dryrun_vision.identity import floor_point, lean
from dryrun_vision.identity.lean import lean_corrected
from synth import BOX_WIDTH_OF_HEIGHT, golden_calibration, person_box

MODEL = model_from_calibration(golden_calibration("counter-a"))
SPOTS = [(1.15, 1.0), (2.06, 0.98), (2.99, 0.97), (0.9, 2.6), (3.6, 1.9), (0.3, 0.5), (4.3, 0.4)]


def _det(box: tuple[float, float, float, float]) -> Detection:
    x, y, w, h = box
    return Detection(frame=0, t=0.0, track_id=1, x=x, y=y, w=w, h=h, score=0.9)


@pytest.mark.parametrize("spot", SPOTS)
def test_lean_correction_recovers_a_whole_person(spot: tuple[float, float]):
    # Synthetic boxes drawn with the same model the correction inverts: this shows the algebra is
    # right, not that it helps on real boxes (on PETS09 it helped the head anchor only slightly).
    d = _det(person_box(MODEL, spot, 1.66, 1280, 720, centre="both"))
    assert distance(floor_point(MODEL, d, "head", 1.66), Vec2(*spot)) < 0.002


def test_the_foot_anchor_is_not_lean_corrected():
    # On PETS09-S2L1 the correction made the foot anchor slightly worse (median 0.209 vs 0.198 m).
    d = _det(person_box(MODEL, (1.15, 1.0), 1.66, 1280, 720, centre="both"))
    plain = floor_point(MODEL, d, "foot", 1.66, correct_lean=False)
    assert floor_point(MODEL, d, "foot", 1.66) == plain


def test_a_solve_that_does_not_converge_keeps_the_plain_estimate(monkeypatch: pytest.MonkeyPatch):
    start = Vec2(1.0, 1.0)

    def never_zero(_m, _d, _a, _h, xz):  # a residual Gauss-Newton cannot drive to zero
        return np.array([20 * ((xz[0] - 1.2) ** 2 + 0.05), xz[1] - 1.0])  # always 1 px or more

    monkeypatch.setattr(lean, "_residual", never_zero)
    monkeypatch.setattr(lean, "MAX_STEPS", 11)  # ends 0.17 m from the start: within MAX_SHIFT_M
    assert lean.lean_corrected(MODEL, _det((0, 0, 10, 10)), "head", 1.66, start) == start


@pytest.mark.parametrize("spot", SPOTS[:3])
def test_head_anchor_with_feet_hidden_by_a_counter(spot: tuple[float, float]):
    head, foot, counter = (project_at(MODEL, spot, y) for y in (1.66, 0.0, 0.9))
    w = BOX_WIDTH_OF_HEIGHT * (foot[1] - head[1])  # the body is as wide as before
    left, right = min(head[0], counter[0]) - w / 2, max(head[0], counter[0]) + w / 2
    cut = _det((left, head[1], right - left, counter[1] - head[1]))  # the box ends at the counter edge
    assert distance(floor_point(MODEL, cut, "head", 1.66), Vec2(*spot)) < 0.002


def test_correction_beats_the_plain_top_centre():
    spot = (1.15, 1.0)
    d = _det(person_box(MODEL, spot, 1.66, 1280, 720, centre="both"))
    plain = floor_point(MODEL, d, "head", 1.66, correct_lean=False)
    assert distance(plain, Vec2(*spot)) > 0.05
    assert distance(floor_point(MODEL, d, "head", 1.66), Vec2(*spot)) < 0.002


def test_falls_back_when_the_start_point_is_missing():
    assert lean_corrected(MODEL, _det((0, 0, 10, 10)), "head", 1.66, None) is None
