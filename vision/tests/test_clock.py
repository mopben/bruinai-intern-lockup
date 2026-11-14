import math

import pytest

from dryrun_vision.clock import RunClock


def test_default_clock_is_the_video_clock():
    c = RunClock()
    assert c.run_time(3.5) == 3.5 and c.video_time(3.5) == 3.5


def test_offset_is_video_seconds_before_the_run_started():
    c = RunClock(start_offset_s=4.2)
    assert c.run_time(10.0) == pytest.approx(5.8)
    assert c.video_time(0.0) == pytest.approx(4.2)


def test_the_two_directions_are_inverse():
    c = RunClock(start_offset_s=1.25)
    for t in (0.0, 0.1, 7.3, 100.0):
        assert c.video_time(c.run_time(t)) == pytest.approx(t)


@pytest.mark.parametrize("bad", [-0.1, math.nan, math.inf])
def test_bad_offsets_are_refused(bad: float):
    with pytest.raises(ValueError, match="start offset"):
        RunClock(start_offset_s=bad)
