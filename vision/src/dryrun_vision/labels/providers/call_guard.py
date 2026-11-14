"""A guard around calls to a paid, rate-limited API (the Gemini provider).

- a per-run cap on requests (retries included), so a mistake cannot run up a bill;
- pacing: requests start at least `min_interval_s` apart, across threads;
- bounded retry with doubling backoff for failures the caller marks as worth retrying
  (rate limits, server errors, network trouble);
- every failure becomes a LabelError in a plain sentence written by the caller's `classify`,
  which must never include the API key (the caller builds it from codes and type names only).
  Used-up retries and the cap raise WindowNotScoredError: that window stays unlabelled, the run goes on.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from dryrun_vision.labels.errors import LabelError, WindowNotScoredError

T = TypeVar("T")

DEFAULT_MAX_CALLS = 1000
"""Requests per run (one `label` or `eval-labels` command). A 90 s run has about 150 windows."""
MAX_ATTEMPTS = 5
"""Tries per window before giving up (the first try and 4 retries)."""
BACKOFF_S = 2.0
"""Seconds before the first retry; doubled each time."""
MAX_BACKOFF_S = 60.0
"""Longest wait between two tries."""
MIN_INTERVAL_S = 0.25
"""Seconds between the starts of two requests: at most 240 a minute."""
CONCURRENCY = 4
"""Requests in flight at once."""


@dataclass(frozen=True)
class CallPolicy:
    max_calls: int = DEFAULT_MAX_CALLS
    max_attempts: int = MAX_ATTEMPTS
    backoff_s: float = BACKOFF_S
    max_backoff_s: float = MAX_BACKOFF_S
    min_interval_s: float = MIN_INTERVAL_S
    concurrency: int = CONCURRENCY

    def __post_init__(self) -> None:
        if self.max_calls < 1 or self.max_attempts < 1 or self.concurrency < 1:
            raise ValueError("The call cap, the number of tries and the concurrency must be 1 or more.")
        if self.backoff_s < 0 or self.max_backoff_s < 0 or self.min_interval_s < 0:
            raise ValueError("Waiting times must be 0 or more seconds.")


@dataclass(frozen=True)
class Failure:
    retry: bool
    """True for rate limits, server errors and network trouble."""
    text: str
    """Plain words, e.g. "was refused (429 RESOURCE_EXHAUSTED)". Never the key or the request."""


class CallGuard:
    """Thread-safe. `calls` counts requests made, `retries` the ones that were repeats."""

    def __init__(
        self,
        policy: CallPolicy,
        who: str,
        *,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.policy = policy
        self._who = who
        self._sleep = sleep
        self._now = now
        self._lock = threading.Lock()
        self._next_start = float("-inf")
        self.calls = 0
        self.retries = 0

    def _reserve(self, retry: bool) -> float:
        """Counts one request and returns how long to wait before sending it."""
        with self._lock:
            if self.calls >= self.policy.max_calls:
                raise WindowNotScoredError(
                    f"{self._who} reached the cap of {self.policy.max_calls} calls for this run. "
                    "Raise it with --gemini-max-calls if that is really wanted."
                )
            self.calls += 1
            self.retries += int(retry)
            now = self._now()
            start = max(now, self._next_start)
            self._next_start = start + self.policy.min_interval_s
            return start - now

    def _backoff(self, attempt: int) -> float:
        return min(self.policy.max_backoff_s, self.policy.backoff_s * 2 ** (attempt - 1))

    def call(self, fn: Callable[[], T], classify: Callable[[BaseException], Failure]) -> T:
        """fn() with pacing, the cap and retries. LabelErrors from fn pass through unchanged."""
        for attempt in range(1, self.policy.max_attempts + 1):
            wait = self._reserve(retry=attempt > 1)
            if wait > 0:
                self._sleep(wait)
            try:
                return fn()
            except LabelError:
                raise
            except Exception as exc:
                failure = classify(exc)
                if not failure.retry:
                    raise LabelError(f"{self._who} {failure.text}.") from exc
                if attempt == self.policy.max_attempts:
                    raise WindowNotScoredError(
                        f"{self._who} {failure.text} {attempt} times in a row. Wait a while and run again, "
                        "or check the service status and your quota."
                    ) from exc
                self._sleep(self._backoff(attempt))
        raise AssertionError("unreachable")  # pragma: no cover
