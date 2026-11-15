"""The numpy port must agree with src/camera/* (golden data from tests/golden/make_golden.ts)."""

import numpy as np
import pytest

from conftest import FIXTURE_NAMES, golden_fixture
from dryrun_vision.formats import CalibrationFile
from dryrun_vision.geometry import image_to_floor_at, project_at, solve_calibration

REL = 1e-6
CASES = ("boxTops", "lens", "boxTopsBadClick")
EXPECTED_METHOD = {"boxTops": "box-tops", "lens": "lens", "boxTopsBadClick": "box-tops"}


def _case(fixture: str, case: str) -> tuple[dict, CalibrationFile]:
    g = golden_fixture(fixture)["calibrations"][case]
    return g, CalibrationFile.model_validate(g["calibration"])


def _close(a: float, b: float, scale: float = 1.0) -> bool:
    return abs(a - b) <= REL * max(abs(a), abs(b), scale)


@pytest.mark.parametrize("fixture", FIXTURE_NAMES)
@pytest.mark.parametrize("case", CASES)
def test_model_matches_typescript(fixture: str, case: str):
    g, cal = _case(fixture, case)
    solved = solve_calibration(cal.pairs, cal.image_size)
    m = solved.model
    assert m.method == g["model"]["method"] == EXPECTED_METHOD[case]
    h_ts = np.array(g["model"]["floorToImage"]).reshape(3, 3)
    np.testing.assert_allclose(m.floor_to_image, h_ts, rtol=REL, atol=REL * np.abs(h_ts).max())
    up_ts = np.array(g["model"]["up"])
    np.testing.assert_allclose(m.up, up_ts, rtol=REL, atol=REL * np.abs(up_ts).max())
    assert m.note == g["model"]["note"]
    np.testing.assert_allclose(solved.errors_cm, g["errorsCm"], rtol=1e-5, atol=1e-6)
    assert _close(solved.rms_cm, g["rmsCm"])
    assert solved.suspect == g["suspect"]


@pytest.mark.parametrize("fixture", FIXTURE_NAMES)
@pytest.mark.parametrize("case", CASES)
def test_projection_queries_match_typescript(fixture: str, case: str):
    g, cal = _case(fixture, case)
    m = solve_calibration(cal.pairs, cal.image_size).model
    for q in g["floorQueries"]:
        got = project_at(m, (q["floor"]["x"], q["floor"]["z"]), q["h"])
        exp = q["image"]
        assert (got is None) == (exp is None)
        if exp is not None:
            assert _close(got[0], exp["x"], 1.0) and _close(got[1], exp["y"], 1.0), q
    for q in g["imageQueries"]:
        got = image_to_floor_at(m, (q["image"]["x"], q["image"]["y"]), q["h"])
        exp = q["floor"]
        assert (got is None) == (exp is None)
        if exp is not None:
            assert _close(got.x, exp["x"], 1.0) and _close(got.z, exp["z"], 1.0), q


def test_golden_covers_both_methods_and_a_suspect():
    g = golden_fixture("counter-a")["calibrations"]
    assert {c["model"]["method"] for c in g.values()} == {"box-tops", "lens"}
    assert g["boxTopsBadClick"]["suspect"] is not None
