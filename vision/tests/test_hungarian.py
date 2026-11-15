import itertools
import math
import random

import pytest

from dryrun_vision.hungarian import assign


def _brute(cost: list[list[float]], max_cost: float) -> tuple[int, float]:
    """Best (-pairs, total cost) over all full matchings, leaving out pairs above the gate."""
    n_rows, n_cols = len(cost), len(cost[0])
    if n_rows <= n_cols:
        options = [tuple(enumerate(cols)) for cols in itertools.permutations(range(n_cols), n_rows)]
    else:
        options = [
            tuple((r, c) for c, r in enumerate(rows))
            for rows in itertools.permutations(range(n_rows), n_cols)
        ]
    return min(_score(cost, tuple((r, c) for r, c in pairs if cost[r][c] <= max_cost)) for pairs in options)


def _score(cost: list[list[float]], pairs: tuple[tuple[int, int], ...]) -> tuple[int, float]:
    return (-len(pairs), sum(cost[r][c] for r, c in pairs))


def test_simple_square():
    cost = [[4.0, 1.0, 3.0], [2.0, 0.0, 5.0], [3.0, 2.0, 2.0]]
    assert sorted(assign(cost)) == [(0, 1), (1, 0), (2, 2)]


def test_rectangular_and_empty():
    assert assign([[1.0, 0.0, 5.0]]) == ((0, 1),)
    assert sorted(assign([[1.0], [0.5], [3.0]])) == [(1, 0)]
    assert assign([]) == ()
    assert assign([[], []]) == ()


def test_prefers_more_pairs_over_lower_total():
    cost = [[0.0, 0.9], [0.9, 5.0]]
    assert sorted(assign(cost, max_cost=1.0)) == [(0, 1), (1, 0)]


def test_negative_costs():
    cost = [[-20.0, math.inf], [math.inf, -3.0], [-1.0, math.inf]]
    assert sorted(assign(cost)) == [(0, 0), (1, 1)]


def test_gate_leaves_pairs_unmatched():
    cost = [[0.5, 9.0], [9.0, 9.0]]
    assert assign(cost, max_cost=1.0) == ((0, 0),)


def test_infinite_cost_is_never_used():
    cost = [[math.inf, 1.0], [math.inf, 2.0]]
    assert assign(cost) == ((0, 1),)


def test_input_is_not_changed():
    cost = [[1.0, 2.0], [3.0, 4.0]]
    copy = [row[:] for row in cost]
    assign(cost, max_cost=2.5)
    assert cost == copy


@pytest.mark.parametrize("seed", range(40))
def test_matches_brute_force(seed: int):
    rng = random.Random(seed)
    n_rows, n_cols = rng.randint(1, 5), rng.randint(1, 5)
    offset = rng.choice([0.0, -30.0])
    cost = [[rng.uniform(0, 10) + offset for _ in range(n_cols)] for _ in range(n_rows)]
    gate = rng.choice([math.inf, 5.0 + offset])
    pairs = assign(cost, max_cost=gate)
    assert len({r for r, _ in pairs}) == len(pairs) == len({c for _, c in pairs})
    assert all(cost[r][c] <= gate for r, c in pairs)
    got, best = _score(cost, pairs), _brute(cost, gate)
    assert got[0] == best[0]
    assert got[1] == pytest.approx(best[1])


def test_rejects_ragged_rows():
    with pytest.raises(ValueError, match="same length"):
        assign([[1.0, 2.0], [1.0]])
