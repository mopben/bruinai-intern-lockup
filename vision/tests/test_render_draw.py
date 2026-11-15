import numpy as np
import pytest

from dryrun_vision.formats import ActionSegment, Detection
from dryrun_vision.render import frame_labels, hex_to_bgr, track_colour
from dryrun_vision.render.draw import UNASSIGNED_BGR, draw_labels


def _d(tid: int) -> Detection:
    return Detection(frame=0, t=0.0, track_id=tid, x=5.0, y=5.0, w=20.0, h=30.0, score=0.9)


def test_hex_to_bgr():
    assert hex_to_bgr("#e8312f") == (0x2F, 0x31, 0xE8)
    with pytest.raises(ValueError, match="not a colour"):
        hex_to_bgr("red")


def test_labels_without_names_show_track_ids():
    (lb,) = frame_labels([_d(3)])
    assert lb.text == "#3" and lb.colour == track_colour(3)


def test_labels_with_names_and_actions():
    seg = ActionSegment(worker_id="red", t0=0.0, t1=2.0, kind="work", box_id="ABCDEF123")
    labels = frame_labels(
        [_d(1), _d(9)],
        {1: "red"},
        colours={"red": (1, 2, 3)},
        actions=[seg],
        run_t=1.0,
        box_names={"ABCDEF123": "Till"},
    )
    assert labels[0].text == "red #1 work Till" and labels[0].colour == (1, 2, 3)
    assert labels[1].text == "#9 (not a worker)" and labels[1].colour == UNASSIGNED_BGR
    later = frame_labels([_d(1)], {1: "red"}, actions=[seg], run_t=5.0)
    assert later[0].text == "red #1"


def test_labelled_action_shows_the_model_label():
    seg = ActionSegment(worker_id="red", t0=0.0, t1=2.0, kind="walk", label="carry_cup", confidence=0.7)
    (lb,) = frame_labels([_d(1)], {1: "red"}, actions=[seg], run_t=1.0)
    assert lb.text == "red #1 walk (carry_cup)"


def test_draw_does_not_change_the_input():
    cv2 = pytest.importorskip("cv2")
    img = np.zeros((60, 60, 3), dtype=np.uint8)
    out = draw_labels(img, frame_labels([_d(1)]), cv2, header="t = 0.00 s")
    assert img.sum() == 0 and out.sum() > 0
