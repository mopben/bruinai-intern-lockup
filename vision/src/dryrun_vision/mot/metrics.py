"""CLEAR-MOT (MOTA, id switches, fragmentations) and IDF1 against MOTChallenge ground truth.

Per frame, ground-truth boxes and our boxes are matched one-to-one at IoU >= threshold: a pair
matched in the previous frame is kept while it still overlaps enough (CLEAR-MOT continuity), the
rest by the Hungarian method on 1 - IoU. Ignore-flagged ground truth (flag 0) is left out; our
boxes on it count neither way. Definitions follow Bernardin & Stiefelhagen 2008 (CLEAR-MOT) and
Ristani et al. 2016 (IDF1), as in py-motmetrics.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from dryrun_vision.formats import Detection
from dryrun_vision.hungarian import assign
from dryrun_vision.mot.gt import GtBox

IOU_THRESHOLD = 0.5
"""The MOTChallenge standard: a box counts as found when IoU >= 0.5."""


@dataclass(frozen=True)
class Match:
    gt: GtBox
    hyp: Detection
    iou: float


@dataclass(frozen=True)
class TrackingMetrics:
    frames: int
    gt: int
    """Evaluated ground-truth boxes."""
    hyp: int
    """Our boxes, not counting those on ignore regions."""
    tp: int
    fp: int
    fn: int
    id_switches: int
    fragmentations: int
    idtp: int
    gt_ids: int
    hyp_ids: int

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / self.gt if self.gt else 0.0

    @property
    def mota(self) -> float:
        return 1 - (self.fn + self.fp + self.id_switches) / self.gt if self.gt else 0.0

    @property
    def idf1(self) -> float:
        den = self.gt + self.hyp
        return 2 * self.idtp / den if den else 0.0


def iou(g: GtBox, d: Detection) -> float:
    ix = max(0.0, min(g.x + g.w, d.x + d.w) - max(g.x, d.x))
    iy = max(0.0, min(g.y + g.h, d.y + d.h) - max(g.y, d.y))
    inter = ix * iy
    union = g.w * g.h + d.w * d.h - inter
    return inter / union if union > 0 else 0.0


def _by_frame[T](items: Iterable[T], frame_of: object) -> dict[int, list[T]]:
    out: dict[int, list[T]] = defaultdict(list)
    for it in items:
        out[getattr(it, "frame")].append(it)  # noqa: B009 - both types have .frame
    return out


def _match_frame(
    gts: Sequence[GtBox], hyps: Sequence[Detection], prev: dict[int, int], thr: float
) -> list[tuple[int, int, float]]:
    """(gt index, hyp index, iou) pairs for one frame."""
    pairs: list[tuple[int, int, float]] = []
    for gi, g in enumerate(gts):
        hi = next((i for i, h in enumerate(hyps) if prev.get(g.id) == h.track_id), None)
        if hi is not None and (v := iou(g, hyps[hi])) >= thr:
            pairs.append((gi, hi, v))
    used_g, used_h = {p[0] for p in pairs}, {p[1] for p in pairs}
    rest_g = [i for i in range(len(gts)) if i not in used_g]
    rest_h = [i for i in range(len(hyps)) if i not in used_h]
    cost = [[1 - iou(gts[gi], hyps[hi]) for hi in rest_h] for gi in rest_g]
    for a, b in assign(cost, max_cost=1 - thr):
        pairs.append((rest_g[a], rest_h[b], 1 - cost[a][b]))
    return pairs


def _on_ignored(h: Detection, ignored: Sequence[GtBox], thr: float) -> bool:
    return any(iou(g, h) >= thr for g in ignored)


@dataclass
class _Tally:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    switches: int = 0
    hyp: int = 0


def _clear(
    frames: Sequence[int], gt_by: dict[int, list[GtBox]], hyp_by: dict[int, list[Detection]], thr: float
) -> tuple[_Tally, list[Match], dict[int, list[bool]]]:
    tally = _Tally()
    matches: list[Match] = []
    tracked: dict[int, list[bool]] = defaultdict(list)
    prev: dict[int, int] = {}
    last: dict[int, int] = {}
    for f in frames:
        gts = [g for g in gt_by.get(f, []) if g.flag == 1]
        ignored = [g for g in gt_by.get(f, []) if g.flag != 1]
        hyps = hyp_by.get(f, [])
        pairs = _match_frame(gts, hyps, prev, thr)
        matched_h = {hi for _, hi, _ in pairs}
        free = [h for i, h in enumerate(hyps) if i not in matched_h and not _on_ignored(h, ignored, thr)]
        tally.fp += len(free)
        tally.hyp += len(pairs) + len(free)
        tally.tp += len(pairs)
        tally.fn += len(gts) - len(pairs)
        prev = {gts[gi].id: hyps[hi].track_id for gi, hi, _ in pairs}
        for gi, hi, v in pairs:
            g, h = gts[gi], hyps[hi]
            tally.switches += g.id in last and last[g.id] != h.track_id
            last[g.id] = h.track_id
            matches.append(Match(g, h, v))
        for gi, g in enumerate(gts):
            tracked[g.id].append(any(p[0] == gi for p in pairs))
    return tally, matches, tracked


def _fragmentations(tracked: dict[int, list[bool]]) -> int:
    total = 0
    for flags in tracked.values():
        runs = sum(1 for i, f in enumerate(flags) if f and (i == 0 or not flags[i - 1]))
        total += max(0, runs - 1)
    return total


def _idtp(
    frames: Sequence[int], gt_by: dict[int, list[GtBox]], hyp_by: dict[int, list[Detection]], thr: float
) -> int:
    overlap: dict[tuple[int, int], int] = defaultdict(int)
    for f in frames:
        for g in gt_by.get(f, []):
            if g.flag == 1:
                for h in hyp_by.get(f, []):
                    if iou(g, h) >= thr:
                        overlap[(g.id, h.track_id)] += 1
    gids = sorted({k[0] for k in overlap})
    hids = sorted({k[1] for k in overlap})
    # Maximum total overlap: every pair is allowed (no gate), so the matching size is fixed and the
    # solver only minimises the cost. Pairs with no overlap add 0, which is the same as no pair.
    cost = [[-float(overlap.get((g, h), 0)) for h in hids] for g in gids]
    return int(-sum(cost[a][b] for a, b in assign(cost)))


def evaluate_tracking(
    gt: Sequence[GtBox], hyp: Sequence[Detection], frames: Iterable[int], iou_threshold: float = IOU_THRESHOLD
) -> tuple[TrackingMetrics, tuple[Match, ...]]:
    """Metrics over the given (0-based) frames, plus every CLEAR-MOT match (for floor errors)."""
    fs = sorted(set(frames))
    keep = set(fs)
    gt_by = _by_frame((g for g in gt if g.frame in keep), "frame")
    hyp_by = _by_frame((h for h in hyp if h.frame in keep), "frame")
    tally, matches, tracked = _clear(fs, gt_by, hyp_by, iou_threshold)
    metrics = TrackingMetrics(
        frames=len(fs),
        gt=tally.tp + tally.fn,
        hyp=tally.hyp,
        tp=tally.tp,
        fp=tally.fp,
        fn=tally.fn,
        id_switches=tally.switches,
        fragmentations=_fragmentations(tracked),
        idtp=_idtp(fs, gt_by, hyp_by, iou_threshold),
        gt_ids=len({g.id for gs in gt_by.values() for g in gs if g.flag == 1}),
        hyp_ids=len({h.track_id for hs in hyp_by.values() for h in hs}),
    )
    return metrics, tuple(matches)
