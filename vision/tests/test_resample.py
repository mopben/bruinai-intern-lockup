import math

import pytest

from dryrun_vision.clock import RunClock
from dryrun_vision.geometry import Vec2
from dryrun_vision.positions import resample_track, running_median
from dryrun_vision.positions.resample import MAX_BRIDGE_S


def _line(fps: float, t0: float, t1: float, speed: float = 1.0) -> tuple[list[float], list[Vec2]]:
    n = round((t1 - t0) * fps) + 1
    ts = [t0 + k / fps for k in range(n)]
    return ts, [Vec2(speed * t, 0.5) for t in ts]


@pytest.mark.parametrize("fps", [7.0, 24.0, 29.97, 30.0])
def test_ticks_are_on_the_10_hz_grid_and_follow_a_steady_walk(fps: float):
    ts, pts = _line(fps, 0.0, 5.0)
    out = resample_track(ts, pts, hz=10.0)
    times = [t for t, _ in out]
    assert times[0] == pytest.approx(0.0) and times[-1] <= 5.0 + 1e-9
    assert all(abs(t * 10 - round(t * 10)) < 1e-9 for t in times)
    assert len(times) >= 50
    assert max(abs(p.x - t) for t, p in out) < 0.01  # a symmetric window has no lag on a straight walk


def test_no_extrapolation_before_the_first_or_after_the_last_point():
    ts, pts = _line(30.0, 1.234, 2.0)
    out = resample_track(ts, pts, hz=10.0)
    assert out[0][0] == pytest.approx(1.3) and out[-1][0] == pytest.approx(2.0)


def test_a_short_hole_is_bridged_and_a_long_one_is_not():
    ts, pts = _line(30.0, 0.0, 10.0)
    short = [(t, p) for t, p in zip(ts, pts, strict=True) if not 2.0 < t < 2.0 + MAX_BRIDGE_S * 0.8]
    out = resample_track([t for t, _ in short], [p for _, p in short], hz=10.0)
    assert any(2.1 < t < 2.0 + MAX_BRIDGE_S * 0.8 for t, _ in out)
    long_ = [(t, p) for t, p in zip(ts, pts, strict=True) if not 2.0 < t < 4.0]
    out = resample_track([t for t, _ in long_], [p for _, p in long_], hz=10.0)
    assert not any(2.05 < t < 3.95 for t, _ in out)
    assert any(t == pytest.approx(2.0) for t, _ in out) and any(t == pytest.approx(4.0) for t, _ in out)


def test_offset_shifts_the_clock():
    ts, pts = _line(30.0, 0.0, 3.0)
    out = resample_track(ts, pts, hz=10.0, clock=RunClock(start_offset_s=1.25))
    assert out[0][0] == pytest.approx(0.0)
    assert out[0][1].x == pytest.approx(1.25, abs=0.01)
    assert out[-1][0] == pytest.approx(1.7)


def test_jitter_is_smoothed():
    ts, pts = _line(30.0, 0.0, 4.0, speed=0.0)
    noisy = [Vec2(0.02 * math.sin(i * 2.3), 0.5) for i in range(len(pts))]
    out = resample_track(ts, noisy, hz=10.0)
    assert max(abs(p.x) for _, p in out) < 0.012


def test_running_median_removes_one_box_spikes():
    pts = [Vec2(0, 0), Vec2(0, 0), Vec2(5, 5), Vec2(0, 0), Vec2(0, 0)]
    assert running_median(pts) == (Vec2(0, 0),) * 5
    assert running_median([Vec2(1, 0), Vec2(0, 0), Vec2(3, 0)]) == (Vec2(1, 0), Vec2(1, 0), Vec2(3, 0))
    assert running_median([Vec2(1, 2)]) == (Vec2(1, 2),)
    assert running_median([]) == ()


def test_input_checks():
    assert resample_track([], [], hz=10.0) == ()
    with pytest.raises(ValueError, match="same number"):
        resample_track([0.0], [], hz=10.0)
    with pytest.raises(ValueError, match="time order"):
        resample_track([1.0, 0.5], [Vec2(0, 0), Vec2(0, 0)], hz=10.0)
    with pytest.raises(ValueError, match="rate"):
        resample_track([0.0], [Vec2(0, 0)], hz=0.0)
