"""Zone segments + video -> the same segments with model labels (actions.jsonl, source "zones+model").

Only `work` and `idle` segments are labelled. Each is cut into windows, every window is scored
against the candidates of the segment's station (or the idle set), labels are smoothed within
the segment, equal neighbours are merged, and the segment is replaced by pieces that tile it
exactly with the same kind and boxId. Unsure pieces keep no label. Other kinds pass through.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from dryrun_vision.formats import ActionSegment
from dryrun_vision.labels.constants import (
    CONFIDENCE_DECIMALS,
    MIN_CONFIDENCE,
    MIN_WINDOW_S,
    SMOOTH_WINDOWS,
    WINDOW_S,
)
from dryrun_vision.labels.merge import merge_runs
from dryrun_vision.labels.providers.base import LabelProvider
from dryrun_vision.labels.scoring import FrameSettings, FrameSource, WindowJob, WindowScore, score_windows
from dryrun_vision.labels.smoothing import Decision, smooth_decisions
from dryrun_vision.labels.vocab import Candidate, Vocabulary, candidates_of, idle_label_set, station_label_set
from dryrun_vision.labels.windows import Window, split_windows
from dryrun_vision.labels.worker_boxes import WorkerBoxes

LABELLED_KINDS: frozenset[str] = frozenset({"work", "idle"})


@dataclass(frozen=True)
class LabelSettings:
    window_s: float = WINDOW_S
    min_window_s: float = MIN_WINDOW_S
    smooth_windows: int = SMOOTH_WINDOWS
    min_confidence: float = MIN_CONFIDENCE
    frames: FrameSettings = field(default_factory=FrameSettings)


@dataclass(frozen=True)
class LabelResult:
    segments: tuple[ActionSegment, ...]
    windows: int
    unscored_windows: int
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class _Plan:
    segment: int
    """Index into the input segments."""
    jobs: tuple[WindowJob, ...]


def _candidates(
    seg: ActionSegment, station_names: Mapping[str, str], vocab: Vocabulary
) -> tuple[tuple[Candidate, ...], str | None]:
    if seg.kind == "idle":
        return candidates_of(vocab, idle_label_set(vocab)), None
    name = station_names.get(seg.box_id or "")
    warning = (
        None if name is not None else f'box "{seg.box_id}" has no name in the kitchen; default labels used'
    )
    return candidates_of(vocab, station_label_set(vocab, name or "")), warning


def plan_jobs(
    segments: Sequence[ActionSegment],
    station_names: Mapping[str, str],
    vocab: Vocabulary,
    settings: LabelSettings,
) -> tuple[tuple[_Plan, ...], tuple[str, ...]]:
    plans: list[_Plan] = []
    warnings: list[str] = []
    for i, seg in enumerate(segments):
        if seg.kind not in LABELLED_KINDS:
            continue
        cands, warning = _candidates(seg, station_names, vocab)
        if warning and warning not in warnings:
            warnings.append(warning)
        windows = split_windows(seg.t0, seg.t1, settings.window_s, settings.min_window_s)
        plans.append(_Plan(i, tuple(WindowJob(seg.worker_id, w, cands) for w in windows)))
    return tuple(plans), tuple(warnings)


def decide(
    scores: Sequence[WindowScore], labels: Sequence[str], settings: LabelSettings
) -> tuple[Decision, ...]:
    return smooth_decisions(
        [s.probs for s in scores], labels, settings.smooth_windows, settings.min_confidence
    )


def pieces_of(
    seg: ActionSegment, windows: Sequence[Window], decisions: Sequence[Decision]
) -> tuple[ActionSegment, ...]:
    """The segment cut at label changes. Kind, boxId and worker stay; label and confidence come together."""
    out = []
    for span, d in merge_runs(windows, decisions):
        conf = None if d.confidence is None else min(1.0, max(0.0, round(d.confidence, CONFIDENCE_DECIMALS)))
        out.append(
            seg.model_copy(update={"t0": span.t0, "t1": span.t1, "label": d.label, "confidence": conf})
        )
    return tuple(ActionSegment.model_validate(p.model_dump()) for p in out)


def label_segments(
    segments: Sequence[ActionSegment],
    *,
    station_names: Mapping[str, str],
    vocab: Vocabulary,
    provider: LabelProvider,
    video: FrameSource,
    boxes: Mapping[str, WorkerBoxes],
    settings: LabelSettings,
) -> LabelResult:
    plans, warnings = plan_jobs(segments, station_names, vocab, settings)
    jobs = tuple(job for p in plans for job in p.jobs)
    scores = score_windows(jobs, video, provider, boxes, settings.frames)
    replaced: dict[int, tuple[ActionSegment, ...]] = {}
    start = 0
    for p in plans:
        mine = scores[start : start + len(p.jobs)]
        start += len(p.jobs)
        labels = [c.label for c in p.jobs[0].candidates]
        replaced[p.segment] = pieces_of(
            segments[p.segment], [j.window for j in p.jobs], decide(mine, labels, settings)
        )
    out = tuple(piece for i, seg in enumerate(segments) for piece in replaced.get(i, (seg,)))
    missing = (
        sorted({j.worker_id for j in jobs} - set(boxes)) if settings.frames.crop_mode == "tracks" else []
    )
    extra = tuple(f'worker "{w}" has no boxes in the tracks; its segments get no label' for w in missing)
    unscored = sum(1 for s in scores if s.probs is None)
    return LabelResult(out, len(jobs), unscored, (*warnings, *extra, *_failure_warning(scores)))


def _failure_warning(scores: Sequence[WindowScore]) -> tuple[str, ...]:
    errors = [s.error for s in scores if s.error is not None]
    if not errors:
        return ()
    return (f"{len(errors)} windows could not be scored and have no label (first: {errors[0]})",)
