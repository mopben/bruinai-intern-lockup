import math
import random
from pathlib import Path

import pytest

from dryrun_vision.actions import MAX_GAP_S, MIN_SEGMENT_S, segment_actions
from dryrun_vision.formats import ActionSegment, PositionSample, read_positions
from dryrun_vision.formats.actions import find_overlap
from dryrun_vision.geometry import Vec2
from dryrun_vision.kitchen import Kitchen, load_kitchen

HZ = 10.0
DT = 1 / HZ


@pytest.fixture
def kitchen(counter_a: Path) -> Kitchen:
    return load_kitchen(counter_a)


def _stay(worker: str, p: Vec2, t0: float, t1: float) -> list[PositionSample]:
    n = round((t1 - t0) * HZ)
    return [PositionSample(t=round(t0 + i * DT, 3), worker_id=worker, x=p.x, z=p.z) for i in range(n)]


def _walk(worker: str, a: Vec2, b: Vec2, t0: float, speed: float = 1.0) -> list[PositionSample]:
    n = max(1, round(math.dist(a, b) / speed * HZ))
    return [
        PositionSample(
            t=round(t0 + i * DT, 3),
            worker_id=worker,
            x=a.x + (b.x - a.x) * i / n,
            z=a.z + (b.z - a.z) * i / n,
        )
        for i in range(n)
    ]


def _end(samples: list[PositionSample]) -> float:
    return round(samples[-1].t + DT, 3)


def _kinds(segs: tuple[ActionSegment, ...], worker: str) -> list[tuple[str, str | None]]:
    return [(s.kind, s.box_id) for s in segs if s.worker_id == worker]


def _assert_contract(segs: tuple[ActionSegment, ...]) -> None:
    assert find_overlap(segs) is None
    assert all(s.t1 > s.t0 for s in segs)
    assert list(segs) == sorted(segs, key=lambda s: (s.t0, s.worker_id))


def test_standing_at_home_is_work(kitchen: Kitchen):
    home = kitchen.home_station("red")
    res = segment_actions(kitchen, _stay("red", home.stand, 0, 10))
    assert _kinds(res.segments, "red") == [("work", home.id)]
    assert res.segments[0].t0 == 0 and res.segments[0].t1 == pytest.approx(9.9)


def test_fetch_round_trip(kitchen: Kitchen):
    home = kitchen.home_station("blue")
    fridge = kitchen.storage[0]
    s = _stay("blue", home.stand, 0, 3)
    s += _walk("blue", home.stand, fridge.stand, _end(s))
    s += _stay("blue", fridge.stand, _end(s), _end(s) + 1.5)
    s += _walk("blue", fridge.stand, home.stand, _end(s))
    s += _stay("blue", home.stand, _end(s), _end(s) + 3)
    res = segment_actions(kitchen, s)
    assert _kinds(res.segments, "blue") == [("work", home.id), ("fetch", fridge.id), ("work", home.id)]
    _assert_contract(res.segments)


def test_carry_to_pickup(kitchen: Kitchen):
    home = kitchen.home_station("yellow")
    pickup = kitchen.pickup
    s = _stay("yellow", home.stand, 0, 2)
    s += _walk("yellow", home.stand, pickup.stand, _end(s))
    s += _stay("yellow", pickup.stand, _end(s), _end(s) + 0.6)
    s += _walk("yellow", pickup.stand, home.stand, _end(s))
    s += _stay("yellow", home.stand, _end(s), _end(s) + 2)
    res = segment_actions(kitchen, s)
    assert ("carry", pickup.id) in _kinds(res.segments, "yellow")


def test_idle_away_from_stand_points_and_unmatched_walk(kitchen: Kitchen):
    home = kitchen.home_station("red")
    away = Vec2(2.2, 2.2)
    s = _stay("red", home.stand, 0, 2)
    s += _walk("red", home.stand, away, _end(s), speed=0.8)
    s += _stay("red", away, _end(s), _end(s) + 4)
    res = segment_actions(kitchen, s)
    kinds = [k for k, _ in _kinds(res.segments, "red")]
    assert kinds == ["work", "walk", "idle"]
    _assert_contract(res.segments)


def test_gap_splits_segments_and_is_reported(kitchen: Kitchen):
    home = kitchen.home_station("red")
    s = _stay("red", home.stand, 0, 3) + _stay("red", home.stand, 6, 9)
    res = segment_actions(kitchen, s)
    segs = [x for x in res.segments if x.worker_id == "red"]
    assert len(segs) == 2
    assert segs[0].t1 == pytest.approx(2.9) and segs[1].t0 == pytest.approx(6.0)
    assert any("gap" in w for w in res.warnings)
    assert MAX_GAP_S < 3


def test_short_flicker_is_absorbed(kitchen: Kitchen):
    home = kitchen.home_station("red")
    s = _stay("red", home.stand, 0, 3)
    jump = [
        PositionSample(
            t=round(_end(s) + i * DT, 3), worker_id="red", x=home.stand.x + 0.15 * (i % 2), z=home.stand.z
        )
        for i in range(3)
    ]
    s += jump + _stay("red", home.stand, _end(jump), _end(jump) + 3)
    res = segment_actions(kitchen, s)
    assert _kinds(res.segments, "red") == [("work", home.id)]
    assert MIN_SEGMENT_S > 3 * DT


def test_noise_and_dropouts_do_not_throw(kitchen: Kitchen):
    rng = random.Random(4)
    home = kitchen.home_station("blue")
    s = [
        PositionSample(
            t=round(i * DT, 3),
            worker_id="blue",
            x=home.stand.x + rng.gauss(0, 0.04),
            z=home.stand.z + rng.gauss(0, 0.04),
        )
        for i in range(600)
        if rng.random() > 0.3
    ]
    s.append(PositionSample(t=60.5, worker_id="blue", x=40.0, z=40.0))  # wild outlier, far outside the room
    res = segment_actions(kitchen, s)
    _assert_contract(res.segments)
    assert any("outside" in w for w in res.warnings)


def test_unknown_worker_and_empty_worker_are_warnings(kitchen: Kitchen):
    res = segment_actions(kitchen, _stay("purple", Vec2(1, 1), 0, 2))
    assert res.segments == ()
    assert any("purple" in w for w in res.warnings)
    assert any("red" in w and "no positions" in w for w in res.warnings)


def test_inputs_are_not_mutated(kitchen: Kitchen):
    home = kitchen.home_station("red")
    s = tuple(reversed(_stay("red", home.stand, 0, 2)))
    before = list(s)
    segment_actions(kitchen, s)
    assert list(s) == before


def test_fixtures_segment_cleanly(fixture_dir: Path):
    k = load_kitchen(fixture_dir)
    res = segment_actions(k, read_positions(fixture_dir / "positions.jsonl").samples)
    _assert_contract(res.segments)
    kinds = {s.kind for s in res.segments}
    assert {"work", "carry"} <= kinds
    assert {s.worker_id for s in res.segments} == {w.id for w in k.workers}


def test_back_to_back_trips_to_the_same_target_stay_two_segments(kitchen: Kitchen, monkeypatch):
    from dryrun_vision.actions import segment as seg_mod  # noqa: PLC0415
    from dryrun_vision.actions.trips import Trip  # noqa: PLC0415

    blue = kitchen.home_station("blue")
    fridge = next(i for i in kitchen.items if i.role == "storage")
    samples = _stay("blue", blue.stand, 0.0, 12.0)
    trips = (Trip("blue", "fetch", fridge.id, 2.0, 5.0, 3.0), Trip("blue", "fetch", fridge.id, 5.0, 8.0, 3.0))
    monkeypatch.setattr(seg_mod, "worker_trips", lambda *_a: trips)
    res = segment_actions(kitchen, samples)
    fetches = [(s.t0, s.t1) for s in res.segments if s.kind == "fetch"]
    assert fetches == [(2.0, 5.0), (5.0, 8.0)]
