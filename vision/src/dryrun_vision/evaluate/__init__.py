"""Compare action segments with a run's taps: done-tap matching, fetch counts, time share."""

from dryrun_vision.evaluate.report import EvalReport, evaluate_actions, format_report, report_to_json
from dryrun_vision.evaluate.taps_match import NEAR_TAP_S, TapMatch, TapMatchSummary, match_done_taps

__all__ = [
    "NEAR_TAP_S",
    "EvalReport",
    "TapMatch",
    "TapMatchSummary",
    "evaluate_actions",
    "format_report",
    "match_done_taps",
    "report_to_json",
]
