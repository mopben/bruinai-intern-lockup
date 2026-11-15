from conftest import FIXTURES_DIR
from dryrun_vision.identity import worker_spots
from dryrun_vision.identity.constants import FILL_MAX_GAP_S, STITCH_MAX_GAP_S
from dryrun_vision.identity.workers import assign_workers, fill_workers
from dryrun_vision.kitchen import load_kitchen
from identity_helpers import frag, still, walk

KITCHEN = load_kitchen(FIXTURES_DIR / "counter-a")
SPOTS = worker_spots(KITCHEN)
RED = KITCHEN.home_station("red").stand
BLUE = KITCHEN.home_station("blue").stand
FRIDGE = (1.0, 2.67)


def test_global_assignment_prefers_the_track_that_rests_longest_at_the_spot():
    red_long = (frag(1, 0.0, 30.0, still(RED.x, RED.z)),)
    red_short = (frag(2, 31.0, 34.0, still(RED.x + 0.1, RED.z)),)
    blue = (frag(3, 0.0, 30.0, still(BLUE.x, BLUE.z)),)
    passer = (frag(4, 0.0, 5.0, walk((0.5, 2.0), (4.0, 2.0), 0.0, 5.0)),)
    assigned, left = assign_workers([red_short, red_long, blue, passer], SPOTS)
    assert assigned == {"red": red_long, "blue": blue}
    assert left == [red_short, passer]


def test_fill_joins_a_resting_leftover_and_a_trip_that_carries_on():
    first = {"red": (frag(1, 0.0, 30.0, still(RED.x, RED.z)),)}
    rest_again = (frag(2, 45.0, 60.0, still(RED.x, RED.z)),)  # back after 15 s, too long to stitch
    gap = STITCH_MAX_GAP_S + 2.0
    trip = (frag(3, 30.0 + gap, 36.0 + gap, walk((RED.x, RED.z + 0.3), FRIDGE, 30.0 + gap, 36.0 + gap)),)
    out, left = fill_workers(first, [trip, rest_again], SPOTS)
    assert [f.track_id for g in out["red"] for f in g] == [1, 2, 3]
    assert left == []


def test_fill_never_overlaps_and_never_guesses():
    first = {"red": (frag(1, 0.0, 30.0, still(RED.x, RED.z)),)}
    overlapping = (frag(2, 10.0, 20.0, still(RED.x, RED.z)),)
    far_later = (frag(3, 30.0 + FILL_MAX_GAP_S + 5, 80.0, walk((3.5, 2.5), (3.6, 2.5), 0, 1)),)
    out, left = fill_workers(first, [overlapping, far_later], SPOTS)
    assert out == {"red": (first["red"],)}
    assert left in ([overlapping, far_later], [far_later, overlapping])


def test_fill_joins_a_track_that_leads_into_the_workers_track():
    first = {"red": (frag(1, 40.0, 70.0, still(RED.x, RED.z)),)}
    before = (frag(2, 20.0, 34.0, walk(FRIDGE, (RED.x, RED.z + 0.3), 20.0, 34.0)),)
    out, _ = fill_workers(first, [before], SPOTS)
    assert [f.track_id for g in out["red"] for f in g] == [1, 2]
