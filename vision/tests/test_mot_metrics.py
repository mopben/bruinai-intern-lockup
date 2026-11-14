from pathlib import Path

import pytest

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import Detection
from dryrun_vision.mot import GtBox, evaluate_tracking, iou, read_mot_gt


def _gt(frame: int, gid: int, x: float, flag: int = 1) -> GtBox:
    return GtBox(frame=frame, id=gid, x=x, y=0.0, w=10.0, h=20.0, flag=flag, ground=(0.0, 0.0))


def _hyp(frame: int, tid: int, x: float) -> Detection:
    return Detection(frame=frame, t=frame / 10, track_id=tid, x=x, y=0.0, w=10.0, h=20.0, score=0.9)


def test_iou():
    a = _gt(0, 1, 0.0)
    assert iou(a, _hyp(0, 1, 0.0)) == 1.0
    assert iou(a, _hyp(0, 1, 5.0)) == pytest.approx(1 / 3)
    assert iou(a, _hyp(0, 1, 50.0)) == 0.0


def test_perfect_tracking():
    gt = [_gt(f, 1, 0.0) for f in range(5)] + [_gt(f, 2, 100.0) for f in range(5)]
    hyp = [_hyp(f, 7, 0.0) for f in range(5)] + [_hyp(f, 8, 100.0) for f in range(5)]
    m, _ = evaluate_tracking(gt, hyp, frames=range(5))
    assert (m.tp, m.fp, m.fn, m.id_switches, m.fragmentations) == (10, 0, 0, 0, 0)
    assert m.mota == 1.0 and m.idf1 == 1.0 and m.precision == 1.0 and m.recall == 1.0


def test_switch_fragmentation_misses_and_false_positives():
    gt = [_gt(f, 1, 0.0) for f in range(6)]
    hyp = [
        _hyp(0, 7, 0.0),
        _hyp(1, 7, 0.0),
        _hyp(3, 9, 0.0),
        _hyp(4, 9, 0.0),
        _hyp(5, 9, 0.0),
        _hyp(2, 5, 300.0),
    ]
    m, matches = evaluate_tracking(gt, hyp, frames=range(6))
    assert (m.tp, m.fp, m.fn, m.id_switches, m.fragmentations) == (5, 1, 1, 1, 1)
    assert m.mota == pytest.approx(1 - (1 + 1 + 1) / 6)
    assert m.idf1 == pytest.approx(2 * 3 / (6 + 6))
    assert m.precision == pytest.approx(5 / 6) and m.recall == pytest.approx(5 / 6)
    assert len(matches) == 5 and {mt.hyp.track_id for mt in matches} == {7, 9}


def test_continuity_keeps_the_previous_match():
    gt = [_gt(0, 1, 0.0), _gt(0, 2, 6.0), _gt(1, 1, 0.0), _gt(1, 2, 6.0)]
    hyp = [_hyp(0, 7, 0.0), _hyp(0, 8, 6.0), _hyp(1, 7, 3.0), _hyp(1, 8, 6.0)]
    m, _ = evaluate_tracking(gt, hyp, frames=range(2), iou_threshold=0.3)
    assert m.id_switches == 0


def test_ignored_ground_truth_is_neither_missed_nor_a_false_positive():
    gt = [_gt(0, 1, 0.0), _gt(0, 2, 100.0, flag=0)]
    hyp = [_hyp(0, 7, 0.0), _hyp(0, 8, 100.0)]
    m, _ = evaluate_tracking(gt, hyp, frames=[0])
    assert (m.gt, m.tp, m.fp, m.fn) == (1, 1, 0, 0)


def test_only_the_given_frames_count():
    gt = [_gt(f, 1, 0.0) for f in range(4)]
    hyp = [_hyp(0, 7, 0.0), _hyp(2, 7, 0.0)]
    m, _ = evaluate_tracking(gt, hyp, frames=[0, 2])
    assert (m.gt, m.fn, m.fragmentations) == (2, 0, 0)


def test_read_mot_gt(tmp_path: Path):
    p = tmp_path / "gt.txt"
    p.write_text("1,9,499,158,31.03,75.17,1,-4.1554,-7.3591,0\n2,9,500,158,31,75,0,-4.1,-7.3,0\n")
    rows = read_mot_gt(p)
    assert rows[0] == GtBox(
        frame=0, id=9, x=499.0, y=158.0, w=31.03, h=75.17, flag=1, ground=(-4.1554, -7.3591)
    )
    assert rows[1].frame == 1 and rows[1].flag == 0


def test_read_mot_gt_errors(tmp_path: Path):
    p = tmp_path / "gt.txt"
    p.write_text("1,9,499\n")
    with pytest.raises(FormatError, match="line 1"):
        read_mot_gt(p)
    p.write_text("1,9,a,158,31,75,1,0,0,0\n")
    with pytest.raises(FormatError, match="line 1"):
        read_mot_gt(p)
    with pytest.raises(FormatError, match="does not exist"):
        read_mot_gt(tmp_path / "nope.txt")


def test_idf1_maximises_total_overlap_not_the_number_of_pairs():
    # gt 1 is followed by hyp 7 for 99 frames and hyp 8 for 1; gt 2 is under hyp 7 for 1 frame.
    gt = [_gt(f, 1, 0.0) for f in range(100)] + [_gt(100, 2, 100.0)]
    hyp = [_hyp(f, 7, 0.0) for f in range(99)] + [_hyp(99, 8, 0.0), _hyp(100, 7, 100.0)]
    m, _ = evaluate_tracking(gt, hyp, frames=range(101))
    assert m.idtp == 99
    assert m.idf1 == pytest.approx(2 * 99 / (101 + 101))
