"""Main regression test without ML: fixture positions -> corrupted person boxes -> identity ->
positions -> zone actions, compared with the zone actions of the fixture's own positions.

Corruptions (tests/synth.py): 30 fps source, 2 px box jitter, 5 % of boxes lost, six 0.6 s
occlusions per worker, blue's track id changes after a 1.5 s gap at t = 40 s, two customers just
outside the room. The camera is the fixture's golden box-tops calibration (exact here).
"""

from functools import cache

import pytest

from compare import coverage, floor_errors, label_agreement, segment_match
from conftest import FIXTURES_DIR
from dryrun_vision.actions import SegmentationResult, segment_actions
from dryrun_vision.formats import ACTION_KINDS, read_positions
from dryrun_vision.geometry import model_from_calibration
from dryrun_vision.identity import IdentityResult, identify
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.positions import PositionsResult, build_positions
from synth import Corruption, SynthTracks, fixture_tracks

FIXTURES = ("counter-a", "counter-c-fourth-worker")
SEEDS = (7, 1, 3)
"""Three random draws of the same corruptions, so a pass is not one lucky draw."""
CASES = [(f, seed) for f in FIXTURES for seed in SEEDS]

# How the thresholds below were set (2026-11-14): `uv run python tests/synthetic_sweep.py --extra-seeds`
# runs exactly this chain on these 3 seeds plus seeds 11 and 23, on both fixtures (10 runs). The
# numbers quoted are the extremes over those 10 runs. Where a threshold has little margin it says
# so; none was moved to make a failing run pass.

MAX_MEAN_FLOOR_CM = 3.0
"""Per worker. Measured: worst worker's mean 1.87-1.99 cm. Margin about 1 cm."""
MAX_WORST_FLOOR_CM = 10.0
"""Per worker. Measured: single worst sample 6.3-7.7 cm. Margin about 2 cm."""
MIN_COVERAGE = 0.92
"""Share of the fixture's 10 Hz ticks we give a sample for. 5 % lost boxes and the occlusions are
bridged; the 1.5 s id-change gap is not (it is longer than MAX_BRIDGE_S). Measured: 0.931-0.953.
Margin only 0.011: a change that loses one more short hole per worker would trip it."""
MIN_LABEL_AGREEMENT = 0.90
"""Share of 0.1 s ticks where our (kind, box) equals the fixture's. Measured: worst worker
0.907-0.962; the misses sit near segment boundaries and across blue's gap. Margin only 0.007."""
TRIP_BOUNDARY_S = 0.8
"""Seconds. Every fetch/carry trip of the fixture is found, same kind and box, both ends within this.
Measured: worst end 0.41-0.71 s (20 of 20 trips in all 10 runs). An earlier build measured 0.79 s
on other seeds, which is why it is 0.8 and not lower; margin now about one 10 Hz sample."""


COUNT_SLACK = {"fetch": 0, "carry": 0, "work": 2, "walk": 4, "idle": 4}
"""Allowed difference in the number of segments of each kind. Measured: fetch, carry and idle exact;
work 0 to +2; walk -4 to +4 (walks are short and split or merge with small changes in the rest flags).
The work and walk slacks equal the measured extremes: no margin."""


@cache
def _run(
    fixture: str, seed: int = SEEDS[0]
) -> tuple[SynthTracks, IdentityResult, PositionsResult, SegmentationResult, SegmentationResult]:
    s = fixture_tracks(fixture, Corruption(seed=seed))
    kitchen = load_kitchen(FIXTURES_DIR / fixture)
    model = model_from_calibration(s.calibration)
    ident = identify(s.detections, model, s.calibration, kitchen, "head")
    pos = build_positions(ident, model, s.calibration, kitchen, anchor="head")
    ours = segment_actions(kitchen, pos.samples)
    ref = segment_actions(kitchen, read_positions(FIXTURES_DIR / fixture / "positions.jsonl").samples)
    return s, ident, pos, ours, ref


@pytest.mark.parametrize(("fixture", "seed"), CASES)
def test_every_worker_is_recovered_with_the_right_id(fixture: str, seed: int):
    s, ident, _, _, _ = _run(fixture, seed)
    assert {p.name for p in ident.people} == set(s.positions)
    for p in ident.people:
        assert {s.truth[t] for t in p.track_ids} == {p.name}
    blue = next(p for p in ident.people if p.name == "blue")
    assert len(blue.track_ids) == 2  # the id change was stitched
    customers = {t for t, w in s.truth.items() if w == "customer"}
    dropped = {t for d in ident.dropped for t in d.track_ids}
    assert customers <= dropped
    assert all(
        d.reason == "never inside the working area" for d in ident.dropped if set(d.track_ids) & customers
    )


def test_shared_station_is_warned_about():
    _, ident, _, _, _ = _run("counter-c-fourth-worker")
    assert any("share station" in w for w in ident.warnings)
    _, ident_a, _, _, _ = _run("counter-a")
    assert ident_a.warnings == ()


@pytest.mark.parametrize(("fixture", "seed"), CASES)
def test_floor_error_and_coverage(fixture: str, seed: int):
    s, _, pos, _, _ = _run(fixture, seed)
    assert pos.rejected == {}
    for e in floor_errors(pos.samples, s.positions):
        assert e.mean_cm < MAX_MEAN_FLOOR_CM, e
        assert e.worst_cm < MAX_WORST_FLOOR_CM, e
    for w, share in coverage(pos.samples, s.positions).items():
        assert share > MIN_COVERAGE, (w, share)


@pytest.mark.parametrize(("fixture", "seed"), CASES)
def test_zone_actions_match_the_fixtures_own(fixture: str, seed: int):
    s, _, _, ours, ref = _run(fixture, seed)
    for w in s.positions:
        same, _ = label_agreement(ours.segments, ref.segments, w)
        assert same > MIN_LABEL_AGREEMENT, (w, same)
    trips = segment_match(ours.segments, ref.segments, frozenset({"fetch", "carry"}))
    assert trips.matched == trips.total == len(ref.trips) == len(ours.trips)
    assert trips.boundary_worst_s <= TRIP_BOUNDARY_S
    for kind in ACTION_KINDS:
        n_ours = sum(1 for x in ours.segments if x.kind == kind)
        n_ref = sum(1 for x in ref.segments if x.kind == kind)
        assert abs(n_ours - n_ref) <= COUNT_SLACK[kind], (kind, n_ours, n_ref)


def test_counter_b_also_works():
    s = fixture_tracks("counter-b-fridge-closer")
    kitchen = load_kitchen(FIXTURES_DIR / "counter-b-fridge-closer")
    model = model_from_calibration(s.calibration)
    ident = identify(s.detections, model, s.calibration, kitchen)
    assert {p.name for p in ident.people} == set(s.positions)
