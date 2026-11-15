"""Scan + setup + layout -> the resolved kitchen.

Port of src/core/world.ts, plus the room bounds of src/camera/kitchen.ts.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from dryrun_vision.errors import KitchenError
from dryrun_vision.formats.kitchen_files import (
    BoxSide,
    BoxSize,
    ItemRole,
    Layout,
    MenuItem,
    Scan,
    Setup,
    WorkerDef,
    read_layout,
    read_scan,
    read_setup,
)
from dryrun_vision.geometry.floor import OrientedRect, Vec2, grow_rect, local_to_world, rect_corners
from dryrun_vision.geometry.path import Obstacle
from dryrun_vision.kitchen.tasks import task_issues, worker_covers

log = logging.getLogger("dryrun_vision.kitchen")

STAND_OFF_M = 0.35
"""Metres. A person stands this far out from the middle of a box's stand side (types.ts)."""
BODY_RADIUS_M = 0.25
"""Metres. Obstacles are grown by this for path finding (types.ts)."""

_SIDE_OFFSET: dict[BoxSide, Callable[[float, float], Vec2]] = {
    "front": lambda _w, d: Vec2(0.0, d + STAND_OFF_M),
    "back": lambda _w, d: Vec2(0.0, -(d + STAND_OFF_M)),
    "right": lambda w, _d: Vec2(w + STAND_OFF_M, 0.0),
    "left": lambda w, _d: Vec2(-(w + STAND_OFF_M), 0.0),
}


@dataclass(frozen=True)
class KitchenItem:
    id: str
    name: str
    category: str
    role: ItemRole
    """Never "ignore": ignored boxes are left out of the kitchen."""
    locked: bool
    size: BoxSize
    rect: OrientedRect
    footprint: tuple[Vec2, ...]
    """Four floor corners: back-left, back-right, front-right, front-left."""
    stand_side: BoxSide
    stand: Vec2
    """Where a person stands to use it: STAND_OFF_M out from the middle of stand_side."""


@dataclass(frozen=True)
class KitchenWall:
    id: str
    rect: OrientedRect
    footprint: tuple[Vec2, ...]


@dataclass(frozen=True)
class Bounds:
    min_x: float
    max_x: float
    min_z: float
    max_z: float

    def contains(self, p: Vec2, margin: float) -> bool:
        return (
            self.min_x - margin <= p.x <= self.max_x + margin
            and self.min_z - margin <= p.z <= self.max_z + margin
        )


@dataclass(frozen=True)
class Kitchen:
    items: tuple[KitchenItem, ...]
    walls: tuple[KitchenWall, ...]
    obstacles: tuple[Obstacle, ...]
    menu: tuple[MenuItem, ...]
    workers: tuple[WorkerDef, ...]
    pickup_id: str
    bounds: Bounds
    """Room bounds: every box footprint and wall footprint."""
    warnings: tuple[str, ...]

    def item(self, box_id: str) -> KitchenItem | None:
        return next((i for i in self.items if i.id == box_id), None)

    def items_with_role(self, role: ItemRole) -> tuple[KitchenItem, ...]:
        return tuple(i for i in self.items if i.role == role)

    @property
    def stations(self) -> tuple[KitchenItem, ...]:
        return self.items_with_role("station")

    @property
    def storage(self) -> tuple[KitchenItem, ...]:
        return self.items_with_role("storage")

    @property
    def pickup(self) -> KitchenItem:
        found = self.item(self.pickup_id)
        if found is None:  # resolve_kitchen guarantees it; this guards hand-built kitchens
            raise KitchenError((f'Pickup "{self.pickup_id}" is not in the kitchen.',))
        return found

    def home_station(self, worker_id: str) -> KitchenItem:
        """The station this worker works at (layout.json)."""
        w = next((w for w in self.workers if w.id == worker_id), None)
        station = self.item(w.station_id) if w else None
        if station is None:
            raise KitchenError((f'No worker "{worker_id}" with a station in this kitchen.',))
        return station


def stand_point(rect: OrientedRect, side: BoxSide) -> Vec2:
    """STAND_OFF_M out from the middle of the given side of an oriented box."""
    return local_to_world(rect, _SIDE_OFFSET[side](rect.half_w, rect.half_d))


def _check_refs(scan: Scan, setup: Setup, layout: Layout) -> list[str]:
    issues: list[str] = []
    box_ids = {b.id for b in scan.boxes}
    seen: set[str] = set()
    for it in setup.items:
        if it.box_id not in box_ids:
            issues.append(f'Setup names box "{it.box_id}", which is not in the scan.')
        if it.box_id in seen:
            issues.append(f'Box "{it.box_id}" is set up twice.')
        seen = seen | {it.box_id}
    issues.extend(
        f'Layout places box "{bid}", which is not in the scan.'
        for bid in layout.placements
        if bid not in box_ids
    )
    return issues


def _check_menu(setup: Setup, roles: dict[str, ItemRole]) -> list[str]:
    issues: list[str] = []
    if roles.get(setup.pickup_id) != "pickup":
        issues.append(f'Pickup "{setup.pickup_id}" is not a box with role "pickup".')
    if not setup.menu:
        issues.append("The menu has no items.")
    for m in setup.menu:
        for i, s in enumerate(m.steps):
            if roles.get(s.station_id) != "station":
                issues.append(f'"{m.name}" step {i + 1} is at "{s.station_id}", which is not a station.')
            issues.extend(
                f'"{m.name}" step {i + 1} fetches from "{f}", which is not storage.'
                for f in s.fetch_from
                if roles.get(f) != "storage"
            )
        issues.extend(task_issues(m))
    return issues


def _check_people(setup: Setup, layout: Layout, roles: dict[str, ItemRole]) -> list[str]:
    issues: list[str] = []
    menu_ids = {m.id for m in setup.menu}
    order_ids = [o.order_id for o in setup.schedule.orders]
    for o in setup.schedule.orders:
        if o.item_id not in menu_ids:
            issues.append(f'Order "{o.order_id}" is for "{o.item_id}", which is not on the menu.')
    issues.extend(
        f'Order id "{oid}" appears twice in the schedule.'
        for oid in sorted(set(order_ids))
        if order_ids.count(oid) > 1
    )
    worker_ids = [w.id for w in layout.workers]
    for w in layout.workers:
        if roles.get(w.station_id) != "station":
            issues.append(f'Worker "{w.name}" stands at "{w.station_id}", which is not a station.')
        issues.extend(
            f'Worker "{w.name}" covers "{c}", which is not a station.'
            for c in w.covers or ()
            if roles.get(c) != "station"
        )
    issues.extend(
        f'Worker id "{wid}" appears twice.' for wid in sorted(set(worker_ids)) if worker_ids.count(wid) > 1
    )
    return issues


def _rect(center: Vec2, size: BoxSize, yaw: float) -> OrientedRect:
    return OrientedRect(center, size.w / 2, size.d / 2, yaw)


def _items(scan: Scan, setup: Setup, layout: Layout) -> tuple[tuple[KitchenItem, ...], tuple[str, ...]]:
    by_id = {it.box_id: it for it in setup.items}
    items: list[KitchenItem] = []
    warnings: list[str] = []
    for box in scan.boxes:
        it = by_id.get(box.id)
        if it is None:
            warnings.append(f'Scanned box "{box.id}" ({box.category}) has no setup; treated as a fixture.')
        role: ItemRole = it.role if it else "fixture"
        if role == "ignore":
            continue
        placed = layout.placements.get(box.id)
        rect = (
            _rect(Vec2(placed.x, placed.z), box.size, placed.yaw)
            if placed
            else _rect(Vec2(box.center.x, box.center.z), box.size, box.yaw)
        )
        side: BoxSide = it.stand_side if it else "front"
        items.append(
            KitchenItem(
                id=box.id,
                name=it.name if it else box.category,
                category=box.category,
                role=role,
                locked=it.locked if it else False,
                size=box.size,
                rect=rect,
                footprint=rect_corners(rect),
                stand_side=side,
                stand=stand_point(rect, side),
            )
        )
    return tuple(items), tuple(warnings)


def _bounds(items: tuple[KitchenItem, ...], walls: tuple[KitchenWall, ...]) -> Bounds:
    pts = [p for i in items for p in i.footprint] + [p for w in walls for p in w.footprint]
    if not pts:
        raise KitchenError(("The scan has no boxes and no walls.",))
    return Bounds(min(p.x for p in pts), max(p.x for p in pts), min(p.z for p in pts), max(p.z for p in pts))


def _covers_warnings(layout: Layout) -> tuple[str, ...]:
    return tuple(
        f'Worker "{w.name}" covers {len(worker_covers(w)) - 1} more station(s); covers are not understood by '
        "the video pipeline yet. It finds each worker by their home station (stationId) only, and trips "
        "that start at a covered station show as walk."
        for w in layout.workers
        if len(worker_covers(w)) > 1
    )


def resolve_kitchen(scan: Scan, setup: Setup, layout: Layout) -> Kitchen:
    """The resolved kitchen. Raises KitchenError listing every problem found (like resolveWorld)."""
    by_id = {it.box_id: it.role for it in setup.items}
    roles: dict[str, ItemRole] = {b.id: by_id.get(b.id, "fixture") for b in scan.boxes}
    issues = (
        _check_refs(scan, setup, layout) + _check_menu(setup, roles) + _check_people(setup, layout, roles)
    )
    if issues:
        raise KitchenError(tuple(issues))
    items, warnings = _items(scan, setup, layout)
    warnings = (*warnings, *_covers_warnings(layout))
    walls = tuple(
        KitchenWall(w.id, r, rect_corners(r))
        for w in scan.walls
        for r in (_rect(Vec2(w.center.x, w.center.z), w.size, w.yaw),)
    )
    obstacles = tuple(Obstacle(i.id, grow_rect(i.rect, BODY_RADIUS_M), i.rect) for i in items) + tuple(
        Obstacle(w.id, grow_rect(w.rect, BODY_RADIUS_M), w.rect) for w in walls
    )
    return Kitchen(
        items, walls, obstacles, setup.menu, layout.workers, setup.pickup_id, _bounds(items, walls), warnings
    )


def load_kitchen(run_folder: Path) -> Kitchen:
    """Reads scan.json, setup.json and layout.json from a run folder and resolves them."""
    kitchen = resolve_kitchen(
        read_scan(run_folder / "scan.json"),
        read_setup(run_folder / "setup.json"),
        read_layout(run_folder / "layout.json"),
    )
    for w in kitchen.warnings:
        log.warning("%s", w)
    return kitchen
