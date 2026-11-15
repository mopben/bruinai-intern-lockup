"""Builds the video-to-actions demo page's data and media from the pipeline's saved outputs.

Run from vision/:  uv run python demo/build_demo.py
Writes demo/data/*.json and demo/media/*.mp4|jpg (both git-ignored), then checks that every number
index.html prints matches the source files. Safe to run again: videos are re-encoded only when the
source is newer, and the JSON is rewritten with the same content.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import demo_breakfast
import demo_cafe
import demo_kitchen
import demo_ourkitchen
import demo_pets
from demo_common import DEMO, DemoError, say, write_json

from dryrun_vision.errors import FormatError

PAGE = DEMO / "index.html"
PERCENT = 100
SECONDS_PER_MINUTE = 60
METRE_TO_CM = 100

Builder = Callable[[], dict[str, Any]]
SECTIONS: tuple[tuple[str, Builder], ...] = (
    ("ourkitchen", demo_ourkitchen.build),
    ("pets", demo_pets.build),
    ("kitchen", demo_kitchen.build),
    ("breakfast", demo_breakfast.build),
    ("cafe", demo_cafe.build),
)


@dataclass(frozen=True)
class Shown:
    """A number as the page prints it, what it is, and where it comes from."""

    text: str
    meaning: str
    source: str


def _pct(v: float, digits: int = 1) -> str:
    return f"{v * PERCENT:.{digits}f}%"


def _pets_numbers(d: dict[str, Any]) -> list[Shown]:
    n, src = d["numbers"], "runs/pets/eval-tracks-rerun-2026-11-14b.json"
    return [
        Shown(_pct(n["recall"], 0), "people found (recall, IoU 0.5)", src),
        Shown(_pct(n["precision"], 0), "boxes that are people (precision)", src),
        Shown(f"IDF1 {n['idf1']:.2f}", "identity F1", src),
        Shown(f"{n['footMedianM'] * METRE_TO_CM:.0f} cm", "median floor error, foot anchor", src),
        Shown(f"{n['trackIds']} track ids for {n['gtPeople']} people", "ids", src),
    ]


def _kitchen_numbers(d: dict[str, Any]) -> list[Shown]:
    n, src = d["numbers"], "computed now from fixtures/counter-a (same as eval-actions)"
    return [
        Shown(f"{n['tapsInside']} of {n['taps']}", "done taps inside a work segment", src),
        Shown(f"{n['tapsNearEnd']} more", "done taps within 2 s of a work segment's end", src),
        Shown(f"{n['segments']} action segments", "segments", src),
        Shown(f"{n['tillWorkShare'] * PERCENT:.0f}% of the run", "till worker's work share", src),
    ]


def _breakfast_numbers(d: dict[str, Any]) -> list[Shown]:
    s, src = d["summary"], "runs/eval-labels/{gemini,siglip}-activity-whole.json"
    shown = [
        Shown(_pct(s["gemini"]), "Gemini held-out frame accuracy", src),
        Shown(_pct(s["siglip"]), "SigLIP held-out frame accuracy", src),
        Shown(_pct(s["majority"]), "majority baseline", src),
        Shown(f"{s['geminiFound']} of {s['truthSegments']}", "Gemini segments found", src),
        Shown(f"{s['siglipFound']} of {s['truthSegments']}", "SigLIP segments found", src),
        Shown(f"{s['calls']} requests", "Gemini calls", src),
        Shown(f"{s['tokens'] / 1e6:.2f} million tokens", "Gemini tokens", src),
        Shown(f"{s['wallSeconds'] / SECONDS_PER_MINUTE:.0f} minutes", "Gemini wall time", src),
        Shown(f"{s['videoSeconds'] / SECONDS_PER_MINUTE:.1f} minutes of video", "all 26 clips", "ffprobe"),
    ]
    for c in d["clips"]:
        for p in ("gemini", "siglip"):
            shown.append(Shown(_pct(c["acc"][p]), f"{c['name']} {p}", "recomputed per clip from " + src))
    return shown


def _ourkitchen_numbers(d: dict[str, Any]) -> list[Shown]:
    c, src = d["counts"], "recordings/kitchen-combo-1/actions.suggested.provenance.json"
    return [
        Shown(
            f"keep {c['kept']} of {c['modelLabels']} model labels", "suggested corrections: labels kept", src
        ),
        Shown(f"change {c['changed']}", "suggested corrections: model labels changed", src),
        Shown(f"add {c['added']} by hand", "suggested corrections: labels added", src),
        Shown(f"change the kind of {c['kinds']} segments", "suggested corrections: kinds changed", src),
    ]


def _check_page(shown: list[Shown]) -> list[Shown]:
    """The numbers index.html does not contain (empty when the page matches the data)."""
    if not PAGE.is_file():
        raise DemoError(f"The page is missing: {PAGE}.")
    page = PAGE.read_text(encoding="utf-8")
    return [s for s in shown if s.text not in page]


def main() -> int:
    try:
        built = {name: builder() for name, builder in SECTIONS}
        for name, data in built.items():
            path = write_json(name, data)
            say(f"wrote {path.relative_to(DEMO)} ({path.stat().st_size} bytes)")
        shown = [*_ourkitchen_numbers(built["ourkitchen"]), *_pets_numbers(built["pets"]),
                 *_kitchen_numbers(built["kitchen"]),
                 *_breakfast_numbers(built["breakfast"])]  # fmt: skip
        missing = _check_page(shown)
    except (DemoError, FormatError) as exc:
        say(f"Could not build the demo: {exc}")
        return 1
    for s in shown:
        say(f"  {'MISSING' if s in missing else 'ok':8} {s.text:32} {s.meaning} ({s.source})")
    if missing:
        say(f"{len(missing)} number(s) above are not in index.html as printed; update the page.")
        return 1
    say("All numbers on the page match their sources.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
