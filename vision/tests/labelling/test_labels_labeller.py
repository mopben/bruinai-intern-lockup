import random
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import pytest

from dryrun_vision.clock import RunClock
from dryrun_vision.formats import ActionSegment
from dryrun_vision.formats.actions import find_overlap
from dryrun_vision.labels.crop import Box, CropMargins
from dryrun_vision.labels.errors import LabelError, WindowNotScoredError
from dryrun_vision.labels.labeller import LabelSettings, label_segments
from dryrun_vision.labels.providers.base import Clip
from dryrun_vision.labels.scoring import FrameSettings, WindowJob, score_windows
from dryrun_vision.labels.vocab import Candidate, Vocabulary
from dryrun_vision.labels.windows import Window
from dryrun_vision.labels.worker_boxes import TimedBox, WorkerBoxes
from dryrun_vision.video import VideoFrames
from labelling.helpers import FakeProvider, frame_index

CANDS = (Candidate("dark", ("d",), ("d",)), Candidate("bright", ("b",), ("b",)))
WHOLE = FrameSettings(frames_per_window=2, crop_mode="whole")


def vocab() -> Vocabulary:
    def lab(*names: str) -> dict:
        return {"labels": [{"label": n, "prompts": [n]} for n in names]}

    return Vocabulary.model_validate(
        {
            "format": "dryrun.vocab",
            "version": 1,
            "templates": ["{}"],
            "waitingLabel": "waiting",
            "stations": [{"match": ["espresso"], **lab("waiting", "steaming")}],
            "defaultStation": lab("waiting", "working"),
            "idle": lab("waiting", "talking"),
        }
    )


def seg(worker: str, t0: float, t1: float, kind: str = "work", box: str | None = "esp") -> ActionSegment:
    return ActionSegment(
        worker_id=worker, t0=t0, t1=t1, kind=kind, box_id=box if kind in ("work", "fetch", "carry") else None
    )


# ---- scoring


def test_score_windows_samples_the_right_frames(make_video, fake_provider: FakeProvider):
    jobs = (WindowJob("red", Window(0.0, 2.0), CANDS), WindowJob("red", Window(2.0, 4.0), CANDS))
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        scores = score_windows(jobs, v, fake_provider, {}, WHOLE)
    assert [s.frames for s in scores] == [2, 2]
    seen = [[frame_index(f) for f in clip.frames] for clip, _ in fake_provider.calls]
    assert seen == [[5, 15], [25, 35]]
    assert scores[0].probs == pytest.approx((0.9, 0.1))  # gray 25..75: dark


def test_score_windows_uses_the_run_clock(make_video, fake_provider: FakeProvider):
    jobs = (WindowJob("red", Window(0.0, 2.0), CANDS),)
    s = FrameSettings(frames_per_window=2, crop_mode="whole", clock=RunClock(start_offset_s=1.0))
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        score_windows(jobs, v, fake_provider, {}, s)
    # run times 0.5 and 1.5 s are video times 1.5 and 2.5 s: frames 15 and 25
    assert [[frame_index(f) for f in c.frames] for c, _ in fake_provider.calls] == [[15, 25]]


def test_worker_boxes_are_looked_up_in_video_time(make_video, fake_provider: FakeProvider):
    boxes = {"red": WorkerBoxes("red", (TimedBox(1.5, Box(0, 0, 10, 10)), TimedBox(2.5, Box(0, 0, 30, 30))))}
    s = FrameSettings(
        frames_per_window=2, crop_mode="tracks", margins=CropMargins(0.0, 0.0, 0.0), box_max_gap_s=0.1,
        clock=RunClock(start_offset_s=1.0),
    )  # fmt: skip
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        score_windows((WindowJob("red", Window(0.0, 2.0), CANDS),), v, fake_provider, boxes, s)
    assert [f.shape[:2] for f in fake_provider.calls[0][0].frames] == [(10, 10), (30, 30)]


def test_score_windows_crops_the_worker_box(make_video, fake_provider: FakeProvider):
    boxes = {
        "red": WorkerBoxes("red", (TimedBox(0.0, Box(10, 10, 20, 20)), TimedBox(1.0, Box(50, 30, 20, 20))))
    }
    jobs = (WindowJob("red", Window(0.0, 2.0), CANDS), WindowJob("blue", Window(0.0, 2.0), CANDS))
    s = FrameSettings(
        frames_per_window=2, crop_mode="tracks", margins=CropMargins(0.25, 0.0, 0.0), box_max_gap_s=0.6
    )
    with VideoFrames(make_video(frames=40, fps=10, size=(64, 48))) as v:
        scores = score_windows(jobs, v, fake_provider, boxes, s)
    shapes = [f.shape for f in fake_provider.calls[0][0].frames]
    assert shapes == [
        (20, 30, 3),
        (18, 19, 3),
    ]  # 20+2*5 wide; second box x 45..75 and y 30..50 clamped to 64x48
    assert scores[1].probs is None and scores[1].frames == 0


def test_score_windows_past_the_end_uses_frames_it_has(make_video, fake_provider: FakeProvider):
    jobs = (WindowJob("red", Window(3.0, 5.0), CANDS),)
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        scores = score_windows(jobs, v, fake_provider, {}, WHOLE)
    assert scores[0].frames == 1


def test_centre_crop(make_video, fake_provider: FakeProvider):
    s = FrameSettings(frames_per_window=1, crop_mode="centre", centre_fraction=0.5)
    with VideoFrames(make_video(frames=10, size=(64, 48))) as v:
        score_windows((WindowJob("r", Window(0, 1), CANDS),), v, fake_provider, {}, s)
    assert fake_provider.calls[0][0].frames[0].shape == (24, 32, 3)


# ---- labelling


def test_work_segment_is_split_where_the_picture_changes(make_video, fake_provider: FakeProvider):
    # frames 0..19 gray < 100 (dark), frames 20+ bright: a 4 s work segment splits at 2 s
    segs = (seg("red", 0.0, 4.0),)
    settings = LabelSettings(window_s=1.0, smooth_windows=1, min_confidence=0.5, frames=WHOLE)
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        res = label_segments(
            segs,
            station_names={"esp": "Espresso machine"},
            vocab=vocab(),
            provider=fake_provider,
            video=v,
            boxes={},
            settings=settings,
        )
    assert [(s.t0, s.t1, s.label) for s in res.segments] == [(0.0, 2.0, "waiting"), (2.0, 4.0, "steaming")]
    assert all(s.kind == "work" and s.box_id == "esp" for s in res.segments)
    assert res.segments[0].confidence == 0.9
    assert fake_provider.calls[0][1] == ("waiting", "steaming")


def test_idle_uses_idle_labels_and_other_kinds_pass_through(make_video, fake_provider: FakeProvider):
    walk = seg("red", 1.0, 2.0, "walk")
    fetch = seg("red", 2.0, 3.0, "fetch", "fridge")
    segs = (seg("red", 0.0, 1.0, "idle"), walk, fetch, seg("red", 3.0, 3.5, "work", "till"))
    settings = LabelSettings(window_s=1.0, smooth_windows=1, min_confidence=0.5, frames=WHOLE)
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        res = label_segments(
            segs,
            station_names={"till": "Till"},
            vocab=vocab(),
            provider=fake_provider,
            video=v,
            boxes={},
            settings=settings,
        )
    assert res.segments[1] is walk and res.segments[2] is fetch
    assert [c[1] for c in fake_provider.calls] == [("waiting", "talking"), ("waiting", "working")]
    assert res.segments[0].label == "waiting" and res.segments[3].label == "working"


def test_low_confidence_gives_no_label(make_video):
    unsure = FakeProvider(lambda _c, cands: [1 / len(cands)] * len(cands))
    settings = LabelSettings(window_s=1.0, smooth_windows=1, min_confidence=0.6, frames=WHOLE)
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        res = label_segments(
            (seg("red", 0.0, 3.0),), station_names={"esp": "espresso"}, vocab=vocab(), provider=unsure,
            video=v, boxes={}, settings=settings,
        )  # fmt: skip
    assert [(s.t0, s.t1, s.label, s.confidence) for s in res.segments] == [(0.0, 3.0, None, None)]


def test_warnings_for_unknown_station_and_missing_worker_boxes(make_video, fake_provider: FakeProvider):
    settings = LabelSettings(window_s=1.0, frames=FrameSettings(frames_per_window=1, crop_mode="tracks"))
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        res = label_segments(
            (seg("red", 0.0, 2.0, box="zzz"),), station_names={}, vocab=vocab(), provider=fake_provider,
            video=v, boxes={}, settings=settings,
        )  # fmt: skip
    assert any("zzz" in w for w in res.warnings)
    assert any('worker "red"' in w for w in res.warnings)
    assert res.unscored_windows == 2 and res.windows == 2
    assert res.segments[0].label is None


def random_segments(rng: random.Random, workers: Sequence[str], end: float) -> list[ActionSegment]:
    out = []
    for w in workers:
        t = round(rng.uniform(0, 1), 3)
        while t < end - 0.01:
            t1 = round(min(end, t + rng.uniform(0.01, 6)), 3)
            kind = rng.choice(["work", "work", "idle", "walk", "fetch", "carry"])
            box = rng.choice(["esp", "till"]) if kind in ("work", "fetch", "carry") else None
            out.append(ActionSegment(worker_id=w, t0=t, t1=t1, kind=kind, box_id=box))
            t = round(t1 + rng.choice([0.0, 0.0, rng.uniform(0, 1)]), 3)
    return out


def random_rule(clip: Clip, cands: Sequence[Candidate]) -> list[float]:
    rng = random.Random(int(np.mean([f.mean() for f in clip.frames]) * 1000))
    raw = [rng.random() ** 3 for _ in cands]
    return [r / sum(raw) for r in raw]


def test_contract_property(make_video):
    rng = random.Random(5)
    video = make_video(frames=51, fps=2.5)  # 20.4 s
    for trial in range(25):
        segs = random_segments(rng, ["red", "blue"], 20.0)
        settings = LabelSettings(
            window_s=rng.choice([0.5, 1.0, 2.0]),
            smooth_windows=rng.choice([1, 3, 5]),
            min_confidence=rng.choice([0.0, 0.5, 0.7]),
            frames=FrameSettings(frames_per_window=rng.choice([1, 3]), crop_mode="whole"),
        )
        with VideoFrames(video) as v:
            res = label_segments(
                segs, station_names={"esp": "espresso", "till": "till"}, vocab=vocab(),
                provider=FakeProvider(random_rule), video=v, boxes={}, settings=settings,
            )  # fmt: skip
        out = res.segments
        assert find_overlap(out) is None, trial
        assert all(s.t1 > s.t0 for s in out)
        assert all((s.label is None) == (s.confidence is None) for s in out)
        for original in segs:
            inside = [
                s
                for s in out
                if s.worker_id == original.worker_id and original.t0 <= s.t0 and s.t1 <= original.t1
            ]
            assert {(s.kind, s.box_id) for s in inside} == {(original.kind, original.box_id)}
            assert sum(s.duration for s in inside) == pytest.approx(original.duration, abs=2e-3)
            labelled = sum(s.duration for s in inside if s.label is not None)
            assert labelled <= original.duration + 1e-9
            if original.kind not in ("work", "idle"):
                assert inside == [original]


# ---- failures and concurrency


@dataclass
class Failing:
    """Fails with `error` on the calls whose number (from 1) is in `fail_on`."""

    error: Exception
    fail_on: frozenset[int]
    name: str = "failing"
    n: int = 0

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        self.n += 1
        if self.n in self.fail_on:
            raise self.error
        return (0.9, 0.1)


JOBS = tuple(WindowJob("red", Window(t, t + 1.0), CANDS) for t in (0.0, 1.0, 2.0))


def test_a_window_that_cannot_be_scored_is_left_unscored(make_video):
    p = Failing(WindowNotScoredError("Gemini was refused 5 times in a row"), frozenset({2}))
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        scores = score_windows(JOBS, v, p, {}, WHOLE)
    assert [s.probs is None for s in scores] == [False, True, False]
    assert scores[1].error == "Gemini was refused 5 times in a row" and scores[1].frames == 2


def test_label_segments_reports_unscored_windows(make_video):
    p = Failing(WindowNotScoredError("cap reached"), frozenset({2, 3}))
    settings = LabelSettings(window_s=1.0, smooth_windows=1, min_confidence=0.5, frames=WHOLE)
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        res = label_segments(
            (seg("red", 0.0, 4.0),), station_names={"esp": "Espresso machine"}, vocab=vocab(),
            provider=p, video=v, boxes={}, settings=settings,
        )  # fmt: skip
    assert res.unscored_windows == 2
    assert any("2 windows could not be scored" in w and "cap reached" in w for w in res.warnings)


def test_other_provider_errors_stop_the_run(make_video):
    p = Failing(LabelError("The Gemini API refused the request (401)"), frozenset({1}))
    with VideoFrames(make_video(frames=40, fps=10)) as v, pytest.raises(LabelError, match="401"):
        score_windows(JOBS, v, p, {}, WHOLE)


@dataclass
class Concurrent:
    max_concurrency: int = 3
    name: str = "concurrent"
    threads: set[int] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        time.sleep(0.02)
        with self.lock:
            self.threads.add(threading.get_ident())
        level = frame_index(clip.frames[0]) / 100
        return (level, 1 - level)


def test_providers_that_allow_it_are_called_concurrently_with_results_in_job_order(make_video):
    jobs = tuple(WindowJob("red", Window(t / 10, t / 10 + 0.1), CANDS) for t in range(12))
    s = FrameSettings(frames_per_window=1, crop_mode="whole")
    p = Concurrent()
    with VideoFrames(make_video(frames=40, fps=10)) as v:
        scores = score_windows(jobs, v, p, {}, s)
    assert [s.probs[0] for s in scores] == pytest.approx([k / 100 for k in range(12)])
    assert len(p.threads) > 1
