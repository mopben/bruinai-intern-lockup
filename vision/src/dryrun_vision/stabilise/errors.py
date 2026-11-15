"""The stabilise step's error."""

from __future__ import annotations

from dryrun_vision.errors import DryRunError


class StabiliseError(DryRunError):
    """The video cannot be stabilised (too little texture, or too many frames that do not register)."""
