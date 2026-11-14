"""MOTChallenge ground truth (gt/gt.txt of 3D MOT 2015): boxes with ids and ground positions.

Columns: frame (1-based), id, left, top, width, height, flag (1 evaluate, 0 ignore), x, y, z
(ground position in metres, z = 0). Frames are turned 0-based here to match tracks.jsonl.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.errors import FormatError

GT_COLUMNS = 10


@dataclass(frozen=True)
class GtBox:
    frame: int
    """0-based (gt.txt frame - 1)."""
    id: int
    x: float
    y: float
    w: float
    h: float
    flag: int
    """1: evaluated. 0: an ignore region (person not to be counted either way)."""
    ground: tuple[float, float]
    """Ground-plane (x, y) in metres, in the dataset's world frame (z up)."""


def _row(path: Path, no: int, line: str) -> GtBox:
    parts = line.split(",")
    if len(parts) != GT_COLUMNS:
        raise FormatError(
            f"{path.name} line {no}: expected {GT_COLUMNS} comma-separated values, got {len(parts)}."
        )
    try:
        frame, gid, flag = int(parts[0]), int(parts[1]), int(float(parts[6]))
        x, y, w, h, gx, gy = (float(parts[i]) for i in (2, 3, 4, 5, 7, 8))
    except ValueError as exc:
        raise FormatError(f"{path.name} line {no}: a value is not a number ({exc}).") from exc
    return GtBox(frame=frame - 1, id=gid, x=x, y=y, w=w, h=h, flag=flag, ground=(gx, gy))


def read_mot_gt(path: Path) -> tuple[GtBox, ...]:
    """All rows of a gt.txt, in file order."""
    if not path.is_file():
        raise FormatError(f"{path} does not exist. Give the path of gt/gt.txt.")
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise FormatError(f"{path} could not be read: {exc}") from exc
    return tuple(_row(path, i + 1, ln) for i, ln in enumerate(text.splitlines()) if ln.strip())
