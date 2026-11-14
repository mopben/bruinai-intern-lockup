"""scan.json, setup.json, layout.json and run.json (see docs/FORMATS.md)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field

from dryrun_vision.formats.base import (
    IsoDateTime,
    Items,
    Metres,
    NonEmpty,
    ProductModel,
    Seconds,
    read_json_model,
)

BoxSide = Literal["front", "back", "left", "right"]
ItemRole = Literal["station", "storage", "pickup", "queue", "fixture", "ignore"]


class Vec3(ProductModel):
    x: float
    y: float
    z: float


class BoxSize(ProductModel):
    """`w` along the box's local x, `d` along local z, `h` up. Metres."""

    w: Metres
    h: Metres
    d: Metres


class ScanBox(ProductModel):
    id: NonEmpty
    category: str
    center: Vec3
    size: BoxSize
    yaw: float
    confidence: Literal["low", "medium", "high"] | None = None


class ScanWall(ProductModel):
    id: NonEmpty
    center: Vec3
    size: BoxSize
    yaw: float


class Scan(ProductModel):
    format: Literal["dryrun.scan"]
    version: Literal[1]
    units: Literal["m"]
    captured_at: IsoDateTime
    source: Literal["roomplan", "manual", "synthetic"]
    device: str | None = None
    walls: Items[ScanWall]
    boxes: Items[ScanBox]


class ItemSetup(ProductModel):
    box_id: NonEmpty
    name: str
    role: ItemRole
    locked: bool
    stand_side: BoxSide = "front"
    capacity: int | None = Field(default=None, ge=1)
    """Stations only: people who can work here at once (the simulation uses it; the video does not)."""


class StepDef(ProductModel):
    station_id: NonEmpty
    fetch_from: Items[NonEmpty] = ()


class TaskDef(ProductModel):
    """`tasks[k]` describes `steps[k]` and says which tasks must be done first (docs/FORMATS.md)."""

    id: NonEmpty
    station_id: NonEmpty
    fetch_from: Items[NonEmpty] = ()
    after: Items[NonEmpty] = ()


class MenuItem(ProductModel):
    id: NonEmpty
    name: str
    steps: Items[StepDef] = Field(min_length=1)
    tasks: Items[TaskDef] | None = None
    """Optional task graph. Without it the steps are a chain."""


class ScheduledOrder(ProductModel):
    order_id: NonEmpty
    item_id: NonEmpty
    t: Seconds


class Schedule(ProductModel):
    orders: Items[ScheduledOrder]


class Setup(ProductModel):
    format: Literal["dryrun.setup"]
    version: Literal[1]
    items: Items[ItemSetup]
    menu: Items[MenuItem]
    pickup_id: NonEmpty
    schedule: Schedule


class Placement(ProductModel):
    x: float
    z: float
    yaw: float


class WorkerDef(ProductModel):
    id: NonEmpty
    name: str
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    station_id: NonEmpty
    covers: Items[NonEmpty] | None = Field(default=None, min_length=1)
    """Optional: stations this person may also work at (stationId is always one; it is home)."""


class Layout(ProductModel):
    format: Literal["dryrun.layout"]
    version: Literal[1]
    placements: dict[str, Placement]
    workers: Items[WorkerDef]


class RunMeta(ProductModel):
    format: Literal["dryrun.run"]
    version: Literal[1]
    id: NonEmpty
    title: str
    change: str | None = None
    base_run_id: str | None = None
    recorded_at: IsoDateTime
    source: Literal["synthetic", "recorded"]


def read_scan(path: Path) -> Scan:
    return read_json_model(path, Scan)


def read_setup(path: Path) -> Setup:
    return read_json_model(path, Setup)


def read_layout(path: Path) -> Layout:
    return read_json_model(path, Layout)


def read_run_meta(path: Path) -> RunMeta:
    return read_json_model(path, RunMeta)
