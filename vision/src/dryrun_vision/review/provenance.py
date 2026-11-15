"""actions.provenance.json: where each segment's kind and label came from after a hand review.

Kept beside actions.jsonl rather than inside it, so the product format is unchanged. A label a
person wrote is stored in actions.jsonl with confidence 1 (the format needs one); this file says
it came from a person.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import Field

from dryrun_vision.errors import FormatError
from dryrun_vision.formats.base import FrozenModel, Items, NonEmpty, Seconds, read_json_model

KindSource = Literal["zones", "human"]
LabelSource = Literal["model", "human", "none"]


class SegmentProvenance(FrozenModel):
    worker_id: NonEmpty
    t0: Seconds
    t1: Seconds
    kind: KindSource
    label: LabelSource
    review_row: int | None = Field(default=None, ge=1)
    note: str | None = None


class ProvenanceCounts(FrozenModel):
    model_labels: int = Field(ge=0)
    """Labels the model wrote, before the review."""
    model_labels_kept: int = Field(ge=0)
    model_labels_changed: int = Field(ge=0)
    model_labels_removed: int = Field(ge=0)
    """Removed with "-", or with their segment."""
    labels_added_by_hand: int = Field(ge=0)
    kinds_changed: int = Field(ge=0)
    times_changed: int = Field(ge=0)
    segments_deleted: int = Field(ge=0)


class Provenance(FrozenModel):
    format: Literal["dryrun.actions-provenance"] = "dryrun.actions-provenance"
    version: Literal[1] = 1
    actions: NonEmpty
    """The actions.jsonl this describes (file name)."""
    based_on: NonEmpty
    review: NonEmpty
    counts: ProvenanceCounts
    segments: Items[SegmentProvenance]


def provenance_path(actions_path: Path) -> Path:
    """actions.jsonl -> actions.provenance.json; x.suggested.jsonl -> x.suggested.provenance.json."""
    return actions_path.with_name(actions_path.name.removesuffix(".jsonl") + ".provenance.json")


def read_provenance(path: Path) -> Provenance:
    return read_json_model(path, Provenance)


def write_provenance(path: Path, provenance: Provenance) -> None:
    try:
        path.write_text(json.dumps(provenance.to_json(), indent=1) + "\n", encoding="utf-8")
    except OSError as exc:
        raise FormatError(f"{path} could not be written: {exc}") from exc
