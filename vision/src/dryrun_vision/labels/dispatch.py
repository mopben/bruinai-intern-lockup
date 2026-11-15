"""Calling the provider for finished windows: inline, or on a few threads for providers that allow it.

A provider that has `max_concurrency` > 1 (Gemini: network calls) is called from that many threads;
at most twice that many windows wait at once, so memory stays bounded on a long video. Results are
keyed by job index, so the order of answers does not matter. A window the provider could not score
(WindowNotScoredError) is kept as an unscored window with the reason; any other error stops the run.
"""

from __future__ import annotations

from collections.abc import Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from types import TracebackType
from typing import Self

import numpy as np

from dryrun_vision.labels.errors import WindowNotScoredError
from dryrun_vision.labels.providers.base import Clip, LabelProvider
from dryrun_vision.labels.smoothing import Probs
from dryrun_vision.labels.vocab import Candidate

QUEUE_PER_WORKER = 2
"""Windows waiting for an answer per thread, at most."""


@dataclass(frozen=True)
class WindowScore:
    probs: Probs | None
    """One probability per candidate, or None when there was no usable frame or no answer."""
    frames: int
    error: str | None = None
    """Why the provider gave no answer (frames were there), if so."""


def score_clip(
    crops: Sequence[np.ndarray], candidates: Sequence[Candidate], provider: LabelProvider
) -> WindowScore:
    if not crops:
        return WindowScore(None, 0)
    try:
        return WindowScore(provider.score(Clip.of(crops), candidates), len(crops))
    except WindowNotScoredError as exc:
        return WindowScore(None, len(crops), str(exc))


def concurrency_of(provider: LabelProvider) -> int:
    value = getattr(provider, "max_concurrency", 1)
    return value if isinstance(value, int) and value > 1 else 1


class Dispatcher:
    """Use as a context manager: submit(job, crops, candidates) as windows finish, then results()."""

    def __init__(self, provider: LabelProvider) -> None:
        self._provider = provider
        self._workers = concurrency_of(provider)
        self._pool = ThreadPoolExecutor(self._workers) if self._workers > 1 else None
        self._pending: dict[int, Future[WindowScore]] = {}
        self._done: dict[int, WindowScore] = {}

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=True, cancel_futures=True)

    def _collect(self, futures: set[Future[WindowScore]]) -> None:
        for job, fut in [(j, f) for j, f in self._pending.items() if f in futures]:
            self._done[job] = fut.result()  # re-raises a provider error that stops the run
            del self._pending[job]

    def submit(self, job: int, crops: Sequence[np.ndarray], candidates: Sequence[Candidate]) -> None:
        if self._pool is None:
            self._done[job] = score_clip(crops, candidates, self._provider)
            return
        if len(self._pending) >= self._workers * QUEUE_PER_WORKER:
            finished, _ = wait(self._pending.values(), return_when=FIRST_COMPLETED)
            self._collect(set(finished))
        self._pending[job] = self._pool.submit(score_clip, tuple(crops), tuple(candidates), self._provider)

    def results(self) -> dict[int, WindowScore]:
        """Every submitted window's score, waiting for those still in flight."""
        self._collect(set(self._pending.values()))
        return dict(self._done)
