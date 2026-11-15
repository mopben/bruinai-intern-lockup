"""The review table (review.csv): one row per action segment, by worker then time, with empty
columns for a person to fill in.

Columns to fill (empty = keep):
- correct_kind: work, fetch, carry, walk, idle, or "delete" to drop the segment.
- correct_box: the box id, when the corrected kind is work, fetch or carry and the segment had none.
- correct_label: the right words, or "-" to remove the model's label.
- correct_t0, correct_t1: new start or end, in seconds (the same clock as actions.jsonl).
- note: free text, kept in the provenance file.
"""

from __future__ import annotations

import csv
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import ActionSegment, ActionsFile
from dryrun_vision.formats.base import round_time

REVIEW_COLUMNS: tuple[str, ...] = (
    "row", "worker", "t0", "t1", "kind", "box_id", "station", "model_label", "model_confidence",
    "correct_kind", "correct_box", "correct_label", "correct_t0", "correct_t1", "note",
)  # fmt: skip
CORRECTION_COLUMNS: tuple[str, ...] = REVIEW_COLUMNS[9:]
REMOVE_LABEL = "-"
DELETE = "delete"


@dataclass(frozen=True)
class ReviewRow:
    row: int
    worker: str
    t0: float
    t1: float
    correct_kind: str
    correct_box: str
    correct_label: str
    correct_t0: str
    correct_t1: str
    note: str

    @property
    def touched(self) -> bool:
        return any(
            (self.correct_kind, self.correct_box, self.correct_label, self.correct_t0, self.correct_t1)
        )


def review_order(segments: tuple[ActionSegment, ...]) -> tuple[ActionSegment, ...]:
    """By worker, then time: the order of the review table's rows."""
    return tuple(sorted(segments, key=lambda s: (s.worker_id, round_time(s.t0))))


def _number(value: float | None) -> str:
    return "" if value is None else f"{round_time(value):g}"


def write_review(path: Path, actions: ActionsFile, box_names: Mapping[str, str]) -> None:
    """Writes the table for `actions`; the correction columns are empty."""
    try:
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(REVIEW_COLUMNS)
            for i, s in enumerate(review_order(actions.segments), start=1):
                box = s.box_id or ""
                confidence = "" if s.confidence is None else f"{s.confidence:g}"
                fixed = [i, s.worker_id, _number(s.t0), _number(s.t1), s.kind, box, box_names.get(box, box)]
                w.writerow([*fixed, s.label or "", confidence, *([""] * len(CORRECTION_COLUMNS))])
    except OSError as exc:
        raise FormatError(f"{path} could not be written: {exc}") from exc


def _row(path: Path, line: int, raw: Mapping[str, str]) -> ReviewRow:
    def text(key: str) -> str:
        return (raw.get(key) or "").strip()

    try:
        number, t0, t1 = int(text("row")), float(text("t0")), float(text("t1"))
    except ValueError as exc:
        raise FormatError(f"{path.name} line {line}: row, t0 and t1 must be numbers.") from exc
    return ReviewRow(number, text("worker"), t0, t1, *(text(c) for c in CORRECTION_COLUMNS))


def read_review(path: Path) -> tuple[ReviewRow, ...]:
    """Reads a filled-in review table. Raises FormatError naming the line for a malformed one."""
    if not path.is_file():
        raise FormatError(f"{path} does not exist.")
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REVIEW_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise FormatError(
                f"{path.name} lacks the columns {', '.join(missing)}. Start from review-table's file."
            )
        rows = tuple(_row(path, i, raw) for i, raw in enumerate(reader, start=2))
    numbers = [r.row for r in rows]
    if len(set(numbers)) != len(numbers):
        raise FormatError(f"{path.name}: two lines have the same row number.")
    return rows
