"""Errors with messages a person can act on. The CLI prints them as they are."""

from __future__ import annotations


class DryRunError(ValueError):
    """Base class for every error this package raises on purpose."""


class FormatError(DryRunError):
    """A file could not be read or would not be valid. The message names the file and line."""


class KitchenError(DryRunError):
    """The scan, setup and layout do not fit together. `issues` lists every problem found."""

    def __init__(self, issues: tuple[str, ...]) -> None:
        super().__init__("The kitchen setup has problems:\n- " + "\n- ".join(issues))
        self.issues = issues


class CalibrationError(DryRunError):
    """The calibration points do not give a usable camera model."""
