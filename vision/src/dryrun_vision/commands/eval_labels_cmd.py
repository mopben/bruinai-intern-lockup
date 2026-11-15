"""`dryrun-vision eval-labels`: measure a label provider on the Breakfast subset (dev and held-out)."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, cast

from dryrun_vision.commands.args import add_gemini_args, gemini_options
from dryrun_vision.errors import FormatError
from dryrun_vision.labels.evaluation.breakfast import discover_clips, split_by_person
from dryrun_vision.labels.evaluation.experiment import run_experiment, window_dump
from dryrun_vision.labels.evaluation.runner import SETTINGS, Setting, score_clips
from dryrun_vision.labels.evaluation.tables import format_all
from dryrun_vision.labels.labeller import LabelSettings
from dryrun_vision.labels.providers.base import LabelProvider
from dryrun_vision.labels.providers.registry import DEFAULT_PROVIDER, make_provider, usage_summary
from dryrun_vision.labels.scoring import CROP_MODES, CropMode
from dryrun_vision.labels.vocab import Vocabulary, bundled_vocab, candidates_of, read_vocab

VISION_DIR = Path(__file__).resolve().parents[3]
EVAL_CROPS = ("whole", "centre")
DEFAULT_VOCAB = bundled_vocab("breakfast")


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("eval-labels", help="Measure a label provider on the Breakfast subset.")
    p.add_argument("--data", type=Path, default=VISION_DIR / "data" / "breakfast", help="Breakfast folder")
    p.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB, help="label vocabulary JSON")
    p.add_argument("--provider", default=DEFAULT_PROVIDER, help="siglip (default) or gemini")
    add_gemini_args(p)
    p.add_argument("--crops", default=",".join(EVAL_CROPS), help="comma list of: whole, centre")
    p.add_argument("--settings", default=",".join(SETTINGS), help="comma list of: all, activity")
    p.add_argument("--limit", type=int, help="use only the first N clips of each half (quick check)")
    p.add_argument("--out-dir", type=Path, default=VISION_DIR / "runs" / "eval-labels")
    p.set_defaults(func=run)


def _choices(text: str, allowed: tuple[str, ...], flag: str) -> tuple[str, ...]:
    picked = tuple(x.strip() for x in text.split(",") if x.strip())
    bad = [x for x in picked if x not in allowed]
    if bad or not picked:
        raise FormatError(f"{flag} takes a comma list of {', '.join(allowed)} (got {text!r}).")
    return picked


def _write(path: Path, data: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    except OSError as exc:
        raise FormatError(f"Could not write {path}: {exc}") from exc


def _usage(provider: LabelProvider) -> dict[str, Any] | None:
    usage = getattr(provider, "usage", None)
    return asdict(usage) if is_dataclass(usage) and not isinstance(usage, type) else None


def _delta(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, Any] | None:
    if before is None or after is None:
        return None
    return {k: after[k] - before.get(k, 0) for k in after}


def _experiment(
    args: argparse.Namespace, provider: LabelProvider, vocab: Vocabulary, halves: tuple, case: tuple
) -> tuple[str, dict[str, Any]]:
    setting, crop = cast(tuple[Setting, CropMode], case)
    params = LabelSettings()
    labels = tuple(c.label for c in candidates_of(vocab, vocab.default_station))
    before, started = _usage(provider), time.perf_counter()
    dev_s, held_s = (
        score_clips(half, provider=provider, vocab=vocab, setting=setting, crop=crop, settings=params)
        for half in halves
    )
    result = run_experiment(dev_s, held_s, labels, per_activity=setting == "activity")
    wall = round(time.perf_counter() - started, 1)
    meta = {"provider": provider.name, "setting": setting, "crop": crop, "windowS": params.window_s,
            "framesPerWindow": params.frames.frames_per_window, "limit": args.limit,
            "wallSeconds": wall, "usage": _delta(before, _usage(provider))}  # fmt: skip
    out = args.out_dir / f"{provider.name.split(':')[0]}-{setting}-{crop}.json"
    _write(out, {**meta, **result, "windowScores": window_dump([*dev_s, *held_s])})
    return f"{provider.name} | candidates: {setting} | crop: {crop}", result


def run(args: argparse.Namespace) -> int:
    crops = _choices(args.crops, tuple(c for c in CROP_MODES if c != "tracks"), "--crops")
    settings_list = _choices(args.settings, SETTINGS, "--settings")
    vocab = read_vocab(args.vocab)
    dev, held = split_by_person(discover_clips(args.data))
    if args.limit is not None:
        dev, held = dev[: args.limit], held[: args.limit]
    provider = make_provider(args.provider, gemini_options(args))
    results = [
        _experiment(args, provider, vocab, (dev, held), (setting, crop))
        for setting in settings_list
        for crop in crops
    ]
    print(format_all(results))
    print(f"\nFull numbers in {args.out_dir}/")
    usage = usage_summary(provider)
    if usage is not None:
        print(f"{provider.name}: {usage}")
    return 0
