"""taps.jsonl: orders shown on the tablet and "done" taps (docs/FORMATS.md)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from dryrun_vision.formats.base import IsoDateTime, Items, NonEmpty, ProductModel, Seconds, parse_jsonl


class TapsHeader(ProductModel):
    type: Literal["header"] = "header"
    format: Literal["dryrun.taps"] = "dryrun.taps"
    version: Literal[1] = 1
    started_at: IsoDateTime


class OrderEvent(ProductModel):
    type: Literal["order"] = "order"
    t: Seconds
    order_id: NonEmpty
    item_id: NonEmpty


class DoneEvent(ProductModel):
    type: Literal["done"] = "done"
    t: Seconds
    order_id: NonEmpty
    step: int = Field(ge=0)
    station_id: NonEmpty
    worker_id: str | None = None


class EndEvent(ProductModel):
    type: Literal["end"] = "end"
    t: Seconds


TapEvent = Annotated[OrderEvent | DoneEvent | EndEvent, Field(discriminator="type")]
_TAP_ADAPTER: TypeAdapter[OrderEvent | DoneEvent | EndEvent] = TypeAdapter(TapEvent)


class TapsFile(ProductModel):
    header: TapsHeader
    events: Items[TapEvent]

    def done_events(self) -> tuple[DoneEvent, ...]:
        return tuple(e for e in self.events if isinstance(e, DoneEvent))

    def order_events(self) -> tuple[OrderEvent, ...]:
        return tuple(e for e in self.events if isinstance(e, OrderEvent))

    def end_time(self) -> float | None:
        """The `end` line's time, else the last tap's, else None for a file with no events."""
        ends = [e.t for e in self.events if isinstance(e, EndEvent)]
        if ends:
            return ends[0]
        return self.events[-1].t if self.events else None


def read_taps(path: Path) -> TapsFile:
    header, body = parse_jsonl(path, TapsHeader, _TAP_ADAPTER.validate_json)
    return TapsFile(header=header, events=tuple(e for _, e in body))
