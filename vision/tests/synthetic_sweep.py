"""Measure the synthetic end-to-end chain over seeds and corruption levels (no detector involved).

    cd vision && uv run python tests/synthetic_sweep.py            # the test's seeds, default corruption
    cd vision && uv run python tests/synthetic_sweep.py --sweep    # also heavier corruption

Prints one line per (fixture, seed, level). The thresholds in test_synthetic_end_to_end.py were set
from the default-level lines of this script (see that file's docstring).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compare import coverage, floor_errors, label_agreement, segment_match
from conftest import FIXTURES_DIR
from dryrun_vision.actions import segment_actions
from dryrun_vision.formats import ACTION_KINDS, read_positions
from dryrun_vision.geometry import model_from_calibration
from dryrun_vision.identity import identify
from dryrun_vision.kitchen import load_kitchen
from dryrun_vision.positions import build_positions
from synth import Corruption, fixture_tracks

FIXTURES = ("counter-a", "counter-c-fourth-worker")
TEST_SEEDS = (7, 1, 3)
EXTRA_SEEDS = (11, 23)
LEVELS = {
    "default": Corruption(),
    "heavy": Corruption(jitter_px=5.0, drop_rate=0.15, occlusions=12),
    "very heavy": Corruption(jitter_px=10.0, drop_rate=0.3, occlusions=20),
    "extreme": Corruption(jitter_px=15.0, drop_rate=0.5, occlusions=30),
}


@dataclass(frozen=True)
class Row:
    ids_right: bool
    mean_cm: float
    worst_cm: float
    coverage: float
    agreement: float
    trips: str
    boundary_s: float
    count_diff: dict[str, int]


def measure(fixture: str, c: Corruption) -> Row:
    s = fixture_tracks(fixture, c)
    kitchen = load_kitchen(FIXTURES_DIR / fixture)
    model = model_from_calibration(s.calibration)
    ident = identify(s.detections, model, s.calibration, kitchen, "head")
    pos = build_positions(ident, model, s.calibration, kitchen, anchor="head")
    ours = segment_actions(kitchen, pos.samples)
    ref = segment_actions(kitchen, read_positions(FIXTURES_DIR / fixture / "positions.jsonl").samples)
    ids_right = {p.name for p in ident.people} == set(s.positions) and all(
        {s.truth[t] for t in p.track_ids} == {p.name} for p in ident.people
    )
    errs = floor_errors(pos.samples, s.positions)
    trips = segment_match(ours.segments, ref.segments, frozenset({"fetch", "carry"}))
    diff = {
        k: sum(x.kind == k for x in ours.segments) - sum(x.kind == k for x in ref.segments)
        for k in ACTION_KINDS
    }
    return Row(
        ids_right,
        max(e.mean_cm for e in errs),
        max(e.worst_cm for e in errs),
        min(coverage(pos.samples, s.positions).values()),
        min(label_agreement(ours.segments, ref.segments, w)[0] for w in s.positions),
        f"{trips.matched}/{trips.total}",
        trips.boundary_worst_s,
        diff,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true", help="also the heavier corruption levels")
    ap.add_argument("--extra-seeds", action="store_true", help=f"also seeds {EXTRA_SEEDS}")
    args = ap.parse_args()
    levels = LEVELS if args.sweep else {"default": LEVELS["default"]}
    seeds = TEST_SEEDS + (EXTRA_SEEDS if args.extra_seeds else ())
    print("fixture | seed | level | ids right | worst-worker mean cm | worst cm | min coverage | "
          "min agreement | trips | worst trip end s | segment count diff")  # fmt: skip
    for name, level in levels.items():
        for fixture in FIXTURES:
            for seed in seeds:
                r = measure(fixture, replace(level, seed=seed))
                diff = " ".join(f"{k}{v:+d}" for k, v in r.count_diff.items())
                print(
                    f"{fixture} | {seed} | {name} | {r.ids_right} | {r.mean_cm:.2f} | {r.worst_cm:.1f} | "
                    f"{r.coverage:.3f} | {r.agreement:.3f} | {r.trips} | {r.boundary_s:.2f} | {diff}"
                )


if __name__ == "__main__":
    main()
