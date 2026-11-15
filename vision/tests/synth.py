"""Synthetic tracks.jsonl from a fixture run: every fixture position drawn as a person box.

The camera is the golden "box-tops" calibration of the fixture (tests/golden/golden.json, made by
tools/camera/synth-calibration.ts). The same solved model draws and reads back the boxes, so the
calibration itself is exact here: floor errors measure the tracking corruptions only.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from conftest import FIXTURES_DIR, golden_fixture
from dryrun_vision.formats import (
    CalibrationFile,
    Detection,
    PositionSample,
    TracksHeader,
    VideoInfo,
    read_positions,
)
from dryrun_vision.geometry import CameraModel, model_from_calibration, project_at

BOX_WIDTH_OF_HEIGHT = 0.38
"""A standing adult's box is about 0.38 times as wide as it is tall."""
CUSTOMER_HEAD_M = 1.72
"""Metres. The customers' head height (not in the calibration; identity uses the workers' mean)."""
FIXTURE_MAX_GAP_S = 0.5
"""Fixture samples further apart than this are a gap in the fixture itself: no boxes across it."""


def golden_calibration(fixture: str) -> CalibrationFile:
    return CalibrationFile.model_validate(golden_fixture(fixture)["calibrations"]["boxTops"]["calibration"])


def person_box(  # noqa: PLR0917 - mirrors project_at plus the picture size
    model: CameraModel,
    floor: tuple[float, float],
    head_m: float,
    width: float,
    height: float,
    centre: str = "both",
) -> tuple[float, float, float, float] | None:
    """(x, y, w, h) of a person standing at floor point, head at head_m; clipped to the picture.

    The box runs from the head down to the feet. Seen from the side a standing person leans in the
    picture (head and feet at different x), and a detector's box encloses both: centre="both".
    centre="head" or "foot" centres the box on that point instead (exact for that anchor).
    """
    head, foot = project_at(model, floor, head_m), project_at(model, floor, 0.0)
    if head is None or foot is None or foot[1] <= head[1]:
        return None
    h = foot[1] - head[1]
    w = BOX_WIDTH_OF_HEIGHT * h
    left = {"head": head[0], "foot": foot[0]}.get(centre, min(head[0], foot[0]))
    right = {"head": head[0], "foot": foot[0]}.get(centre, max(head[0], foot[0]))
    x1, y1 = max(0.0, left - w / 2), max(0.0, head[1])
    x2, y2 = min(width, right + w / 2), min(height, foot[1])
    if x2 - x1 < 2 or y2 - y1 < 2 or head[1] < 0:
        return None
    return (x1, y1, x2 - x1, y2 - y1)


@dataclass(frozen=True)
class Customer:
    track_id: int
    t0: float
    t1: float
    a: tuple[float, float]
    b: tuple[float, float]
    """Walks from a to b and back over [t0, t1] (a == b: stands still)."""

    def at(self, t: float) -> tuple[float, float]:
        u = (t - self.t0) / (self.t1 - self.t0)
        s = 1 - abs(2 * u - 1)
        return (self.a[0] + s * (self.b[0] - self.a[0]), self.a[1] + s * (self.b[1] - self.a[1]))


DEFAULT_CUSTOMERS = (
    Customer(91, 5.0, 60.0, (2.4, 3.8), (2.5, 3.85)),
    Customer(92, 15.0, 75.0, (1.6, 3.75), (3.3, 3.75)),
)
"""Two customers on the far side of the queue counter, just outside the room bounds (z up to 3.48):
one waiting, one walking along the counter. Their feet are below the picture, as in a real café."""


@dataclass(frozen=True)
class Corruption:
    seed: int = 7
    fps: float = 30.0
    jitter_px: float = 2.0
    """Standard deviation of each box edge, pixels."""
    drop_rate: float = 0.05
    """Share of single boxes lost at random."""
    occlusions: int = 6
    """Number of 0.6 s holes per worker (someone walking in front)."""
    switch: tuple[str, float, float] | None = ("blue", 40.0, 1.5)
    """(worker, t, gap s): the worker vanishes at t for gap s and comes back with a new track id."""
    customers: tuple[Customer, ...] = field(default=DEFAULT_CUSTOMERS)


def _worker_paths(fixture: str) -> tuple[str, dict[str, list[PositionSample]]]:
    pf = read_positions(FIXTURES_DIR / fixture / "positions.jsonl")
    by: dict[str, list[PositionSample]] = {}
    for s in pf.samples:
        by.setdefault(s.worker_id, []).append(s)
    return pf.header.started_at, {w: sorted(v, key=lambda s: s.t) for w, v in by.items()}


def _interp(samples: list[PositionSample], t: float) -> tuple[float, float] | None:
    lo, hi = 0, len(samples) - 1
    if t < samples[0].t or t > samples[-1].t:
        return None
    while hi - lo > 1:
        mid = (lo + hi) // 2
        lo, hi = (mid, hi) if samples[mid].t <= t else (lo, mid)
    a, b = samples[lo], samples[hi]
    if b.t - a.t > FIXTURE_MAX_GAP_S:
        return None
    u = 0.0 if b.t == a.t else (t - a.t) / (b.t - a.t)
    return (a.x + u * (b.x - a.x), a.z + u * (b.z - a.z))


def _holes(rng: random.Random, n: int, t_end: float) -> list[tuple[float, float]]:
    starts = [rng.uniform(1.0, t_end - 1.0) for _ in range(n)]
    return [(s, s + 0.6) for s in starts]


def _jittered(rng: random.Random, box: tuple[float, float, float, float], sigma: float) -> tuple[float, ...]:
    x, y, w, h = (v + rng.gauss(0.0, sigma) for v in box)
    return (max(0.0, x), max(0.0, y), max(2.0, w), max(2.0, h))


@dataclass(frozen=True)
class SynthTracks:
    header: TracksHeader
    detections: tuple[Detection, ...]
    started_at: str
    truth: dict[int, str]
    """Track id -> worker id (customers map to "customer")."""
    calibration: CalibrationFile
    positions: dict[str, list[PositionSample]]


def _worker_boxes(  # noqa: PLR0917 - one private helper of the generator
    rng: random.Random,
    c: Corruption,
    model: CameraModel,
    cal: CalibrationFile,
    w: str,
    samples: list,
    ids: tuple,
) -> list[Detection]:
    """Boxes of one worker; ids = (track id, track id after the switch or None)."""
    tid, new_id = ids
    t_end = samples[-1].t
    holes = _holes(rng, c.occlusions, t_end)
    out: list[Detection] = []
    for k in range(math.floor(t_end * c.fps) + 1):
        t = k / c.fps
        p = _interp(samples, t)
        if p is None or rng.random() < c.drop_rate or any(a <= t < b for a, b in holes):
            continue
        ident = tid
        if new_id is not None and c.switch is not None:
            _, ts, gap = c.switch
            if ts <= t < ts + gap:
                continue
            ident = new_id if t >= ts + gap else tid
        box = person_box(model, p, cal.hat_heights[w], cal.image_size.width, cal.image_size.height)
        if box is not None:
            x, y, bw, bh = _jittered(rng, box, c.jitter_px)
            out.append(Detection(frame=k, t=t, track_id=ident, x=x, y=y, w=bw, h=bh, score=0.9))
    return out


def _customer_boxes(
    rng: random.Random, c: Corruption, model: CameraModel, cal: CalibrationFile
) -> list[Detection]:
    out: list[Detection] = []
    for cust in c.customers:
        for k in range(math.ceil(cust.t0 * c.fps), math.floor(cust.t1 * c.fps) + 1):
            t = k / c.fps
            box = person_box(model, cust.at(t), CUSTOMER_HEAD_M, cal.image_size.width, cal.image_size.height)
            if box is not None and rng.random() >= c.drop_rate:
                x, y, bw, bh = _jittered(rng, box, c.jitter_px)
                out.append(Detection(frame=k, t=t, track_id=cust.track_id, x=x, y=y, w=bw, h=bh, score=0.8))
    return out


def fixture_tracks(fixture: str, c: Corruption = Corruption()) -> SynthTracks:
    """Person boxes for every worker of the fixture (and the customers), at c.fps, corrupted."""
    rng = random.Random(c.seed)
    cal = golden_calibration(fixture)
    model = model_from_calibration(cal)
    started_at, paths = _worker_paths(fixture)
    truth: dict[int, str] = {}
    dets: list[Detection] = []
    next_id = 1
    for w, samples in paths.items():
        switched = c.switch is not None and c.switch[0] == w
        ids = (next_id, next_id + 1 if switched else None)
        truth = {**truth, **{i: w for i in ids if i is not None}}
        next_id += 2 if switched else 1
        dets.extend(_worker_boxes(rng, c, model, cal, w, samples, ids))
    truth = {**truth, **{cust.track_id: "customer" for cust in c.customers}}
    dets.extend(_customer_boxes(rng, c, model, cal))
    t_end = max(s[-1].t for s in paths.values())
    frames = math.floor(t_end * c.fps) + 1
    w, h = int(cal.image_size.width), int(cal.image_size.height)
    info = VideoInfo(file=f"{fixture}-synthetic.mp4", width=w, height=h, fps=c.fps, frames=frames)
    header = TracksHeader(video=info, detector="synthetic", tracker="synthetic")
    ordered = tuple(sorted(dets, key=lambda d: (d.frame, d.track_id)))
    return SynthTracks(header, ordered, started_at, truth, cal, paths)
