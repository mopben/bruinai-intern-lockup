"""The whole evaluation of an actions file against a run's taps, as data, text and JSON."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from dryrun_vision.actions.constants import TRIP_EXCURSION_M
from dryrun_vision.evaluate.fetches import FetchCount, fetch_counts
from dryrun_vision.evaluate.stats import Distribution
from dryrun_vision.evaluate.taps_match import NEAR_TAP_S, TapMatchSummary, match_done_taps
from dryrun_vision.evaluate.time_share import WorkerTimeShare, time_share
from dryrun_vision.formats.actions import ACTION_KINDS, ActionSegment
from dryrun_vision.formats.run_folder import RunFolder
from dryrun_vision.kitchen import Kitchen, menu_legs

PERCENT = 100.0


@dataclass(frozen=True)
class EvalReport:
    run: str
    source: str
    taps: TapMatchSummary
    fetch: tuple[FetchCount, ...]
    time_share: tuple[WorkerTimeShare, ...]
    segments: int
    notes: tuple[str, ...]


def _fetch_one_way(kitchen: Kitchen) -> dict[str, float]:
    return {leg.to_id: leg.one_way_m for leg in menu_legs(kitchen) if leg.kind == "fetch"}


def _notes(fetch: Sequence[FetchCount]) -> tuple[str, ...]:
    return tuple(
        f"{f.storage_name} is {f.one_way_m:.2f} m from its station, within the {TRIP_EXCURSION_M:g} m "
        "trip threshold of trips.ts: fetches there cannot be told from standing at home."
        for f in fetch
        if 0 < f.one_way_m <= TRIP_EXCURSION_M
    )


def evaluate_actions(
    run: RunFolder, kitchen: Kitchen, segments: Sequence[ActionSegment], source: str
) -> EvalReport:
    """Compares segments with the run's taps. `source` says where the segments came from."""
    fetch = fetch_counts(kitchen, run.taps, segments, _fetch_one_way(kitchen))
    return EvalReport(
        run=run.meta.id,
        source=source,
        taps=match_done_taps(run.taps.done_events(), segments),
        fetch=fetch,
        time_share=time_share(segments, run.positions.samples),
        segments=len(segments),
        notes=_notes(fetch),
    )


def report_to_json(rep: EvalReport) -> dict[str, Any]:
    """Plain JSON-ready dict (per-tap matches included)."""
    return asdict(rep)


def _fmt(v: float | None) -> str:
    return "-" if v is None else f"{v:.2f}"


def _dist_line(d: Distribution) -> str:
    return (
        f"n={d.n}  mean={_fmt(d.mean)}  p10={_fmt(d.p10)}  p50={_fmt(d.p50)}  "
        f"p90={_fmt(d.p90)}  max={_fmt(d.max)}"
    )


def _tap_lines(t: TapMatchSummary) -> list[str]:
    return [
        f"done taps: {t.taps}  (without workerId: {t.without_worker_id})",
        f"  work segment contains the tap:       {t.containing}",
        f"  work segment ends within {NEAR_TAP_S:g} s:        {t.near}",
        f"  no matching work segment:            {t.unmatched}",
        f"  matched taps sharing one segment:    {t.taps_on_shared_segment}",
        f"  |segment end - tap| (s): {_dist_line(t.abs_end_offset_s)}",
        f"    taps on unshared segments only: {_dist_line(t.abs_end_offset_unshared_s)}",
    ]


def _fetch_lines(fetch: Sequence[FetchCount]) -> list[str]:
    lines = ["fetches (storage: implied by orders / by done steps / fetch segments found):"]
    lines.extend(
        f"  {f.storage_name}: {f.implied_by_orders} / {f.implied_by_done_steps} / {f.found}"
        f"   (one way {f.one_way_m:.2f} m)"
        for f in fetch
    )
    return lines


def _share_lines(shares: Sequence[WorkerTimeShare]) -> list[str]:
    head = "  worker     seen s  " + "  ".join(f"{k:>6}" for k in ACTION_KINDS) + "  uncovered"
    lines = ["time share (% of each worker's observed time):", head]
    for w in shares:
        cells = "  ".join(f"{w.fraction[k] * PERCENT:6.1f}" for k in ACTION_KINDS)
        lines.append(f"  {w.worker_id:<9} {w.observed_s:7.1f}  {cells}  {w.uncovered * PERCENT:9.1f}")
    return lines


def format_report(rep: EvalReport) -> str:
    lines = [
        f"run {rep.run}: {rep.segments} segments from {rep.source}",
        "",
        *_tap_lines(rep.taps),
        "",
        *_fetch_lines(rep.fetch),
        "",
        *_share_lines(rep.time_share),
    ]
    if rep.notes:
        lines += ["", "notes:", *(f"  {n}" for n in rep.notes)]
    return "\n".join(lines)
