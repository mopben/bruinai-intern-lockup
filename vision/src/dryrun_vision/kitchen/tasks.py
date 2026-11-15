"""Task graphs of menu items and the stations workers cover (port of src/core/tasks.ts).

A menu item without `tasks` is a chain: step k comes after step k-1. With `tasks`, task k describes
steps[k] (same station and storage), and `after` says which tasks must be done first. A task's
output goes to the one task that names it in `after`, or to the pickup when none does.
Golden-tested against the TypeScript (tests/test_kitchen_tasks.py).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dryrun_vision.formats.kitchen_files import MenuItem, TaskDef, WorkerDef


@dataclass(frozen=True)
class ResolvedTask:
    index: int
    id: str
    station_id: str
    fetch_from: tuple[str, ...]
    after: tuple[int, ...]
    """Indices of the tasks that must be done first. Empty: starts when the order appears."""
    next: int | None
    """Index of the task this one's output goes to. None: carried to the pickup."""


def _chain(item: MenuItem) -> tuple[ResolvedTask, ...]:
    n = len(item.steps)
    return tuple(
        ResolvedTask(
            k, f"s{k}", s.station_id, s.fetch_from, () if k == 0 else (k - 1,), k + 1 if k < n - 1 else None
        )
        for k, s in enumerate(item.steps)
    )


def _unique(values: Sequence[int]) -> tuple[int, ...]:
    return tuple(dict.fromkeys(values))


def item_tasks(item: MenuItem) -> tuple[ResolvedTask, ...]:
    """The item's tasks with `after` as indices and `next` filled in. Unknown `after` ids are dropped."""
    defs = item.tasks
    if defs is None:
        return _chain(item)
    index_of: dict[str, int] = {}
    for k, t in enumerate(defs):
        index_of.setdefault(t.id, k)
    afters = [_unique([index_of[i] for i in t.after if i in index_of]) for t in defs]
    return tuple(
        ResolvedTask(
            k,
            t.id,
            t.station_id,
            t.fetch_from,
            afters[k],
            next((j for j, a in enumerate(afters) if k in a), None),
        )
        for k, t in enumerate(defs)
    )


def _step_issues(item: MenuItem, defs: Sequence[TaskDef]) -> list[str]:
    if len(defs) != len(item.steps):
        return [
            f'"{item.name}" has {len(defs)} tasks but {len(item.steps)} steps; they must match one to one.'
        ]
    out: list[str] = []
    for k, (t, s) in enumerate(zip(defs, item.steps, strict=True)):
        if s.station_id != t.station_id:
            out.append(
                f'"{item.name}" task "{t.id}" is at station "{t.station_id}", '
                f'but step {k + 1} is at "{s.station_id}".'
            )
        if tuple(s.fetch_from) != tuple(t.fetch_from):
            out.append(f'"{item.name}" task "{t.id}" fetches from other storage than step {k + 1}.')
    return out


def _after_issues(item: MenuItem, defs: Sequence[TaskDef]) -> list[str]:
    out: list[str] = []
    first: dict[str, int] = {}
    for k, t in enumerate(defs):
        if t.id in first:
            out.append(f'"{item.name}" has two tasks with id "{t.id}".')
        else:
            first[t.id] = k
    named_by: dict[str, list[str]] = {}
    for k, t in enumerate(defs):
        for i in dict.fromkeys(t.after):
            j = first.get(i)
            if j is None:
                out.append(f'"{item.name}" task "{t.id}" waits for "{i}", which is not a task of this item.')
            elif j >= k:
                out.append(
                    f'"{item.name}" task "{t.id}" waits for "{i}", which must come earlier in the list.'
                )
            named_by[i] = [*named_by.get(i, []), t.id]
    for i, by in named_by.items():
        if len(by) > 1 and i in first:
            feeds = " and ".join(f'"{b}"' for b in by)
            out.append(f'"{item.name}" task "{i}" feeds {feeds}; a task can feed only one.')
    return out


def task_issues(item: MenuItem) -> tuple[str, ...]:
    """Problems with an item's task list, in plain words. Empty when valid or without `tasks`."""
    if item.tasks is None:
        return ()
    return (*_after_issues(item, item.tasks), *_step_issues(item, item.tasks))


def worker_covers(w: WorkerDef) -> tuple[str, ...]:
    """Stations this worker may work at: the home station first, no duplicates."""
    return tuple(dict.fromkeys((w.station_id, *(w.covers or ()))))
