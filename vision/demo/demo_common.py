"""Shared paths, errors and small helpers for the demo build (see build_demo.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

VISION = Path(__file__).resolve().parent.parent
REPO = VISION.parent
DEMO = VISION / "demo"
DATA_OUT = DEMO / "data"
MEDIA_OUT = DEMO / "media"

PIXEL_DIGITS = 0
METRE_DIGITS = 2
SECOND_DIGITS = 2
SHARE_DIGITS = 6


class DemoError(Exception):
    """An input is missing or does not look right; the message is a plain sentence for the reader."""


def require(path: Path, what: str, hint: str) -> Path:
    """The path if it exists, else a DemoError that says what it is and how to make it."""
    if not path.exists():
        raise DemoError(f"{what} is missing: {path}. {hint}")
    return path


def px(v: float) -> int:
    return int(round(v, PIXEL_DIGITS))


def metres(v: float) -> float:
    return round(v, METRE_DIGITS)


def seconds(v: float) -> float:
    return round(v, SECOND_DIGITS)


def share(v: float) -> float:
    return round(v, SHARE_DIGITS)


def write_json(name: str, data: Any) -> Path:  # noqa: ANN401
    """Writes data/<name>.json compactly; returns the path."""
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    path = DATA_OUT / f"{name}.json"
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")
    return path


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
