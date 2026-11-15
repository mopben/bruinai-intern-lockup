import pytest

from conftest import FIXTURES_DIR
from dryrun_vision.clock import RunClock
from dryrun_vision.formats import Detection
from dryrun_vision.geometry import Vec2, distance, model_from_calibration
from dryrun_vision.identity import IdentityResult, Person, build_fragments
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.positions import build_positions
from synth import golden_calibration, person_box

CAL = golden_calibration("counter-a")
MODEL = model_from_calibration(CAL)
KITCHEN = load_kitchen(FIXTURES_DIR / "counter-a")


def _person(  # noqa: PLR0917
    name: str, track_id: int, floor_at, head_m: float, t0: float, t1: float, centre: str = "both"
) -> Person:
    fps = 30.0
    dets = []
    for k in range(round(t0 * fps), round(t1 * fps) + 1):
        t = k / fps
        x, y, w, h = person_box(MODEL, floor_at(t), head_m, 1280, 720, centre)
        dets.append(Detection(frame=k, t=t, track_id=track_id, x=x, y=y, w=w, h=h, score=0.9))
    frags = build_fragments(dets, lambda _d: Vec2(0.0, 0.0))
    return Person(name, frags)


def _identity(*people: Person) -> IdentityResult:
    return IdentityResult(tuple(people), (), ())


def test_a_still_worker_gives_10_hz_samples_at_their_spot():
    red = _person("red", 1, lambda _t: (1.15, 1.0), CAL.hat_heights["red"], 0.0, 3.0)
    res = build_positions(_identity(red), MODEL, CAL, KITCHEN, anchor="head")
    assert [s.t for s in res.samples][:3] == pytest.approx([0.0, 0.1, 0.2])
    assert len(res.samples) == 31 and {s.worker_id for s in res.samples} == {"red"}
    assert max(distance(Vec2(s.x, s.z), Vec2(1.15, 1.0)) for s in res.samples) < 0.002
    assert res.warnings == ()


def test_head_anchor_uses_each_workers_own_height():
    red = _person("red", 1, lambda _t: (1.15, 1.0), CAL.hat_heights["red"], 0.0, 1.0)
    exact = build_positions(_identity(red), MODEL, CAL, KITCHEN, anchor="head").samples[0]
    default = build_positions(_identity(red), MODEL, None, KITCHEN, anchor="head").samples[0]
    assert distance(Vec2(exact.x, exact.z), Vec2(1.15, 1.0)) < 0.002
    assert distance(Vec2(default.x, default.z), Vec2(1.15, 1.0)) > 0.01  # 1.70 m assumed, not 1.63 m


def test_foot_anchor_reads_the_bottom_of_the_box():
    # The foot anchor is not lean-corrected, so the box is centred on the feet here.
    red = _person("red", 1, lambda _t: (1.15, 1.0), CAL.hat_heights["red"], 0.0, 1.0, centre="foot")
    res = build_positions(_identity(red), MODEL, CAL, KITCHEN, anchor="foot")
    assert max(distance(Vec2(s.x, s.z), Vec2(1.15, 1.0)) for s in res.samples) < 0.002


def test_points_outside_the_room_are_rejected_and_reported():
    walker = _person("yellow", 3, lambda t: (3.5 + 1.9 * t, 0.2), CAL.hat_heights["yellow"], 0.0, 1.0)
    res = build_positions(_identity(walker), MODEL, CAL, KITCHEN, anchor="head")
    assert res.samples and max(s.x for s in res.samples) <= KITCHEN.bounds.max_x + 0.5 + 1e-9
    assert set(res.rejected) == {"yellow"} and res.rejected["yellow"] > 5
    assert any("outside the room" in w for w in res.warnings)


def test_start_offset_moves_the_clock_and_drops_earlier_ticks():
    red = _person("red", 1, lambda _t: (1.15, 1.0), CAL.hat_heights["red"], 0.0, 3.0)
    res = build_positions(_identity(red), MODEL, CAL, KITCHEN, anchor="head", clock=RunClock(1.0))
    assert res.samples[0].t == 0.0 and res.samples[-1].t == pytest.approx(2.0)


def test_without_a_kitchen_nothing_is_rejected():
    far = _person("p1", 1, lambda _t: (4.9, 1.0), 1.7, 0.0, 1.0)
    res = build_positions(_identity(far), MODEL, None, None, anchor="head")
    assert len(res.samples) == 11 and res.rejected == {}


def test_samples_are_in_time_order_across_workers():
    a = _person("red", 1, lambda _t: (1.15, 1.0), 1.63, 0.0, 1.0)
    b = _person("blue", 2, lambda _t: (2.0, 1.0), 1.7, 0.0, 1.0)
    res = build_positions(_identity(a, b), MODEL, CAL, KITCHEN, anchor="head")
    ts = [s.t for s in res.samples]
    assert ts == sorted(ts) and [s.worker_id for s in res.samples[:2]] == ["red", "blue"]
