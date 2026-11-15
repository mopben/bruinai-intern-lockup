"""Apply a filled-in review table to actions.jsonl, and say where every kind and label came from."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

from pydantic import ValidationError

from dryrun_vision.errors import DryRunError
from dryrun_vision.formats import ACTION_KINDS, ActionSegment, ActionsFile, read_actions, write_actions
from dryrun_vision.formats.actions import KINDS_WITH_BOX
from dryrun_vision.formats.base import round_time, validation_message
from dryrun_vision.review.provenance import (
    Provenance,
    ProvenanceCounts,
    SegmentProvenance,
    provenance_path,
    write_provenance,
)
from dryrun_vision.review.table import DELETE, REMOVE_LABEL, ReviewRow, read_review, review_order

HUMAN_CONFIDENCE = 1.0
"""actions.jsonl needs a confidence with every label; a person's label gets 1 (the provenance file
says it came from a person)."""
HUMAN_MODEL_NAME = "human review"
"""Header `model` when only people wrote labels (the format needs a name with source zones+model)."""


class ReviewError(DryRunError):
    """A review table that does not fit its actions.jsonl, or corrections that break the format."""


@dataclass(frozen=True)
class ReviewResult:
    actions: ActionsFile
    provenance: Provenance


@dataclass(frozen=True)
class _Outcome:
    original: ActionSegment
    row: ReviewRow | None
    result: ActionSegment | None
    """None: deleted."""


def _key(worker: str, t0: float, t1: float) -> tuple[str, float, float]:
    return (worker, round_time(t0), round_time(t1))


def _match(actions: ActionsFile, rows: Sequence[ReviewRow]) -> dict[tuple[str, float, float], ReviewRow]:
    known = {_key(s.worker_id, s.t0, s.t1) for s in actions.segments}
    out: dict[tuple[str, float, float], ReviewRow] = {}
    for r in rows:
        key = _key(r.worker, r.t0, r.t1)
        if key not in known:
            raise ReviewError(
                f"row {r.row}: no {r.worker} segment from {r.t0:g} to {r.t1:g} in the actions file."
            )
        out = {**out, key: r}
    return out


def _time(row: ReviewRow, column: str, text: str, default: float) -> float:
    if not text:
        return default
    try:
        return float(text)
    except ValueError as exc:
        raise ReviewError(f'row {row.row}: {column} "{text}" is not a number of seconds.') from exc


def _kind_and_box(seg: ActionSegment, row: ReviewRow) -> tuple[str, str | None]:
    kind = row.correct_kind or seg.kind
    if kind not in ACTION_KINDS:
        kinds = ", ".join(ACTION_KINDS)
        raise ReviewError(f'row {row.row}: "{kind}" is not a kind (use {kinds}, or {DELETE}).')
    if kind not in KINDS_WITH_BOX:
        return kind, None
    box = row.correct_box or seg.box_id
    if box is None:
        raise ReviewError(f"row {row.row}: a {kind} needs a box; fill correct_box with the box id.")
    return kind, box


def _label(seg: ActionSegment, row: ReviewRow) -> tuple[str | None, float | None]:
    if row.correct_label == REMOVE_LABEL:
        return None, None
    if row.correct_label:
        return row.correct_label, HUMAN_CONFIDENCE
    return seg.label, seg.confidence


def _corrected(seg: ActionSegment, row: ReviewRow) -> ActionSegment | None:
    if row.correct_kind == DELETE:
        return None
    kind, box = _kind_and_box(seg, row)
    label, confidence = _label(seg, row)
    t0 = _time(row, "correct_t0", row.correct_t0, seg.t0)
    t1 = _time(row, "correct_t1", row.correct_t1, seg.t1)
    try:
        return ActionSegment(
            worker_id=seg.worker_id, t0=t0, t1=t1, kind=kind, box_id=box, label=label, confidence=confidence
        )
    except ValidationError as exc:
        raise ReviewError(f"row {row.row}: {validation_message(exc)}.") from exc


def _outcomes(actions: ActionsFile, rows: Sequence[ReviewRow]) -> tuple[_Outcome, ...]:
    edits = _match(actions, rows)
    out: list[_Outcome] = []
    for seg in review_order(actions.segments):
        row = edits.get(_key(seg.worker_id, seg.t0, seg.t1))
        result = _corrected(seg, row) if row is not None and row.touched else seg
        out.append(_Outcome(seg, row, result))
    return tuple(out)


def _span(s: ActionSegment) -> str:
    return f"{round_time(s.t0):g}-{round_time(s.t1):g} s"


def _check_overlaps(outcomes: Sequence[_Outcome]) -> None:
    kept = [o for o in outcomes if o.result]
    kept.sort(key=lambda o: (o.original.worker_id, round_time(o.result.t0 if o.result else 0.0)))
    for a, b in pairwise(kept):
        sa, sb = a.result, b.result
        if sa and sb and sa.worker_id == sb.worker_id and round_time(sb.t0) < round_time(sa.t1):
            ra = a.row.row if a.row else "?"
            rb = b.row.row if b.row else "?"
            raise ReviewError(
                f"row {ra} and row {rb}: {sa.worker_id}'s segments would overlap "
                f"({_span(sa)} and {_span(sb)}). "
                "Move a time, or delete one of them."
            )


def _label_fate(o: _Outcome) -> str | None:
    """For a model label: kept, changed or removed. For an unlabelled segment: added or None."""
    had = o.original.label is not None
    now = o.result.label if o.result else None
    if not had:
        return "added" if now is not None else None
    if now is None:
        return "removed"
    same = o.result is not None and o.result.confidence == o.original.confidence
    return "kept" if now == o.original.label and same else "changed"


def _times(s: ActionSegment) -> tuple[float, float]:
    return (round_time(s.t0), round_time(s.t1))


def _counts(outcomes: Sequence[_Outcome]) -> ProvenanceCounts:
    fates = Counter(_label_fate(o) for o in outcomes)
    live = [o for o in outcomes if o.result]
    return ProvenanceCounts(
        model_labels=sum(1 for o in outcomes if o.original.label is not None),
        model_labels_kept=fates["kept"], model_labels_changed=fates["changed"],
        model_labels_removed=fates["removed"], labels_added_by_hand=fates["added"],
        kinds_changed=sum(1 for o in live if o.result and o.result.kind != o.original.kind),
        times_changed=sum(1 for o in live if o.result and _times(o.result) != _times(o.original)),
        segments_deleted=len(outcomes) - len(live),
    )  # fmt: skip


def _segment_provenance(o: _Outcome) -> SegmentProvenance:
    r = o.result
    assert r is not None  # only called for kept segments
    changed_kind = (r.kind, r.box_id, r.t0, r.t1) != (
        o.original.kind,
        o.original.box_id,
        o.original.t0,
        o.original.t1,
    )
    fate = _label_fate(o)
    label = "none" if r.label is None else "human" if fate in ("changed", "added") else "model"
    return SegmentProvenance(
        worker_id=r.worker_id, t0=round_time(r.t0), t1=round_time(r.t1),
        kind="human" if changed_kind else "zones",
        label=label, review_row=o.row.row if o.row else None, note=(o.row.note or None) if o.row else None,
    )  # fmt: skip


def apply_review(actions_path: Path, review_path: Path, out: Path) -> ReviewResult:
    """Writes `out` (actions.jsonl) and its provenance sidecar. Nothing is written if a row is wrong."""
    actions = read_actions(actions_path)
    outcomes = _outcomes(actions, read_review(review_path))
    _check_overlaps(outcomes)
    segments = tuple(o.result for o in outcomes if o.result)
    header = actions.header
    if header.source == "zones" and any(s.label for s in segments):
        header = header.model_copy(update={"source": "zones+model", "model": HUMAN_MODEL_NAME})
    result = ActionsFile(header=header, segments=segments)
    provenance = Provenance(
        actions=out.name, based_on=actions_path.name, review=review_path.name, counts=_counts(outcomes),
        segments=tuple(_segment_provenance(o) for o in outcomes if o.result),
    )  # fmt: skip
    write_actions(out, header, segments)
    write_provenance(provenance_path(out), provenance)
    return ReviewResult(result, provenance)
