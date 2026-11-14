"""Scoring Breakfast clips with a provider through the same windowing/scoring code as `label`.

A clip is treated as one segment covering the whole video, in whole-frame or centre-crop mode
(no tracks). Setting "all": every vocabulary label is a candidate; "activity": only the labels
of the clip's activity (the vocabulary's station entry whose match is the activity name).
"""

from __future__ import annotations

import bisect
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from dryrun_vision.labels.evaluation.breakfast import BreakfastClip, read_frame_labels
from dryrun_vision.labels.labeller import LabelSettings
from dryrun_vision.labels.providers.base import LabelProvider
from dryrun_vision.labels.scoring import CropMode, FrameSettings, WindowJob, WindowScore, score_windows
from dryrun_vision.labels.smoothing import smooth_decisions
from dryrun_vision.labels.vocab import Vocabulary, candidates_of, station_label_set
from dryrun_vision.labels.windows import Window, split_windows
from dryrun_vision.video import VideoFrames, count_frames

Setting = Literal["all", "activity"]
SETTINGS: tuple[Setting, ...] = ("all", "activity")


@dataclass(frozen=True)
class ClipScores:
    clip: BreakfastClip
    fps: float
    truth: tuple[str, ...]
    """One label per decoded frame."""
    labels: tuple[str, ...]
    """Candidates, in score order."""
    windows: tuple[Window, ...]
    scores: tuple[WindowScore, ...]
    seconds: float
    """Wall time spent decoding, cropping and scoring."""


def score_clip(
    clip: BreakfastClip,
    *,
    provider: LabelProvider,
    vocab: Vocabulary,
    setting: Setting,
    crop: CropMode,
    settings: LabelSettings,
) -> ClipScores:
    label_set = vocab.default_station if setting == "all" else station_label_set(vocab, clip.activity)
    cands = candidates_of(vocab, label_set)
    n = count_frames(clip.video)
    started = time.perf_counter()
    with VideoFrames(clip.video) as video:
        fps = video.meta.fps
        windows = split_windows(0.0, n / fps, settings.window_s, settings.min_window_s)
        jobs = tuple(WindowJob(clip.name, w, cands) for w in windows)
        frames = FrameSettings(frames_per_window=settings.frames.frames_per_window, crop_mode=crop)
        scores = score_windows(jobs, video, provider, {}, frames)
    seconds = time.perf_counter() - started
    labels = tuple(c.label for c in cands)
    return ClipScores(clip, fps, read_frame_labels(clip.labels, n), labels, windows, scores, seconds)


def predict_frames(cs: ClipScores, smooth_windows: int, min_confidence: float) -> tuple[str | None, ...]:
    """The label each decoded frame gets: that of the window containing its start time."""
    decisions = smooth_decisions([s.probs for s in cs.scores], cs.labels, smooth_windows, min_confidence)
    starts = [w.t0 for w in cs.windows]
    out = []
    for k in range(len(cs.truth)):
        i = max(0, bisect.bisect_right(starts, k / cs.fps) - 1)
        out.append(decisions[i].label)
    return tuple(out)


def score_clips(
    clips: Sequence[BreakfastClip],
    *,
    provider: LabelProvider,
    vocab: Vocabulary,
    setting: Setting,
    crop: CropMode,
    settings: LabelSettings,
) -> tuple[ClipScores, ...]:
    return tuple(
        score_clip(c, provider=provider, vocab=vocab, setting=setting, crop=crop, settings=settings)
        for c in clips
    )
