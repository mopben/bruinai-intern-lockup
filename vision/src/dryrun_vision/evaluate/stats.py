"""A small summary of a set of numbers."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

P_LOW, P_MID, P_HIGH = 10, 50, 90
"""Percentiles reported (linear interpolation, the same as src/core/stats.ts quantile)."""


@dataclass(frozen=True)
class Distribution:
    n: int
    mean: float | None
    p10: float | None
    p50: float | None
    p90: float | None
    max: float | None


def distribution(values: Sequence[float]) -> Distribution:
    """n, mean, p10/p50/p90 and max; all None (except n = 0) for no values."""
    if not values:
        return Distribution(0, None, None, None, None, None)
    a = np.asarray(values, dtype=np.float64)
    p = np.percentile(a, [P_LOW, P_MID, P_HIGH])
    return Distribution(len(a), float(a.mean()), float(p[0]), float(p[1]), float(p[2]), float(a.max()))
