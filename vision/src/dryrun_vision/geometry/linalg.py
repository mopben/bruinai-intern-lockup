"""Small dense linear algebra, ported from src/camera/linalg.ts so results agree bit-for-bit-ish.

Least squares goes through the normal equations and a Gauss-Jordan solve with
partial pivoting, exactly as the TypeScript does, so the singularity checks
(and therefore the error messages) trigger on the same inputs.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]

PIVOT_REL_TOL = 1e-12
"""A pivot smaller than this times the largest entry means a singular system (linalg.ts)."""

DET_REL_TOL = 1e-12
"""|det| below this times scale**3 means a singular 3x3 matrix (linalg.ts)."""

TINY_SCALE = 1e-300
"""Floor for the matrix scale so an all-zero system is caught instead of dividing by zero."""


def frozen(a: FloatArray) -> FloatArray:
    """A read-only copy, so models built from it cannot be changed in place."""
    out = np.array(a, dtype=np.float64, copy=True)
    out.flags.writeable = False
    return out


def solve_square(a: Sequence[Sequence[float]], b: Sequence[float]) -> FloatArray | None:
    """Solves A x = b (A given as rows). None if (numerically) singular."""
    n = len(b)
    m = np.hstack([np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)[:, None]])
    scale = max(TINY_SCALE, float(np.abs(m[:, :n]).max(initial=0.0)))
    for col in range(n):
        pivot = col + int(np.argmax(np.abs(m[col:, col])))
        if abs(m[pivot, col]) < PIVOT_REL_TOL * scale:
            return None
        m[[col, pivot]] = m[[pivot, col]]
        p = m[col]
        for r in range(n):
            if r != col and m[r, col] != 0:
                m[r, col:] = m[r, col:] - (m[r, col] / p[col]) * p[col:]
    return m[:, n] / np.diag(m[:, :n])


def least_squares(a: Sequence[Sequence[float]], b: Sequence[float]) -> FloatArray | None:
    """min |A x - b| by the normal equations. None if rank-deficient."""
    if len(a) == 0:
        return None
    am = np.asarray(a, dtype=np.float64)
    n = am.shape[1]
    if n == 0 or am.shape[0] < n:
        return None
    bv = np.asarray(b, dtype=np.float64)
    return solve_square(am.T @ am, am.T @ bv)


def det3(m: FloatArray) -> float:
    return float(
        m[0, 0] * (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1])
        - m[0, 1] * (m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0])
        + m[0, 2] * (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0])
    )


def inv3(m: FloatArray) -> FloatArray | None:
    """Inverse of a 3x3 matrix, or None when (numerically) singular (same test as linalg.ts)."""
    d = det3(m)
    scale = float(np.abs(m).max())
    if not np.isfinite(d) or scale == 0 or abs(d) < DET_REL_TOL * scale**3:
        return None
    cof = np.array(
        [
            [
                m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1],
                -(m[0, 1] * m[2, 2] - m[0, 2] * m[2, 1]),
                m[0, 1] * m[1, 2] - m[0, 2] * m[1, 1],
            ],
            [
                -(m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0]),
                m[0, 0] * m[2, 2] - m[0, 2] * m[2, 0],
                -(m[0, 0] * m[1, 2] - m[0, 2] * m[1, 0]),
            ],
            [
                m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0],
                -(m[0, 0] * m[2, 1] - m[0, 1] * m[2, 0]),
                m[0, 0] * m[1, 1] - m[0, 1] * m[1, 0],
            ],
        ]
    )
    return cof / d
