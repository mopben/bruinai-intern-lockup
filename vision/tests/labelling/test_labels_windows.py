import random
from itertools import pairwise

import numpy as np
import pytest

from dryrun_vision.labels.crop import (
    Box,
    CropMargins,
    centre_box,
    clamp_box,
    crop_frame,
    downscale,
    expand_box,
)
from dryrun_vision.labels.windows import Window, sample_times, split_windows


def test_split_even():
    assert split_windows(0.0, 6.0, 2.0, 0.5) == (Window(0.0, 2.0), Window(2.0, 4.0), Window(4.0, 6.0))


def test_split_short_remainder_joins_last_window():
    assert split_windows(1.0, 5.3, 2.0, 0.5) == (Window(1.0, 3.0), Window(3.0, 5.3))


def test_split_long_remainder_is_its_own_window():
    assert split_windows(0.0, 4.6, 2.0, 0.5) == (Window(0.0, 2.0), Window(2.0, 4.0), Window(4.0, 4.6))


def test_split_shorter_than_one_window_is_one_window():
    assert split_windows(3.0, 3.4, 2.0, 0.5) == (Window(3.0, 3.4),)


def test_split_rounds_boundaries_to_milliseconds():
    ws = split_windows(0.1, 6.4, 2.1, 0.5)
    assert ws[0].t0 == 0.1 and ws[-1].t1 == 6.4
    assert all(a.t1 == b.t0 for a, b in pairwise(ws))


def test_split_rejects_empty_span_and_bad_sizes():
    with pytest.raises(ValueError, match="later"):
        split_windows(2.0, 2.0, 2.0, 0.5)
    with pytest.raises(ValueError, match="window"):
        split_windows(0.0, 1.0, 0.0, 0.5)


def test_split_property_tiles_the_span():
    rng = random.Random(7)
    for _ in range(500):
        t0 = round(rng.uniform(0, 100), 3)
        t1 = round(t0 + rng.uniform(0.002, 30), 3)
        ws = split_windows(t0, t1, 2.0, 0.5)
        assert ws[0].t0 == t0 and ws[-1].t1 == t1
        assert all(w.t1 > w.t0 for w in ws)
        assert all(a.t1 == b.t0 for a, b in pairwise(ws))
        assert len(ws) == 1 or all(w.t1 - w.t0 >= 0.5 - 1e-9 for w in ws)


def test_sample_times_are_centres_of_equal_parts():
    assert sample_times(Window(0.0, 2.0), 4) == (0.25, 0.75, 1.25, 1.75)
    assert sample_times(Window(1.0, 2.0), 1) == (1.5,)
    with pytest.raises(ValueError, match="at least one"):
        sample_times(Window(0.0, 1.0), 0)


def test_expand_box_adds_margins_around_the_person():
    b = expand_box(Box(100, 50, 40, 100), CropMargins(side=0.25, top=0.1, bottom=0.2))
    assert b == Box(90, 40, 60, 130)


def test_clamp_box_at_image_edges():
    assert clamp_box(Box(-10, -5, 30, 30), 100, 80) == Box(0, 0, 20, 25)
    assert clamp_box(Box(90, 70, 30, 30), 100, 80) == Box(90, 70, 10, 10)
    assert clamp_box(Box(10, 10, 20, 20), 100, 80) == Box(10, 10, 20, 20)


def test_clamp_box_fully_outside_is_none():
    assert clamp_box(Box(200, 10, 20, 20), 100, 80) is None
    assert clamp_box(Box(10, -50, 20, 20), 100, 80) is None


def test_crop_frame_cuts_whole_pixels_and_copies():
    frame = np.arange(10 * 12 * 3, dtype=np.uint8).reshape(10, 12, 3)
    out = crop_frame(frame, Box(2.4, 1.6, 3.2, 4.0))
    assert out.shape == (5, 4, 3)  # x 2..6, y 1..6
    assert (out == frame[1:6, 2:6]).all()
    out[0, 0, 0] = 255
    assert frame[1, 2, 0] != 255


def test_crop_property_always_inside_image():
    rng = random.Random(3)
    frame = np.zeros((48, 64, 3), dtype=np.uint8)
    for _ in range(300):
        b = Box(rng.uniform(-80, 80), rng.uniform(-60, 60), rng.uniform(1, 90), rng.uniform(1, 90))
        c = clamp_box(expand_box(b, CropMargins(0.3, 0.1, 0.1)), 64, 48)
        if c is None:
            continue
        assert c.x >= 0 and c.y >= 0 and c.x + c.w <= 64 and c.y + c.h <= 48
        out = crop_frame(frame, c)
        assert out.shape[0] >= 1 and out.shape[1] >= 1


def test_centre_box():
    assert centre_box(100, 80, 0.5) == Box(25, 20, 50, 40)
    with pytest.raises(ValueError, match="fraction"):
        centre_box(100, 80, 0.0)


def test_downscale_keeps_small_frames_and_shrinks_big_ones():
    small = np.zeros((40, 30, 3), dtype=np.uint8)
    assert downscale(small, 64) is small or downscale(small, 64).shape == small.shape
    big = np.zeros((400, 200, 3), dtype=np.uint8)
    assert downscale(big, 100).shape == (100, 50, 3)


def test_box_rejects_non_positive_size():
    with pytest.raises(ValueError, match="size"):
        Box(0, 0, 0, 10)
