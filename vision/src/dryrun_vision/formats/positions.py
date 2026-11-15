"""positions.jsonl: where each worker stood, in the scan's floor frame (docs/FORMATS.md)."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from pydantic import Field, field_serializer

from dryrun_vision.formats.base import (
    METRE_DECIMALS,
    IsoDateTime,
    Items,
    NonEmpty,
    ProductModel,
    Seconds,
    parse_jsonl,
    round_time,
    write_jsonl,
)


class PositionsHeader(ProductModel):
    type: Literal["header"] = "header"
    format: Literal["dryrun.positions"] = "dryrun.positions"
    version: Literal[1] = 1
    started_at: IsoDateTime
    hz: float = Field(gt=0)
    """Nominal samples per second per worker."""


class PositionSample(ProductModel):
    type: Literal["pos"] = "pos"
    t: Seconds
    worker_id: NonEmpty
    x: float
    z: float

    @field_serializer("t")
    def _round_t(self, t: float) -> float:
        return round_time(t)

    @field_serializer("x", "z")
    def _round_xz(self, v: float) -> float:
        return round(v, METRE_DECIMALS)


class PositionsFile(ProductModel):
    header: PositionsHeader
    samples: Items[PositionSample]


def read_positions(path: Path) -> PositionsFile:
    """Reads and validates positions.jsonl. Samples keep file order."""
    header, body = parse_jsonl(path, PositionsHeader, PositionSample.model_validate_json, tagged_union=False)
    return PositionsFile(header=header, samples=tuple(s for _, s in body))


def write_positions(path: Path, header: PositionsHeader, samples: Iterable[PositionSample]) -> None:
    """Writes positions.jsonl in time order (stable: equal times keep their order); 3 decimals."""
    ordered = sorted(samples, key=lambda s: round_time(s.t))
    write_jsonl(path, header, ordered)
