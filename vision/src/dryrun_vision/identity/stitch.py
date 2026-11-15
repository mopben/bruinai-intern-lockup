"""Stitch fragments of one person: a fragment that ends, and another that starts close by soon after.

All candidate links (end of A -> start of B) are scored at once and accepted cheapest first, so every
fragment has at most one successor and one predecessor. Cheapest first, not a maximum matching: a
matching that maximises the number of links would trade one obvious 5 cm continuation for two
doubtful 1.9 m ones. Worker assignment (workers.py) does use a maximum matching, on purpose: there
every worker should get someone. A link needs B to
start strictly after A ends (never two fragments that overlap in time), within STITCH_MAX_GAP_S, and
within walking reach: STITCH_SLACK_M + STITCH_WALK_MPS * gap. Cost: the distance between the ends.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from dryrun_vision.geometry import distance
from dryrun_vision.identity.constants import END_SPAN_S, STITCH_MAX_GAP_S, STITCH_SLACK_M, STITCH_WALK_MPS
from dryrun_vision.identity.fragments import Fragment, end_point, start_point


def reach_m(gap_s: float) -> float:
    """Metres a person can have moved across a gap of gap_s seconds (plus projection slack)."""
    return STITCH_SLACK_M + STITCH_WALK_MPS * gap_s


def link_cost(a: Fragment, b: Fragment, max_gap_s: float = STITCH_MAX_GAP_S) -> float:
    """Metres between A's end and B's start, or inf when B cannot be A continued."""
    gap = b.t0 - a.t1
    if not 0 < gap <= max_gap_s:
        return math.inf
    d = distance(end_point(a, END_SPAN_S), start_point(b, END_SPAN_S))
    return d if d <= reach_m(gap) else math.inf


def _chains(n: int, links: dict[int, int]) -> list[list[int]]:
    has_pred = set(links.values())
    chains: list[list[int]] = []
    for start in range(n):
        if start in has_pred:
            continue
        chain = [start]
        while chain[-1] in links:
            chain = [*chain, links[chain[-1]]]
        chains.append(chain)
    return chains


def _cheapest_first(cost: Sequence[Sequence[float]]) -> dict[int, int]:
    """Links a -> b accepted in order of cost while a has no successor and b no predecessor yet."""
    candidates = sorted(
        (c, a, b) for a, row in enumerate(cost) for b, c in enumerate(row) if math.isfinite(c)
    )
    links: dict[int, int] = {}
    preceded: set[int] = set()
    for _, a, b in candidates:
        if a not in links and b not in preceded:
            links = {**links, a: b}
            preceded = preceded | {b}
    return links


def stitch(fragments: Sequence[Fragment]) -> tuple[tuple[Fragment, ...], ...]:
    """Groups of fragments that are one person, each in time order; groups sorted by start time."""
    frags = sorted(fragments, key=lambda f: (f.t0, f.track_id))
    cost = [[link_cost(a, b) for b in frags] for a in frags]
    links = _cheapest_first(cost)
    groups = [tuple(frags[i] for i in chain) for chain in _chains(len(frags), links)]
    return tuple(sorted(groups, key=lambda g: (g[0].t0, g[0].track_id)))
