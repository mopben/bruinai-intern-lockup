"""The labeller's error type. A DryRunError, so the CLI prints its message without a traceback."""

from __future__ import annotations

from dryrun_vision.errors import DryRunError


class LabelError(DryRunError):
    """The video, vocabulary, provider or its answer cannot be used. The message says what to do."""


class WindowNotScoredError(LabelError):
    """One window could not be scored (retries used up, the call cap reached, an unusable answer).

    The labeller leaves that window without a label and carries on, so paid calls already made
    are not thrown away. Other LabelErrors (a missing key, a refused request) stop the run.
    """
