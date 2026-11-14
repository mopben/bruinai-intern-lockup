"""Output helpers shared by the subcommands."""

from __future__ import annotations

import sys
from collections.abc import Iterable


def print_warnings(warnings: Iterable[str]) -> None:
    """Anomalies go to stderr so stdout stays a clean file or report."""
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
