import random
from itertools import pairwise

import pytest

from dryrun_vision.labels.merge import merge_runs
from dryrun_vision.labels.smoothing import Decision, smooth_decisions
from dryrun_vision.labels.windows import Window

L = ("a", "b", "c")
A, B, C = (0.8, 0.1, 0.1), (0.1, 0.8, 0.1), (0.1, 0.1, 0.8)


def labels(ds: tuple[Decision, ...]) -> list[str | None]:
    return [d.label for d in ds]


def test_width_one_is_argmax_with_threshold():
    ds = smooth_decisions([A, B, (0.4, 0.35, 0.25)], L, width=1, min_confidence=0.5)
    assert labels(ds) == ["a", "b", None]
    assert ds[0].confidence == pytest.approx(0.8)
    assert ds[2].confidence is None


def test_majority_removes_a_single_flip():
    ds = smooth_decisions([A, A, B, A, A], L, width=3, min_confidence=0.0)
    assert labels(ds) == ["a"] * 5
    assert ds[2].confidence == pytest.approx((0.8 + 0.1 + 0.8) / 3)


def test_smoothed_confidence_can_fall_below_threshold():
    ds = smooth_decisions([A, A, B, A, A], L, width=3, min_confidence=0.6)
    assert labels(ds) == ["a", None, None, None, "a"]  # (0.8 + 0.8 + 0.1) / 3 < 0.6 next to the flip


def test_tie_keeps_own_label():
    ds = smooth_decisions([A, B], L, width=3, min_confidence=0.0)
    assert labels(ds) == ["a", "b"]


def test_tie_without_own_label_takes_highest_total_probability():
    a_weak, b_strong = (0.5, 0.4, 0.1), (0.1, 0.9, 0.0)
    ds = smooth_decisions([a_weak, a_weak, C, b_strong, b_strong], L, width=5, min_confidence=0.0)
    assert ds[2].label == "b"  # votes a:2, b:2, c:1 (own); b has the higher total probability
    ds2 = smooth_decisions([(0.5, 0.3, 0.2), None, (0.2, 0.7, 0.1)], L, width=3, min_confidence=0.0)
    assert ds2[1] == Decision(None, None)


def test_windows_without_scores_get_no_label_and_do_not_vote():
    ds = smooth_decisions([A, None, B, B], L, width=3, min_confidence=0.0)
    assert labels(ds) == ["a", None, "b", "b"]


def test_width_must_be_odd_and_positive():
    with pytest.raises(ValueError, match="odd"):
        smooth_decisions([A], L, width=2, min_confidence=0.0)


def test_merge_joins_equal_neighbours_weighting_confidence_by_time():
    ws = (Window(0, 2), Window(2, 4), Window(4, 5), Window(5, 7))
    ds = (Decision("a", 0.6), Decision("a", 0.9), Decision(None, None), Decision(None, None))
    out = merge_runs(ws, ds)
    assert out == ((Window(0, 4), Decision("a", 0.75)), (Window(4, 7), Decision(None, None)))


def test_merge_weights_unequal_windows():
    out = merge_runs((Window(0, 1), Window(1, 4)), (Decision("a", 0.4), Decision("a", 0.8)))
    assert out[0][1].confidence == pytest.approx(0.7)


def test_merge_property_tiles_and_alternates():
    rng = random.Random(11)
    for _ in range(200):
        n = rng.randint(1, 12)
        edges = sorted({0.0, *(round(rng.uniform(0, 30), 3) for _ in range(n)), 31.0})
        ws = tuple(Window(a, b) for a, b in pairwise(edges))
        ds = tuple(
            Decision(lab, None if lab is None else rng.random())
            for lab in (rng.choice(["a", "b", None]) for _ in ws)
        )
        out = merge_runs(ws, ds)
        assert out[0][0].t0 == ws[0].t0 and out[-1][0].t1 == ws[-1].t1
        assert all(x[0].t1 == y[0].t0 for x, y in pairwise(out))
        assert all(x[1].label != y[1].label for x, y in pairwise(out))
