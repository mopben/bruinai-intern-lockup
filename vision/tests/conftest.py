"""Shared test data: the repo's fixture run folders and the TypeScript golden file."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

import pytest

VISION_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = VISION_DIR.parent
FIXTURES_DIR = REPO_ROOT / "fixtures"
FIXTURE_NAMES = ("counter-a", "counter-b-fridge-closer", "counter-c-fourth-worker")
GOLDEN_PATH = VISION_DIR / "tests" / "golden" / "golden.json"


@cache
def golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text())


def golden_fixture(name: str) -> dict:
    return next(f for f in golden()["fixtures"] if f["fixture"] == name)


@pytest.fixture(params=FIXTURE_NAMES)
def fixture_name(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
def fixture_dir(fixture_name: str) -> Path:
    return FIXTURES_DIR / fixture_name


@pytest.fixture
def counter_a() -> Path:
    return FIXTURES_DIR / "counter-a"


def pytest_configure(config: pytest.Config) -> None:
    """Real-model tests (tests/ml) are marked `ml` and skip themselves unless DRYRUN_ML_TESTS=1."""
    config.addinivalue_line("markers", "ml: runs the real detector (opt-in with DRYRUN_ML_TESTS=1)")
