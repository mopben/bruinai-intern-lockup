"""Minimum-cost one-to-one assignment (Hungarian / Kuhn-Munkres, O(n^3)), with a cost gate.

Used to give stitched tracks to workers, to link track fragments, and by the tracking metrics.
numpy only, so the base install (no SciPy) can use it. Fine for matrices of a few hundred rows.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]
_State = tuple[FloatArray, FloatArray, npt.NDArray[np.int_], npt.NDArray[np.int_]]
"""Working arrays of the solver: row potentials u, column potentials v, column owner p, path back."""


def _check(cost: Sequence[Sequence[float]]) -> int:
    widths = {len(row) for row in cost}
    if len(widths) > 1:
        raise ValueError("Every row of the cost matrix must have the same length.")
    return widths.pop() if widths else 0


def _padded(cost: Sequence[Sequence[float]], n_cols: int, max_cost: float) -> tuple[FloatArray, float]:
    """Square matrix; pairs above the gate (and padding) cost the same `forbidden` value."""
    allowed = [c for row in cost for c in row if c <= max_cost and math.isfinite(c)]
    n = max(len(cost), n_cols)
    hi, lo = max(allowed, default=0.0), min(allowed, default=0.0)
    # Dearer than any swap of allowed pairs can save, so more allowed pairs always win (costs may be < 0).
    forbidden = hi + (n + 1) * (hi - lo + 1.0)
    out = np.full((n, n), forbidden)
    raw = np.array(cost, dtype=np.float64).reshape(len(cost), n_cols)
    ok = np.isfinite(raw) & (raw <= max_cost)
    out[: len(cost), :n_cols] = np.where(ok, raw, forbidden)
    return out, forbidden


def _add_row(a: FloatArray, state: _State, i: int) -> None:
    """Adds row i (1-based) to the matching along a shortest augmenting path. Changes `state` only."""
    u, v, p, way = state
    n = a.shape[0]
    p[0], j0 = i, 0
    minv = np.full(n + 1, math.inf)
    used = np.zeros(n + 1, dtype=bool)
    while p[j0] != 0:
        used[j0] = True
        i0 = p[j0]
        free = ~used
        free[0] = False
        cur = np.concatenate(([math.inf], a[i0 - 1] - u[i0] - v[1:]))
        better = free & (cur < minv)
        minv[better] = cur[better]
        way[better] = j0
        masked = np.where(free, minv, math.inf)
        j0 = int(np.argmin(masked))
        delta = masked[j0]
        u[p[used]] += delta
        v[used] -= delta
        minv[~used] -= delta
    while j0 != 0:
        j1 = way[j0]
        p[j0] = p[j1]
        j0 = j1


def _solve_square(a: FloatArray) -> list[int]:
    """Column chosen for every row of a square matrix (shortest augmenting paths with potentials)."""
    n = a.shape[0]
    state: _State = (np.zeros(n + 1), np.zeros(n + 1), np.zeros(n + 1, dtype=int), np.zeros(n + 1, dtype=int))
    for i in range(1, n + 1):
        _add_row(a, state, i)
    p = state[2]
    row_to_col = [0] * n
    for j in range(1, n + 1):
        row_to_col[int(p[j]) - 1] = j - 1
    return row_to_col


def assign(cost: Sequence[Sequence[float]], max_cost: float = math.inf) -> tuple[tuple[int, int], ...]:
    """(row, column) pairs: the most pairs with cost <= max_cost, and of those the lowest total.

    Rectangular matrices are fine. A pair above `max_cost` (or infinite) is never returned, so rows
    and columns may stay unmatched. The input is not changed. Pairs are sorted by row.
    """
    n_cols = _check(cost)
    if not cost or n_cols == 0:
        return ()
    square, forbidden = _padded(cost, n_cols, max_cost)
    cols = _solve_square(square)
    return tuple(
        (i, j) for i, j in enumerate(cols) if i < len(cost) and j < n_cols and square[i][j] < forbidden
    )
