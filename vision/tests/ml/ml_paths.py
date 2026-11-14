"""Where the real-model tests find data and weights, and when they run.

DRYRUN_ML_TESTS=1 uv run pytest tests/ml      (weights in $RF_HOME, else vision/.weights)
"""

import os
from pathlib import Path

import pytest

VISION = Path(__file__).resolve().parents[2]
DATA = VISION / "data"
WEIGHTS = Path(os.environ.get("RF_HOME", VISION / ".weights"))

_reason = None
if os.environ.get("DRYRUN_ML_TESTS") != "1":
    _reason = "real-model test: set DRYRUN_ML_TESTS=1 to run"
elif not (WEIGHTS / "rf-detr-medium.pth").is_file():
    _reason = f"no RF-DETR weights in {WEIGHTS} (they download on the first `dryrun-vision track`)"

ML = [pytest.mark.ml, pytest.mark.skipif(_reason is not None, reason=_reason or "")]
"""pytestmark for every real-model test module."""
