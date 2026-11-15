import math

import pytest

from conftest import FIXTURES_DIR
from dryrun_vision.formats import DEFAULT_ANCHOR_HEIGHT_M, Detection
from dryrun_vision.geometry import Vec2, distance, model_from_calibration, project_at
from dryrun_vision.identity import (
    Person,
    anchor_point,
    build_fragments,
    floor_point,
    link_cost,
    nominal_head_height,
    stitch,
    worker_head_height,
    worker_spots,
)
from dryrun_vision.identity.constants import SHARED_SLOT_SPACING_M, STITCH_MAX_GAP_S
from dryrun_vision.identity.fragments import end_point, merged, overlaps, start_point
from dryrun_vision.identity.rest import seconds_inside, seconds_near, total_seconds
from dryrun_vision.identity.workers import shared_station_notes
from dryrun_vision.kitchen import Bounds, load_kitchen
from identity_helpers import frag, still, walk
from synth import golden_calibration


def _det(x: float, y: float, w: float, h: float, *, track_id: int = 1, frame: int = 0) -> Detection:
    return Detection(frame=frame, t=frame / 10, track_id=track_id, x=x, y=y, w=w, h=h, score=0.9)


def test_anchor_points():
    d = _det(10.0, 20.0, 30.0, 100.0)
    assert anchor_point(d, "head") == (25.0, 20.0)
    assert anchor_point(d, "foot") == (25.0, 120.0)


def test_floor_point_round_trips_through_the_camera():
    cal = golden_calibration("counter-a")
    m = model_from_calibration(cal)
    floor = (2.0, 1.2)
    head, foot = project_at(m, floor, 1.7), project_at(m, floor, 0.0)
    d = _det(head[0] - 20, head[1], 40.0, foot[1] - head[1])
    assert distance(floor_point(m, d, "head", 1.7, correct_lean=False), Vec2(*floor)) < 1e-6
    foot_box = _det(foot[0] - 20, head[1], 40.0, foot[1] - head[1])
    assert distance(floor_point(m, foot_box, "foot", 1.7, correct_lean=False), Vec2(*floor)) < 1e-6


def test_head_heights():
    cal = golden_calibration("counter-a")
    assert nominal_head_height(cal) == pytest.approx(sum(cal.hat_heights.values()) / len(cal.hat_heights))
    assert nominal_head_height(None) == DEFAULT_ANCHOR_HEIGHT_M
    empty = cal.model_copy(update={"hat_heights": {}})
    assert nominal_head_height(empty) == DEFAULT_ANCHOR_HEIGHT_M
    assert worker_head_height(cal, "red") == 1.63
    assert worker_head_height(None, "red") == DEFAULT_ANCHOR_HEIGHT_M


def test_build_fragments_groups_by_id_and_skips_unprojectable():
    dets = [_det(0, 0, 1, 1, track_id=i % 2 + 1, frame=i) for i in range(6)]
    frags = build_fragments(dets, lambda d: None if d.frame == 4 else Vec2(d.frame, 0.0))
    assert [(f.track_id, [d.frame for d in f.detections]) for f in frags] == [(1, [0, 2]), (2, [1, 3, 5])]
    assert build_fragments(dets, lambda _d: None) == ()


def test_fragment_and_person_checks():
    a = frag(1, 0.0, 1.0, still(0, 0))
    b = frag(2, 0.5, 2.0, still(0, 0))
    c = frag(3, 1.5, 3.0, still(0, 0))
    assert overlaps((a,), (b,)) and not overlaps((a,), (c,))
    with pytest.raises(ValueError, match="overlap"):
        Person("x", (a, b))
    p = merged("x", (c,), (a,))
    assert p.track_ids == (1, 3) and p.t0 == 0.0 and p.t1 == 3.0
    assert len(p.times) == len(p.points) == len(p.detections) == 11 + 16
    with pytest.raises(ValueError, match="one floor point"):
        type(a)(1, a.detections, a.points[:-1])


def test_end_points_use_a_median():
    f = frag(1, 0.0, 2.0, walk((0, 0), (2, 0), 0.0, 2.0))
    assert end_point(f, 0.5).x == pytest.approx(1.75)
    assert start_point(f, 0.5).x == pytest.approx(0.25)


def test_link_cost_rules():
    a = frag(1, 0.0, 2.0, still(1.0, 1.0))
    near_soon = frag(2, 3.0, 4.0, still(1.3, 1.0))
    assert link_cost(a, near_soon) == pytest.approx(0.3)
    assert link_cost(a, frag(3, 1.5, 4.0, still(1.0, 1.0))) == math.inf  # overlaps in time
    assert link_cost(a, frag(4, 2.0 + STITCH_MAX_GAP_S + 0.5, 9.0, still(1.0, 1.0))) == math.inf  # too late
    assert link_cost(a, frag(5, 2.5, 4.0, still(3.0, 1.0))) == math.inf  # 2 m in 0.5 s: too far


def test_stitch_joins_a_broken_track_and_keeps_two_people_apart():
    a1 = frag(1, 0.0, 5.0, still(1.0, 1.0))
    a2 = frag(7, 6.0, 9.0, still(1.1, 1.0))
    b = frag(2, 0.0, 9.0, still(3.0, 1.0))
    groups = stitch([a2, b, a1])
    assert [[f.track_id for f in g] for g in groups] == [[1, 7], [2]]


def test_stitch_picks_the_globally_best_links():
    a = frag(1, 0.0, 2.0, still(1.0, 1.0))
    b = frag(2, 0.0, 2.0, still(1.6, 1.0))
    a_next = frag(3, 2.5, 4.0, still(1.05, 1.0))
    b_next = frag(4, 2.5, 4.0, still(1.55, 1.0))
    groups = stitch([a, b, a_next, b_next])
    assert sorted([f.track_id for f in g] for g in groups) == [[1, 3], [2, 4]]


def test_time_near_inside_and_total():
    f = frag(1, 0.0, 10.0, walk((0, 0), (10, 0), 0.0, 10.0))
    assert total_seconds((f,)) == pytest.approx(10.1)
    assert seconds_near((f,), Vec2(5, 0), 1.0) == pytest.approx(2.1, abs=0.11)
    assert seconds_inside((f,), Bounds(0, 4, -1, 1), 0.0) == pytest.approx(4.1, abs=0.11)
    assert seconds_inside((f,), Bounds(0, 4, -1, 1), 1.0) == pytest.approx(5.1, abs=0.11)


def test_a_long_hole_does_not_count_as_time_spent():
    a = frag(1, 0.0, 1.0, still(0, 0))
    gap = frag(1, 0.0, 1.0, still(0, 0))
    joined = type(a)(
        1,
        a.detections + tuple(d.model_copy(update={"t": d.t + 60}) for d in gap.detections),
        a.points + gap.points,
    )
    assert total_seconds((joined,)) < 2.6


def test_worker_spots_one_per_station():
    k = load_kitchen(FIXTURES_DIR / "counter-a")
    spots = worker_spots(k)
    assert [s.worker_id for s in spots] == ["red", "blue", "yellow"]
    for s in spots:
        assert s.spot == k.home_station(s.worker_id).stand and s.mates == (s.worker_id,)
    assert shared_station_notes(spots) == ()


def test_shared_station_spreads_the_workers_along_the_stand_side():
    k = load_kitchen(FIXTURES_DIR / "counter-c-fourth-worker")
    spots = {s.worker_id: s for s in worker_spots(k)}
    stand = k.home_station("blue").stand
    assert spots["blue"].mates == ("blue", "green")
    assert distance(spots["blue"].spot, spots["green"].spot) == pytest.approx(SHARED_SLOT_SPACING_M)
    assert spots["blue"].spot.x < stand.x < spots["green"].spot.x
    assert abs(spots["blue"].spot.z - stand.z) < 0.02
    notes = shared_station_notes(tuple(spots.values()))
    assert len(notes) == 1 and "blue, green" in notes[0]


def test_stitch_prefers_the_right_link_over_more_links():
    # A continues into B 5 cm away. A -> C and D -> B are feasible 1.9 m links. Two links would
    # be "more", but A -> B is obviously the same person; C and D stay on their own.
    a = frag(1, 0.0, 2.0, still(1.0, 1.0))
    d = frag(4, 0.0, 2.0, still(2.9, 1.0))
    b = frag(2, 3.0, 4.0, still(1.05, 1.0))  # a 1 s gap: reach 2 m
    c = frag(3, 3.0, 4.0, still(-0.9, 1.0))
    assert link_cost(a, b) == pytest.approx(0.05) and link_cost(a, c) == pytest.approx(1.9)
    assert link_cost(d, b) == pytest.approx(1.85)
    groups = stitch([a, b, c, d])
    assert sorted([f.track_id for f in g] for g in groups) == [[1, 2], [3], [4]]
