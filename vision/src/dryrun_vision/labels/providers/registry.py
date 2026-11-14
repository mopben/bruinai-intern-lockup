"""Providers by name, for the CLI. `siglip` is the default (local, no key)."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from dryrun_vision.labels.errors import LabelError
from dryrun_vision.labels.providers.base import LabelProvider
from dryrun_vision.labels.providers.gemini import GeminiOptions, gemini_from_env
from dryrun_vision.labels.providers.siglip import SiglipProvider

DEFAULT_PROVIDER = "siglip"


def _siglip(_options: GeminiOptions) -> LabelProvider:
    from dryrun_vision.labels.providers.siglip_backend import (  # noqa: PLC0415 - loads torch lazily
        SIGLIP_REPO,
        TorchSiglipBackend,
    )

    return SiglipProvider(TorchSiglipBackend(), f"siglip:{SIGLIP_REPO}")


def _gemini(options: GeminiOptions) -> LabelProvider:
    return gemini_from_env(options)


FACTORIES: Mapping[str, Callable[[GeminiOptions], LabelProvider]] = {"siglip": _siglip, "gemini": _gemini}
"""Each factory gets the Gemini options (model, call policy); the others ignore them."""


def make_provider(name: str, gemini: GeminiOptions | None = None) -> LabelProvider:
    factory = FACTORIES.get(name)
    if factory is None:
        known = ", ".join(sorted(FACTORIES))
        raise LabelError(f'There is no provider called "{name}". Choose one of: {known}.')
    return factory(gemini or GeminiOptions())


def usage_summary(provider: LabelProvider) -> str | None:
    """Calls and tokens used, for providers that count them (Gemini)."""
    usage = getattr(provider, "usage", None)
    summary = getattr(usage, "summary", None)
    return summary() if callable(summary) else None
