"""Fetch segments found vs the fetch walks the menu implies."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.formats.actions import ActionSegment
from dryrun_vision.formats.taps import TapsFile
from dryrun_vision.kitchen import Kitchen


@dataclass(frozen=True)
class FetchCount:
    storage_id: str
    storage_name: str
    implied_by_orders: int
    """Fetches the menu implies for every order shown on the tablet."""
    implied_by_done_steps: int
    """Fetches the menu implies for the steps that were tapped done."""
    found: int
    """`fetch` segments to this storage box."""
    one_way_m: float
    """Walkable distance from the fetching station's stand point (0 if no step fetches here)."""


def fetch_counts(
    kitchen: Kitchen, taps: TapsFile, segments: Sequence[ActionSegment], one_way: dict[str, float]
) -> tuple[FetchCount, ...]:
    """One entry per storage box in the kitchen."""
    menu = {m.id: m for m in kitchen.menu}
    by_orders: dict[str, int] = {}
    for o in taps.order_events():
        for step in menu[o.item_id].steps if o.item_id in menu else ():
            by_orders = {**by_orders, **{f: by_orders.get(f, 0) + 1 for f in step.fetch_from}}
    order_item = {o.order_id: o.item_id for o in taps.order_events()}
    by_done: dict[str, int] = {}
    for d in taps.done_events():
        item = menu.get(order_item.get(d.order_id, ""))
        if item is not None and d.step < len(item.steps):
            by_done = {**by_done, **{f: by_done.get(f, 0) + 1 for f in item.steps[d.step].fetch_from}}
    return tuple(
        FetchCount(
            storage_id=s.id,
            storage_name=s.name,
            implied_by_orders=by_orders.get(s.id, 0),
            implied_by_done_steps=by_done.get(s.id, 0),
            found=sum(1 for seg in segments if seg.kind == "fetch" and seg.box_id == s.id),
            one_way_m=one_way.get(s.id, 0.0),
        )
        for s in kitchen.storage
    )
