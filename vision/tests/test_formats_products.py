import json
import logging
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import REPO_ROOT
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import (
    ActionSegment,
    ActionsHeader,
    Detection,
    PositionSample,
    PositionsHeader,
    TracksHeader,
    VideoInfo,
    read_actions,
    read_positions,
    read_tracks,
    write_actions,
    write_positions,
    write_tracks,
)

STARTED = "2026-11-12T15:10:05.000Z"


def _tracks_header() -> TracksHeader:
    return TracksHeader(
        video=VideoInfo(file="run.mp4", width=1920, height=1080, fps=30.0, frames=2700),
        detector="det",
        tracker="trk",
    )


def test_tracks_round_trip_and_exact_contract_text(tmp_path: Path):
    dets = (
        Detection(frame=1, t=0.033, track_id=1, x=1.0, y=2.0, w=3.0, h=4.0, score=0.5),
        Detection(frame=0, t=0.0, track_id=3, x=812.5, y=240.0, w=96.0, h=310.0, score=0.91),
    )
    p = tmp_path / "tracks.jsonl"
    write_tracks(p, _tracks_header(), dets)
    lines = p.read_text().splitlines()
    assert json.loads(lines[0]) == {
        "type": "header",
        "format": "dryrun.tracks",
        "version": 1,
        "video": {"file": "run.mp4", "width": 1920, "height": 1080, "fps": 30.0, "frames": 2700},
        "detector": "det",
        "tracker": "trk",
    }
    assert json.loads(lines[1]) == {
        "type": "det",
        "frame": 0,
        "t": 0.0,
        "trackId": 3,
        "x": 812.5,
        "y": 240.0,
        "w": 96.0,
        "h": 310.0,
        "score": 0.91,
    }
    back = read_tracks(p)
    assert [d.frame for d in back.detections] == [0, 1]
    assert back.header.video.fps == 30.0


def test_tracks_must_be_sorted(tmp_path: Path):
    p = tmp_path / "tracks.jsonl"
    header = json.dumps(_tracks_header().to_json())
    det = '{"type":"det","frame":%d,"t":0,"trackId":%d,"x":0,"y":0,"w":1,"h":1,"score":0.5}'
    p.write_text("\n".join([header, det % (1, 1), det % (0, 1)]) + "\n")
    with pytest.raises(FormatError, match=r"line 3.*sorted"):
        read_tracks(p)


def test_detection_rejects_bad_values():
    with pytest.raises(ValueError):
        Detection(frame=0, t=0, track_id=1, x=0, y=0, w=0, h=1, score=0.5)
    with pytest.raises(ValueError):
        Detection(frame=0, t=0, track_id=1, x=0, y=0, w=1, h=1, score=1.5)


def _seg(worker: str, t0: float, t1: float, kind: str, box: str | None = None, **kw) -> ActionSegment:
    return ActionSegment(worker_id=worker, t0=t0, t1=t1, kind=kind, box_id=box, **kw)


def test_actions_round_trip_matches_contract(tmp_path: Path):
    segs = (
        _seg("blue", 7.1, 11.2, "work", "S", label="steaming milk", confidence=0.71),
        _seg("red", 1.4, 2.8, "work", "S"),
        _seg("blue", 2.9, 7.1, "fetch", "F"),
        _seg("blue", 11.2, 12.00049, "walk"),
    )
    p = tmp_path / "actions.jsonl"
    write_actions(p, ActionsHeader(started_at=STARTED, source="zones+model", model="m1"), segs)
    lines = [json.loads(x) for x in p.read_text().splitlines()]
    assert lines[0] == {
        "type": "header",
        "format": "dryrun.actions",
        "version": 1,
        "startedAt": STARTED,
        "source": "zones+model",
        "model": "m1",
    }
    assert lines[1] == {
        "type": "action",
        "workerId": "red",
        "t0": 1.4,
        "t1": 2.8,
        "kind": "work",
        "boxId": "S",
    }
    assert lines[3]["label"] == "steaming milk"
    assert lines[4] == {"type": "action", "workerId": "blue", "t0": 11.2, "t1": 12.0, "kind": "walk"}
    back = read_actions(p)
    assert back.header.model == "m1"
    assert [s.t0 for s in back.segments] == [1.4, 2.9, 7.1, 11.2]


@pytest.mark.parametrize(
    ("kind", "box", "extra"),
    [
        ("work", None, {}),
        ("walk", "S", {}),
        ("idle", "S", {}),
        ("work", "S", {"confidence": 2.0}),
        ("work", "S", {"label": "", "confidence": 0.5}),
        ("work", "S", {"label": "x"}),
        ("work", "S", {"confidence": 0.5}),
        ("jump", "S", {}),
    ],
)
def test_action_kind_and_box_rules(kind, box, extra):
    with pytest.raises(ValueError):
        _seg("red", 0, 1, kind, box, **extra)


def test_action_needs_positive_duration():
    with pytest.raises(ValueError, match="t1"):
        _seg("red", 2, 2, "walk")


def test_overlapping_segments_rejected_on_write(tmp_path: Path):
    segs = (_seg("red", 0, 2, "walk"), _seg("red", 1, 3, "idle"))
    with pytest.raises(FormatError, match="overlap"):
        write_actions(tmp_path / "a.jsonl", ActionsHeader(started_at=STARTED, source="zones"), segs)


def test_positions_writer_round_trip(counter_a: Path, tmp_path: Path):
    src = read_positions(counter_a / "positions.jsonl")
    out = tmp_path / "positions.jsonl"
    write_positions(out, src.header, src.samples)
    assert read_positions(out).samples == src.samples


def test_positions_writer_sorts_and_rounds(tmp_path: Path):
    header = PositionsHeader(started_at=STARTED, hz=10)
    samples = (
        PositionSample(t=0.10049, worker_id="red", x=1.23456, z=2.0),
        PositionSample(t=0.0, worker_id="red", x=1.0, z=2.0),
    )
    out = tmp_path / "positions.jsonl"
    write_positions(out, header, samples)
    lines = out.read_text().splitlines()
    assert json.loads(lines[2]) == {"type": "pos", "t": 0.1, "workerId": "red", "x": 1.235, "z": 2.0}


@pytest.mark.skipif(shutil.which("npx") is None, reason="needs node")
def test_written_positions_pass_the_typescript_validator(counter_a: Path, tmp_path: Path):
    run = tmp_path / "counter-a"
    shutil.copytree(counter_a, run)
    src = read_positions(counter_a / "positions.jsonl")
    write_positions(run / "positions.jsonl", src.header, src.samples)
    res = subprocess.run(
        ["npx", "tsx", "tools/world/validate.ts", str(run)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert res.returncode == 0, res.stdout + res.stderr
    assert "OK" in res.stdout


ACTIONS_HEAD = json.dumps(ActionsHeader(started_at=STARTED, source="zones").to_json())


def _action(worker: str, t0: float, t1: float) -> str:
    return json.dumps({"type": "action", "workerId": worker, "t0": t0, "t1": t1, "kind": "walk"})


def test_actions_in_t0_order_with_any_worker_order_are_read(tmp_path, caplog):
    p = tmp_path / "actions.jsonl"
    p.write_text("\n".join([ACTIONS_HEAD, _action("red", 0, 1), _action("blue", 0, 1)]) + "\n")
    with caplog.at_level(logging.WARNING, logger="dryrun_vision"):
        f = read_actions(p)
    assert [s.worker_id for s in f.segments] == ["blue", "red"] and caplog.messages == []


def test_actions_out_of_time_order_are_sorted_with_a_warning(tmp_path, caplog):
    p = tmp_path / "actions.jsonl"
    p.write_text("\n".join([ACTIONS_HEAD, _action("red", 5, 6), _action("red", 0, 1)]) + "\n")
    with caplog.at_level(logging.WARNING, logger="dryrun_vision"):
        f = read_actions(p)
    assert [s.t0 for s in f.segments] == [0, 5]
    assert caplog.messages == ["actions.jsonl line 3: lines are not in t0 order; they were sorted"]


def test_t1_must_be_later_than_t0_after_rounding():
    with pytest.raises(ValueError, match="later than"):
        ActionSegment(worker_id="red", t0=1.0001, t1=1.0004, kind="walk")
