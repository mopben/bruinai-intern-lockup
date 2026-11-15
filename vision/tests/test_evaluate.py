import json
from pathlib import Path

import pytest

from dryrun_vision.actions import segment_actions
from dryrun_vision.evaluate import NEAR_TAP_S, evaluate_actions, format_report, report_to_json
from dryrun_vision.evaluate.taps_match import match_done_taps
from dryrun_vision.evaluate.time_share import time_share
from dryrun_vision.formats import ActionSegment, DoneEvent, PositionSample, read_run_folder
from dryrun_vision.kitchen import load_kitchen


def _seg(w, t0, t1, kind, box=None):
    return ActionSegment(worker_id=w, t0=t0, t1=t1, kind=kind, box_id=box)


def _done(t, w, station="S", order="o1", step=0):
    return DoneEvent(t=t, order_id=order, step=step, station_id=station, worker_id=w)


def test_tap_inside_and_near_and_unmatched():
    segs = (_seg("red", 0, 5, "work", "S"), _seg("red", 5, 9, "carry", "P"), _seg("red", 9, 12, "work", "S"))
    taps = (
        _done(4.0, "red"),
        _done(13.5, "red", order="o2"),
        _done(30.0, "red", order="o3"),
        _done(4.5, "blue", order="o4"),
    )
    s = match_done_taps(taps, segs)
    assert s.taps == 4
    assert s.containing == 1 and s.near == 1 and s.unmatched == 2
    assert s.abs_end_offset_s.n == 2
    assert s.abs_end_offset_s.p50 == pytest.approx((1.0 + 1.5) / 2)
    m = s.matches[1]
    assert m.segment_t1 == 12 and m.end_offset_s == pytest.approx(-1.5)


def test_tap_without_worker_matches_any_worker_at_station():
    segs = (_seg("blue", 0, 5, "work", "S"),)
    s = match_done_taps((_done(4.0, None),), segs)
    assert s.containing == 1 and s.without_worker_id == 1


def test_shared_segments_are_counted():
    segs = (_seg("red", 0, 50, "work", "S"),)
    s = match_done_taps((_done(4.0, "red"), _done(9.0, "red", order="o2")), segs)
    assert s.containing == 2 and s.taps_on_shared_segment == 2
    assert s.abs_end_offset_unshared_s.n == 0 and s.abs_end_offset_unshared_s.p50 is None
    assert NEAR_TAP_S > 0


def test_time_share_fractions():
    segs = (_seg("red", 0, 6, "work", "S"), _seg("red", 6, 8, "walk"))
    samples = (
        PositionSample(t=0.0, worker_id="red", x=0, z=0),
        PositionSample(t=10.0, worker_id="red", x=0, z=0),
    )
    ts = time_share(segs, samples)
    assert ts[0].observed_s == 10
    assert ts[0].fraction["work"] == pytest.approx(0.6)
    assert ts[0].fraction["walk"] == pytest.approx(0.2)
    assert ts[0].fraction["fetch"] == 0
    assert ts[0].uncovered == pytest.approx(0.2)


def test_fixture_report(fixture_dir: Path):
    run = read_run_folder(fixture_dir)
    k = load_kitchen(fixture_dir)
    segs = segment_actions(k, run.positions.samples).segments
    rep = evaluate_actions(run, k, segs, source="zones")
    assert rep.taps.taps == len(run.taps.done_events())
    assert rep.taps.containing + rep.taps.near + rep.taps.unmatched == rep.taps.taps
    assert sum(f.implied_by_orders for f in rep.fetch) == len(run.taps.order_events())
    for w in rep.time_share:
        assert sum(w.fraction.values()) + w.uncovered == pytest.approx(1.0)
    text = format_report(rep)
    assert "done taps" in text and "Milk fridge" in text
    assert json.loads(json.dumps(report_to_json(rep)))["run"] == fixture_dir.name
