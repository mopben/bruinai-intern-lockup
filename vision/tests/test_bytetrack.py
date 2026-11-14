import pytest

pytest.importorskip("trackers")

from dryrun_vision.detect import PersonBox
from dryrun_vision.track import ByteTrackTracker


def _boxes(k: int) -> tuple[PersonBox, ...]:
    return (PersonBox(10.0 + k, 10.0, 50.0 + k, 100.0, 0.9), PersonBox(200.0, 10.0, 240.0, 100.0, 0.8))


def _run(tracker: ByteTrackTracker, frames: int) -> list[dict[int, float]]:
    out = []
    for k in range(frames):
        out.append({t.track_id: t.box.x1 for t in tracker.update(_boxes(k))})
    return out


def test_two_people_keep_their_ids():
    frames = _run(ByteTrackTracker(fps=10.0), 6)
    assert frames[0] == {}  # a track needs two frames before it gets an id
    assert all(set(f) == {1, 2} for f in frames[1:])
    assert frames[-1][1] == 15.0 and frames[-1][2] == 200.0


def test_ids_restart_for_each_tracker():
    _run(ByteTrackTracker(fps=10.0), 4)
    frames = _run(ByteTrackTracker(fps=10.0), 4)
    assert set(frames[-1]) == {1, 2}


def test_a_lost_person_comes_back_with_the_same_id_within_the_buffer():
    tr = ByteTrackTracker(fps=10.0, lost_seconds=1.0)
    for k in range(5):
        tr.update(_boxes(k))
    for _ in range(3):
        tr.update(())
    back = tr.update(_boxes(5))
    assert {t.track_id for t in back} == {1, 2}


def test_bad_settings():
    with pytest.raises(ValueError, match="frame rate"):
        ByteTrackTracker(fps=0.0)
    assert ByteTrackTracker(fps=7.0).name.startswith("bytetrack")
