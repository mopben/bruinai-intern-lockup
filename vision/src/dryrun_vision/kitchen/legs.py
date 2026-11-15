"""Walking legs the menu implies under the staged-run protocol (port of src/core/walking.ts, plan.ts).

For each step: one round trip to each `fetchFrom` storage, then a carry to the station of the
task its output goes to (kitchen/tasks.py: the next step for a plain chain, the task that waits
for it in a task graph), or the pickup. A carry whose two stand points
are within HANDOFF_REACH_M (straight line) is passed by hand: nobody walks.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from typing import Literal

from dryrun_vision.geometry.floor import Vec2, distance
from dryrun_vision.geometry.path import WalkPath, shortest_path
from dryrun_vision.kitchen.tasks import item_tasks
from dryrun_vision.kitchen.world import Kitchen, KitchenItem

HANDOFF_REACH_M = 1.0
"""Metres. Carries between stand points this close are hand-offs (types.ts)."""

LegKind = Literal["fetch", "carry"]


@dataclass(frozen=True)
class Leg:
    item_id: str
    """Menu item id."""
    step: int
    kind: LegKind
    from_id: str
    to_id: str
    one_way_m: float
    """Along the walkable path; 0 for a hand-off."""
    round_trip_m: float
    handoff: bool
    blocked: bool
    """No walkable path; a straight line was used."""


@dataclass(frozen=True)
class TripTarget:
    """A round trip a worker at some station may make (trips.ts `Candidate`)."""

    kind: LegKind
    target_id: str
    stand: Vec2
    round_trip_m: float


def _item(k: Kitchen, box_id: str) -> KitchenItem:
    it = k.item(box_id)
    if it is None:  # resolve_kitchen checked every menu reference
        raise ValueError(f'No item "{box_id}" in the kitchen.')
    return it


def _leg(k: Kitchen, path: WalkPath, *, item_id: str, step: int, kind: LegKind, a: str, b: str) -> Leg:
    straight = distance(_item(k, a).stand, _item(k, b).stand)
    handoff = kind == "carry" and straight <= HANDOFF_REACH_M
    one_way = 0.0 if handoff else path.length
    return Leg(item_id, step, kind, a, b, one_way, 2 * one_way, handoff, (not handoff) and path.blocked)


def menu_legs(k: Kitchen) -> tuple[Leg, ...]:
    """Every leg of every menu item, in menu order (fetches before the carry of each step)."""

    @cache
    def path(a: str, b: str) -> WalkPath:
        return shortest_path(k.obstacles, _item(k, a).stand, _item(k, b).stand)

    legs: list[Leg] = []
    for m in k.menu:
        tasks = item_tasks(m)
        for i, s in enumerate(m.steps):
            legs.extend(
                _leg(k, path(s.station_id, f), item_id=m.id, step=i, kind="fetch", a=s.station_id, b=f)
                for f in s.fetch_from
            )
            after = tasks[i].next
            nxt = k.pickup_id if after is None else tasks[after].station_id
            legs.append(
                _leg(k, path(s.station_id, nxt), item_id=m.id, step=i, kind="carry", a=s.station_id, b=nxt)
            )
    return tuple(legs)


def trip_targets(k: Kitchen, station_id: str, legs: tuple[Leg, ...] | None = None) -> tuple[TripTarget, ...]:
    """Round trips that start at this station: its fetch legs and non-hand-off carries, deduplicated."""
    out: dict[str, TripTarget] = {}
    for leg in legs if legs is not None else menu_legs(k):
        if leg.from_id != station_id or leg.handoff or leg.round_trip_m <= 0:
            continue
        key = f"{leg.kind}:{leg.to_id}"
        out = {**out, key: TripTarget(leg.kind, leg.to_id, _item(k, leg.to_id).stand, leg.round_trip_m)}
    return tuple(out.values())
