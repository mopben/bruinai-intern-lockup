import json
from pathlib import Path

import pytest

from dryrun_vision.cli import main
from dryrun_vision.formats import (
    Detection,
    TracksHeader,
    VideoInfo,
    read_calibration,
    read_tracks,
    write_tracks,
)
from dryrun_vision.mot import GtBox, read_mot_gt
from dryrun_vision.mot.report import evaluated_frames, format_tracking_report, tracking_report
from dryrun_vision.mot.tsai import read_tsai
from test_tsai import PETS_TXT


@pytest.fixture
def tsai_file(tmp_path: Path) -> Path:
    p = tmp_path / "View_001.txt"
    p.write_text("\n".join(PETS_TXT.split()) + "\n")
    return p


def _gt_rows(cam) -> list[tuple[int, int, float, float, float, float, float, float]]:
    """Two people walking; boxes drawn through the Tsai camera (feet at the ground position)."""
    rows = []
    for f in range(20):
        for gid, (x0, y0) in ((1, (-4.0, -7.0)), (2, (-8.0, -3.0))):
            gx, gy = x0 + 0.05 * f, y0
            fu, fv = cam.world_to_pixel((gx * 1000, gy * 1000, 0.0))
            hu, hv = cam.world_to_pixel((gx * 1000, gy * 1000, 1700.0))
            h = fv - hv
            w = 0.4 * h
            rows.append((f, gid, (fu + hu) / 2 - w / 2, hv, w, h, gx, gy))
    return rows


def _files(tmp_path: Path, tsai_file: Path, switch: bool) -> tuple[Path, Path]:
    cam = read_tsai(tsai_file)
    rows = _gt_rows(cam)
    gt = tmp_path / "gt.txt"
    gt.write_text(
        "".join(f"{f + 1},{g},{x},{y},{w},{h},1,{gx},{gy},0\n" for f, g, x, y, w, h, gx, gy in rows)
    )
    dets = [
        Detection(
            frame=f,
            t=f / 7,
            track_id=g + (10 if switch and f >= 10 and g == 1 else 0),
            x=x,
            y=y,
            w=w,
            h=h,
            score=0.9,
        )
        for f, g, x, y, w, h, _, _ in rows
    ]
    tracks = tmp_path / "tracks.jsonl"
    info = VideoInfo(file="v.mp4", width=768, height=576, fps=7.0, frames=20)
    write_tracks(
        tracks, TracksHeader(video=info, detector="gt", tracker="gt", stride=1, frames_read=20), dets
    )
    return gt, tracks


def _header(frames: int, stride: int | None = None, read: int | None = None) -> TracksHeader:
    info = VideoInfo(file="v.mp4", width=768, height=576, fps=7.0, frames=frames)
    return TracksHeader(video=info, detector="d", tracker="t", stride=stride, frames_read=read)


def test_evaluated_frames_come_from_the_header():
    gt = [GtBox(15, 1, 0, 0, 1, 1, 1, (0.0, 0.0))]
    frames, note = evaluated_frames(_header(20, stride=4, read=4), gt)
    assert frames == (0, 4, 8, 12) and note is None  # gt frame 15 was never processed


def test_people_missed_at_the_end_still_count():
    # No detection after frame 4, but the tracker read 10 frames: frames 5-9 are evaluated (misses).
    frames, _ = evaluated_frames(_header(10, stride=1, read=10), [])
    assert frames == tuple(range(10))


def test_older_tracks_files_are_evaluated_on_every_frame_with_a_note():
    gt = [GtBox(15, 1, 0, 0, 1, 1, 1, (0.0, 0.0))]
    frames, note = evaluated_frames(_header(12), gt)
    assert frames == tuple(range(16)) and note is not None and "stride" in note


def test_track_records_stride_and_frames_read():
    h = _header(20, stride=2, read=10)
    assert h.to_json()["stride"] == 2 and h.to_json()["framesRead"] == 10
    assert "stride" not in _header(20).to_json()


def test_report_on_perfect_boxes_with_one_id_switch(tmp_path: Path, tsai_file: Path):
    gt, tracks = _files(tmp_path, tsai_file, switch=True)
    f = read_tracks(tracks)
    r = tracking_report(f, read_mot_gt(gt), read_tsai(tsai_file))
    assert r.metrics.precision == 1.0 and r.metrics.recall == 1.0 and r.metrics.id_switches == 1
    assert r.people == 2 and r.stitched is not None and r.stitched.id_switches == 0 and r.stitched.idf1 == 1.0
    foot = r.floor[0]
    assert foot.n == 40 and foot.worst_m < 0.1
    text = format_tracking_report(r)
    assert "IDF1" in text and "No-kitchen stitching: 2 identities" in text


def test_cli(tmp_path: Path, tsai_file: Path, capsys: pytest.CaptureFixture[str]):
    gt, tracks = _files(tmp_path, tsai_file, switch=False)
    js, cal = tmp_path / "r.json", tmp_path / "cal.json"
    argv = ["eval-tracking", str(tracks), "--gt", str(gt), "--tsai", str(tsai_file), "--json", str(js)]
    assert main([*argv, "--write-calibration", str(cal)]) == 0
    assert "MOTA 1.000" in capsys.readouterr().out
    assert json.loads(js.read_text())["metrics_derived"]["idf1"] == 1.0
    assert read_calibration(cal).image_size.width == 768
    assert main(["eval-tracking", str(tracks), "--gt", str(gt)]) == 0
    assert "stitching" not in capsys.readouterr().out
    assert main(["eval-tracking", str(tracks), "--gt", str(gt), "--write-calibration", str(cal)]) == 1
