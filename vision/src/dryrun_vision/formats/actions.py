"""actions.jsonl: what each worker was doing when.

    {"type":"header","format":"dryrun.actions","version":1,"startedAt":"...","source":"zones"}
    {"type":"action","workerId":"red","t0":1.4,"t1":2.8,"kind":"work","boxId":"<station>"}

Kinds: `work` (still at a station's stand point; boxId = station), `fetch` (round
trip to a storage box; boxId = storage), `carry` (trip to the pickup or another
station; boxId = destination), `walk` (moving, no known trip; no boxId), `idle`
(still away from any stand point; no boxId). `label`/`confidence` are optional and
written only by an ML labeller. Times are seconds since run start, 3 decimals.
Per worker, segments do not overlap and t1 > t0 (after rounding); gaps are allowed. The
writer sorts by t0, then workerId. The reader, like the TypeScript one, accepts any worker order
at equal t0 and sorts lines that are out of t0 order (with a warning).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from itertools import pairwise
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, field_serializer, model_validator

from dryrun_vision.errors import FormatError
from dryrun_vision.formats.base import (
    IsoDateTime,
    Items,
    NonEmpty,
    ProductModel,
    Seconds,
    log,
    parse_jsonl,
    round_time,
    write_jsonl,
)

ActionKind = Literal["work", "fetch", "carry", "walk", "idle"]
ACTION_KINDS: tuple[ActionKind, ...] = ("work", "fetch", "carry", "walk", "idle")
KINDS_WITH_BOX: frozenset[str] = frozenset({"work", "fetch", "carry"})
ActionsSource = Literal["zones", "zones+model"]


class ActionsHeader(ProductModel):
    type: Literal["header"] = "header"
    format: Literal["dryrun.actions"] = "dryrun.actions"
    version: Literal[1] = 1
    started_at: IsoDateTime
    source: ActionsSource
    model: NonEmpty | None = None
    """Name of the ML labeller, when source is "zones+model"."""


class ActionSegment(ProductModel):
    type: Literal["action"] = "action"
    worker_id: NonEmpty
    t0: Seconds
    t1: Seconds
    kind: ActionKind
    box_id: NonEmpty | None = None
    label: NonEmpty | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not round_time(self.t1) > round_time(self.t0):
            raise ValueError(f"t1 ({self.t1}) must be later than t0 ({self.t0})")
        if self.kind in KINDS_WITH_BOX and self.box_id is None:
            raise ValueError(f'a "{self.kind}" action needs a boxId')
        if self.kind not in KINDS_WITH_BOX and self.box_id is not None:
            raise ValueError(f'a "{self.kind}" action must not have a boxId')
        if (self.label is None) != (self.confidence is None):
            raise ValueError("label and confidence are written together (both or neither)")
        return self

    @field_serializer("t0", "t1")
    def _round(self, t: float) -> float:
        return round_time(t)

    @property
    def duration(self) -> float:
        return self.t1 - self.t0


class ActionsFile(ProductModel):
    header: ActionsHeader
    segments: Items[ActionSegment]


def _file_order(s: ActionSegment) -> tuple[float, str]:
    return (round_time(s.t0), s.worker_id)


def find_overlap(segments: Sequence[ActionSegment]) -> str | None:
    """A plain sentence about the first pair of one worker's segments that overlap, else None."""
    last_end: dict[str, float] = {}
    for s in sorted(segments, key=lambda s: (s.worker_id, s.t0)):
        prev = last_end.get(s.worker_id)
        if prev is not None and round_time(s.t0) < round_time(prev):
            return f'segments of worker "{s.worker_id}" overlap at t={round_time(s.t0)} s'
        last_end = {**last_end, s.worker_id: s.t1}
    return None


def _warn_order(path_name: str, body: Sequence[tuple[int, ActionSegment]]) -> None:
    late = next((no for (_, a), (no, b) in pairwise(body) if round_time(b.t0) < round_time(a.t0)), None)
    if late is not None:
        log.warning("%s line %d: lines are not in t0 order; they were sorted", path_name, late)


def read_actions(path: Path) -> ActionsFile:
    """Reads actions.jsonl in file order (t0, then workerId); fails on overlapping segments."""
    header, body = parse_jsonl(path, ActionsHeader, ActionSegment.model_validate_json, tagged_union=False)
    _warn_order(path.name, body)
    segments = sort_segments(s for _, s in body)
    overlap = find_overlap(segments)
    if overlap:
        raise FormatError(f"{path.name}: {overlap}.")
    return ActionsFile(header=header, segments=segments)


def sort_segments(segments: Iterable[ActionSegment]) -> tuple[ActionSegment, ...]:
    """File order: by t0, then workerId."""
    return tuple(sorted(segments, key=_file_order))


def write_actions(path: Path, header: ActionsHeader, segments: Iterable[ActionSegment]) -> None:
    """Writes actions.jsonl in file order. Refuses overlapping segments."""
    ordered = sort_segments(segments)
    overlap = find_overlap(ordered)
    if overlap:
        raise FormatError(f"Not writing {path.name}: {overlap}.")
    write_jsonl(path, header, ordered)
