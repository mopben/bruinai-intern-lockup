"""From per-window probabilities to per-window labels: neighbourhood majority vote, then a threshold."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

Probs = tuple[float, ...]


@dataclass(frozen=True)
class Decision:
    """A window's label and how sure we are; both None when the window gets no label."""

    label: str | None
    confidence: float | None


NO_LABEL = Decision(None, None)


def _argmax(p: Probs) -> int:
    return max(range(len(p)), key=lambda i: p[i])


def _winner(own: Probs, neighbours: Sequence[Probs]) -> int:
    votes = Counter(_argmax(p) for p in neighbours)
    top = max(votes.values())
    tied = [i for i, n in votes.items() if n == top]
    if _argmax(own) in tied:
        return _argmax(own)
    return max(tied, key=lambda i: sum(p[i] for p in neighbours))


def smooth_decisions(
    probs: Sequence[Probs | None], labels: Sequence[str], width: int, min_confidence: float
) -> tuple[Decision, ...]:
    """For each window: the majority label of the `width` windows centred on it (only scored ones vote).

    The confidence is the mean probability of that label over the voters; below `min_confidence`
    the window gets no label. Unscored windows (None) always get no label.
    """
    if width < 1 or width % 2 == 0:
        raise ValueError(f"the smoothing width must be an odd number of windows (got {width})")
    half = width // 2
    out: list[Decision] = []
    for i, own in enumerate(probs):
        if own is None:
            out.append(NO_LABEL)
            continue
        voters = [p for p in probs[max(0, i - half) : i + half + 1] if p is not None]
        win = _winner(own, voters)
        confidence = sum(p[win] for p in voters) / len(voters)
        out.append(Decision(labels[win], confidence) if confidence >= min_confidence else NO_LABEL)
    return tuple(out)
