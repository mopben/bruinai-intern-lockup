"""Labeller test setup: the opt-in `model` marker and shared fixtures (helpers in labels_helpers.py)."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

import pytest

from labelling.helpers import MODEL_TESTS_ENV, FakeProvider, by_brightness, write_video


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", f"model: needs real model weights or the dataset; runs only with {MODEL_TESTS_ENV}=1"
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get(MODEL_TESTS_ENV) == "1":
        return
    skip = pytest.mark.skip(reason=f"real-model test; set {MODEL_TESTS_ENV}=1 to run")
    for item in items:
        if "model" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def make_video(tmp_path: Path) -> Callable[..., Path]:
    def make(
        frames: int = 40, size: tuple[int, int] = (64, 48), fps: float = 10.0, name: str = "v.avi"
    ) -> Path:
        return write_video(tmp_path / name, frames, size, fps)

    return make


@pytest.fixture
def fake_provider() -> FakeProvider:
    return FakeProvider(by_brightness)
