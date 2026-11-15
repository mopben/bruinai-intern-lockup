"""The ML subcommands end to end, with a fake detector and tracker (no model, no network)."""

import json
from pathlib import Path

import pytest

from conftest import FIXTURES_DIR
from dryrun_vision.cli import main
from dryrun_vision.commands import track_cmd
from dryrun_vision.formats import read_actions, read_positions, read_tracks, write_tracks
from synth import fixture_tracks

pytest.importorskip("cv2")

from dryrun_vision.labels.providers import registry
from fakes import EnumeratingTracker, LevelDetector
from labelling.helpers import FakeProvider, by_brightness
from labelling.helpers import write_video as write_label_video
from videos import write_video

COUNTER_A = FIXTURES_DIR / "counter-a"


@pytest.fixture
def fake_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(track_cmd, "build_detector", lambda _args: LevelDetector())
    monkeypatch.setattr(track_cmd, "build_tracker", lambda _fps: EnumeratingTracker())


@pytest.fixture
def synthetic(tmp_path: Path) -> tuple[Path, Path]:
    s = fixture_tracks("counter-a")
    tracks = tmp_path / "tracks.jsonl"
    write_tracks(tracks, s.header, s.detections)
    cal = tmp_path / "cal.json"
    cal.write_text(json.dumps(s.calibration.to_json()))
    return tracks, cal


def test_track_writes_tracks(fake_models: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    video = write_video(tmp_path / "v.mp4", frames=10, fps=5.0)
    out = tmp_path / "tracks.jsonl"
    assert main(["track", str(video), "--out", str(out), "--stride", "2"]) == 0
    f = read_tracks(out)
    assert sorted({d.frame for d in f.detections}) == [0, 2, 4, 6, 8]
    captured = capsys.readouterr()
    assert "Wrote 10 boxes in 2 tracks" in captured.out
    assert "frame 5/5" in captured.err


def test_track_unreadable_video(fake_models: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    bad = tmp_path / "bad.mp4"
    bad.write_text("not a video")
    assert main(["track", str(bad), "--out", str(tmp_path / "t.jsonl")]) == 1
    err = capsys.readouterr().err
    assert "could not be opened as a video" in err and "Traceback" not in err


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--stride", "0"], "must be 1 or more"),
        (["--max-seconds", "-2"], "must be more than 0"),
        (["--out", "/no/such/folder/t.jsonl"], "does not exist"),
        (["--min-score", "1.5"], "from 0 to 1"),
    ],
)
def test_track_argument_checks(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], argv: list[str], message: str
):
    base = ["track", str(tmp_path / "v.mp4"), "--out", str(tmp_path / "t.jsonl")]
    with pytest.raises(SystemExit):
        main([*base, *argv])
    assert message in capsys.readouterr().err


def test_positions_command(synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    tracks, cal = synthetic
    out = tmp_path / "positions.jsonl"
    argv = ["positions", str(tracks), "--calibration", str(cal), "--run", str(COUNTER_A), "--out", str(out)]
    assert main(argv) == 0
    f = read_positions(out)
    assert f.header.hz == 10 and f.header.started_at == "2026-11-12T15:10:05.000Z"
    assert {s.worker_id for s in f.samples} == {"red", "blue", "yellow"}
    text = capsys.readouterr().out
    assert "for 3 workers" in text and "never inside the working area" in text


def test_positions_start_offset_and_foot(synthetic: tuple[Path, Path], tmp_path: Path):
    tracks, cal = synthetic
    out = tmp_path / "positions.jsonl"
    argv = ["positions", str(tracks), "--calibration", str(cal), "--run", str(COUNTER_A), "--out", str(out)]
    assert main([*argv, "--start-offset", "10", "--anchor", "foot"]) == 0
    f = read_positions(out)
    assert f.samples[0].t == 0.0 and f.samples[-1].t < 80


def test_positions_wrong_picture_size(
    synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    tracks, cal = synthetic
    data = json.loads(cal.read_text())
    data["imageSize"] = {"width": 640, "height": 480}
    cal.write_text(json.dumps(data))
    argv = [
        "positions",
        str(tracks),
        "--calibration",
        str(cal),
        "--run",
        str(COUNTER_A),
        "--out",
        str(tmp_path / "p.jsonl"),
    ]
    assert main(argv) == 1
    assert "Calibrate on this video" in capsys.readouterr().err


def test_run_reusing_tracks(synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    tracks, cal = synthetic
    out = tmp_path / "out"
    argv = [
        "run",
        "video.mp4",
        "--tracks",
        str(tracks),
        "--calibration",
        str(cal),
        "--run",
        str(COUNTER_A),
        "--out",
        str(out),
    ]
    assert main(argv) == 0
    actions = read_actions(out / "actions.jsonl")
    assert {s.worker_id for s in actions.segments} == {"red", "blue", "yellow"}
    assert (out / "positions.jsonl").is_file()
    text = capsys.readouterr().out
    assert "Found 3 workers" in text and "trips" in text


def test_run_with_the_detector(
    fake_models: None, tmp_path: Path, synthetic: tuple[Path, Path], capsys: pytest.CaptureFixture[str]
):
    _, cal = synthetic
    data = json.loads(cal.read_text())
    data["imageSize"] = {"width": 64, "height": 48}
    cal.write_text(json.dumps(data))
    video = write_video(tmp_path / "v.mp4", frames=10, fps=5.0)
    out = tmp_path / "out"
    assert (
        main(["run", str(video), "--calibration", str(cal), "--run", str(COUNTER_A), "--out", str(out)]) == 0
    )
    assert (out / "tracks.jsonl").is_file() and (out / "actions.jsonl").is_file()
    assert "Worker" in capsys.readouterr().err  # the fake people are nobody: workers not found


def test_run_out_is_a_file(synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    tracks, cal = synthetic
    argv = [
        "run",
        "v.mp4",
        "--tracks",
        str(tracks),
        "--calibration",
        str(cal),
        "--run",
        str(COUNTER_A),
        "--out",
        str(tracks),
    ]
    assert main(argv) == 1
    assert "is a file" in capsys.readouterr().err


def test_render_with_track_ids(fake_models: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    import cv2  # noqa: PLC0415 - only after the importorskip above

    video = write_video(tmp_path / "v.mp4", frames=6, fps=5.0)
    tracks = tmp_path / "t.jsonl"
    main(["track", str(video), "--out", str(tracks)])
    out = tmp_path / "check.mp4"
    assert main(["render", str(video), "--tracks", str(tracks), "--out", str(out)]) == 0
    cap = cv2.VideoCapture(str(out))
    assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == 6
    cap.release()
    assert "Wrote 6 frames" in capsys.readouterr().out


def test_render_argument_rules(
    synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    tracks, cal = synthetic
    base = ["render", "v.mp4", "--tracks", str(tracks), "--out", str(tmp_path / "o.mp4")]
    assert main([*base, "--calibration", str(cal)]) == 1
    assert "together" in capsys.readouterr().err
    assert main([*base, "--actions", str(tmp_path / "a.jsonl")]) == 1
    assert "needs --calibration" in capsys.readouterr().err


@pytest.fixture
def fake_labels(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider(by_brightness, name="fake-model")
    monkeypatch.setattr(registry, "FACTORIES", {"fake": lambda _options: provider})
    return provider


def _run_argv(tracks: Path, cal: Path, video: Path, out: Path, *extra: str) -> list[str]:
    return [
        "run", str(video), "--tracks", str(tracks), "--calibration", str(cal), "--run", str(COUNTER_A),
        "--out", str(out), *extra,
    ]  # fmt: skip


def test_run_without_label_writes_zone_actions(synthetic: tuple[Path, Path], tmp_path: Path):
    tracks, cal = synthetic
    assert main(_run_argv(tracks, cal, tmp_path / "v.avi", tmp_path / "out")) == 0
    actions = read_actions(tmp_path / "out" / "actions.jsonl")
    assert actions.header.source == "zones" and actions.header.model is None
    assert not any(s.label for s in actions.segments)


def test_run_with_label(
    synthetic: tuple[Path, Path],
    tmp_path: Path,
    fake_labels: FakeProvider,
    capsys: pytest.CaptureFixture[str],
):
    tracks, cal = synthetic
    video = write_label_video(tmp_path / "v.avi", 90, (1280, 720), 1.0)
    out = tmp_path / "out"
    argv = _run_argv(tracks, cal, video, out, "--label", "--provider", "fake", "--start-offset", "1.5")
    assert main(argv) == 0
    actions = read_actions(out / "actions.jsonl")
    positions = read_positions(out / "positions.jsonl")
    assert actions.header.source == "zones+model" and actions.header.model == "fake-model"
    assert {s.worker_id for s in actions.segments if s.label} == {"red", "blue", "yellow"}
    assert max(s.t1 for s in actions.segments) <= max(s.t for s in positions.samples) + 1e-9
    text = capsys.readouterr()
    assert "labelled" in text.out and "has no boxes" not in text.err


@pytest.mark.parametrize("extra", [["--provider", "fake"], ["--vocab", "x.json"]])
def test_run_model_options_need_label(
    synthetic: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str], extra: list[str]
):
    tracks, cal = synthetic
    assert main(_run_argv(tracks, cal, tmp_path / "v.avi", tmp_path / "out", *extra)) == 1
    assert "only with --label" in capsys.readouterr().err


def test_run_label_needs_the_video(
    synthetic: tuple[Path, Path],
    tmp_path: Path,
    fake_labels: FakeProvider,
    capsys: pytest.CaptureFixture[str],
):
    tracks, cal = synthetic
    argv = _run_argv(tracks, cal, tmp_path / "missing.avi", tmp_path / "out", "--label", "--provider", "fake")
    assert main(argv) == 1
    err = capsys.readouterr().err
    assert "does not exist" in err and "Traceback" not in err
