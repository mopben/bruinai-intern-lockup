"""Trips found by the Python port must be exactly the trips src/core/trips.ts finds."""

from pathlib import Path

import pytest

from conftest import golden_fixture
from dryrun_vision.actions import detect_trips, resting_home, smooth_positions
from dryrun_vision.formats import PositionSample, read_positions
from dryrun_vision.geometry import Vec2
from dryrun_vision.kitchen import load_kitchen


def test_trips_match_typescript(fixture_dir: Path, fixture_name: str):
    expected = golden_fixture(fixture_name)["trips"]
    k = load_kitchen(fixture_dir)
    got = detect_trips(k, read_positions(fixture_dir / "positions.jsonl").samples)
    assert [(t.worker_id, t.kind, t.target_id, t.t0, t.t1) for t in got] == [
        (t["workerId"], t["kind"], t["targetId"], t["t0"], t["t1"]) for t in expected
    ]
    for t, e in zip(got, expected, strict=True):
        assert t.distance_m == pytest.approx(e["distanceM"], abs=1e-9)


def test_smoothing_keeps_monotone_motion():
    samples = [PositionSample(t=i * 0.1, worker_id="r", x=i * 0.1, z=0.0) for i in range(10)]
    sm = smooth_positions(samples)
    assert [p.x for p in sm] == pytest.approx([s.x for s in samples])


def test_resting_home_falls_back_to_stand():
    stand = Vec2(1.0, 1.0)
    assert resting_home(stand, (Vec2(5, 5),), (True,)) == stand
