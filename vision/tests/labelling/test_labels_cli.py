import contextlib
import json
from pathlib import Path

import pytest

from dryrun_vision.cli import main
from dryrun_vision.clock import RunClock
from dryrun_vision.commands import label_cmd
from dryrun_vision.commands.args import gemini_options
from dryrun_vision.formats import Detection, TracksHeader, VideoInfo, read_actions, write_tracks
from dryrun_vision.formats.actions import find_overlap
from dryrun_vision.labels.providers import registry
from dryrun_vision.labels.providers.call_guard import CallPolicy
from dryrun_vision.labels.providers.gemini import GeminiOptions
from labelling.helpers import FakeProvider, by_brightness, write_video
from synth import fixture_tracks

VIDEO_FPS = 2.0
VIDEO_S = 90


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider(by_brightness, name="fake-model")
    monkeypatch.setattr(registry, "FACTORIES", {"fake": lambda _options: provider})
    return provider


@pytest.fixture
def inputs(counter_a: Path, tmp_path: Path) -> dict[str, Path]:
    actions = tmp_path / "actions.jsonl"
    assert main(["actions", str(counter_a), "--out", str(actions)]) == 0
    video = write_video(tmp_path / "run.avi", int(VIDEO_S * VIDEO_FPS), (64, 48), VIDEO_FPS)
    tracks = tmp_path / "tracks.jsonl"
    header = TracksHeader(
        video=VideoInfo(file="run.avi", width=64, height=48, fps=VIDEO_FPS, frames=180),
        detector="d",
        tracker="t",
    )
    dets = [
        Detection(frame=f, t=f / VIDEO_FPS, track_id=tid, x=4 + 18 * (tid - 1), y=8, w=14, h=30, score=0.9)
        for f in range(int(VIDEO_S * VIDEO_FPS))
        for tid in (1, 2, 3)
    ]
    write_tracks(tracks, header, dets)
    return {
        "run": counter_a,
        "actions": actions,
        "video": video,
        "tracks": tracks,
        "out": tmp_path / "out.jsonl",
    }


def args(i: dict[str, Path], *extra: str, provider: str = "fake") -> list[str]:
    return [
        "label", str(i["video"]), "--actions", str(i["actions"]), "--run", str(i["run"]),
        "--provider", provider, "--out", str(i["out"]), *extra,
    ]  # fmt: skip


MAP = ("--track-worker", "1=red", "--track-worker", "2=blue", "--track-worker", "3=yellow")


def test_label_with_tracks_writes_a_valid_labelled_file(inputs, fake, capsys):
    assert main(args(inputs, "--tracks", str(inputs["tracks"]), *MAP)) == 0
    out = read_actions(inputs["out"])
    original = read_actions(inputs["actions"])
    assert out.header.source == "zones+model" and out.header.model == "fake-model"
    assert out.header.started_at == original.header.started_at
    assert find_overlap(out.segments) is None
    assert any(s.label for s in out.segments)
    assert {s.kind for s in out.segments if s.label} <= {"work", "idle"}
    assert sum(s.duration for s in out.segments) == pytest.approx(
        sum(s.duration for s in original.segments), abs=0.05
    )
    assert "labelled" in capsys.readouterr().out
    crop_widths = {f.shape[1] for clip, _ in fake.calls for f in clip.frames}
    assert crop_widths <= {21, 22}  # 14 px box + 2 x 25 %, whole pixels


def test_label_whole_frame_without_tracks(inputs, fake):
    assert main(args(inputs)) == 0
    assert {f.shape for clip, _ in fake.calls for f in clip.frames} == {(48, 64, 3)}


def test_label_explicit_track_map(inputs, fake, capsys):
    assert main(args(inputs, "--tracks", str(inputs["tracks"]), "--track-worker", "1=red")) == 0
    assert 'worker "blue" has no boxes' in capsys.readouterr().err


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        (["--crop", "tracks"], "needs --tracks"),
        (["--min-confidence", "2"], "from 0 to 1"),
        (["--tracks", "TRACKS", "--track-worker", "red"], "must look like"),
        (["--tracks", "TRACKS"], "Give --calibration"),
        (["--track-worker", "1=red"], "need --tracks"),
        (["--calibration", "TRACKS"], "need --tracks"),
        (["--video-start", "3"], "unrecognized arguments"),
    ],
)
def test_label_bad_options_are_plain_errors(inputs, fake, capsys, extra, message):
    argv = args(inputs, *(str(inputs["tracks"]) if e == "TRACKS" else e for e in extra))
    with contextlib.suppress(SystemExit):  # argparse refuses unknown flags itself
        assert main(argv) == 1
    assert message in capsys.readouterr().err


def test_label_unknown_provider(inputs, fake, capsys):
    assert main(args(inputs, provider="nope")) == 1
    assert "no provider called" in capsys.readouterr().err


def test_label_missing_gemini_key(inputs, monkeypatch, capsys):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert main(args(inputs, provider="gemini")) == 1
    err = capsys.readouterr().err
    assert "GEMINI_API_KEY" in err and "Traceback" not in err


def test_label_keeps_labels_and_confidence_together_in_the_file(inputs, fake):
    main(args(inputs))
    lines = [json.loads(x) for x in inputs["out"].read_text().splitlines()[1:]]
    assert all(("label" in x) == ("confidence" in x) for x in lines)


def test_label_start_offset_is_the_shared_clock(inputs, fake, monkeypatch):
    seen: list[RunClock] = []
    real = label_cmd.label_segments

    def spy(*a, **kw):
        seen.append(kw["settings"].frames.clock)
        return real(*a, **kw)

    monkeypatch.setattr(label_cmd, "label_segments", spy)
    assert main(args(inputs, "--start-offset", "2.5")) == 0
    assert seen == [RunClock(start_offset_s=2.5)]


@pytest.fixture
def identified(counter_a: Path, tmp_path: Path) -> dict[str, Path]:
    """Synthetic counter-a tracks (customers, an id change) with their calibration and a 1 fps video."""
    s = fixture_tracks("counter-a")
    tracks, cal = tmp_path / "tracks.jsonl", tmp_path / "cal.json"
    write_tracks(tracks, s.header, s.detections)
    cal.write_text(json.dumps(s.calibration.to_json()))
    actions = tmp_path / "actions.jsonl"
    assert main(["actions", str(counter_a), "--out", str(actions)]) == 0
    video = write_video(tmp_path / "run.avi", 90, (s.header.video.width, s.header.video.height), 1.0)
    return {"run": counter_a, "actions": actions, "video": video, "tracks": tracks, "cal": cal,
            "out": tmp_path / "out.jsonl"}  # fmt: skip


def test_label_finds_the_workers_with_the_identity_stage(identified, fake, capsys):
    argv = args(identified, "--tracks", str(identified["tracks"]), "--calibration", str(identified["cal"]))
    assert main(argv) == 0
    assert "has no boxes" not in capsys.readouterr().err
    out = read_actions(identified["out"])
    labelled = {s.worker_id for s in out.segments if s.label}
    assert labelled == {"red", "blue", "yellow"}
    assert any(s.worker_id == "blue" and s.t0 > 42 and s.label for s in out.segments)  # after the id change
    whole = (252, 448, 3)  # the whole 1280x720 frame, shrunk
    assert all(f.shape != whole and f.shape[0] > f.shape[1] for clip, _ in fake.calls for f in clip.frames)


def test_label_calibration_must_fit_the_video(identified, fake, capsys):
    data = json.loads(identified["cal"].read_text())
    identified["cal"].write_text(json.dumps({**data, "imageSize": {"width": 640, "height": 480}}))
    argv = args(identified, "--tracks", str(identified["tracks"]), "--calibration", str(identified["cal"]))
    assert main(argv) == 1
    assert "Calibrate on this video" in capsys.readouterr().err


def test_label_passes_the_gemini_options(inputs, monkeypatch, capsys):
    seen: list[GeminiOptions] = []
    provider = FakeProvider(by_brightness, name="fake-model")

    def factory(options: GeminiOptions) -> FakeProvider:
        seen.append(options)
        return provider

    monkeypatch.setattr(registry, "FACTORIES", {"fake": factory})
    argv = args(inputs, "--gemini-model", "gemini-x", "--gemini-max-calls", "12")
    assert main(argv) == 0
    assert seen[0].model == "gemini-x" and seen[0].policy.max_calls == 12


def test_eval_labels_takes_the_gemini_options():
    from dryrun_vision.cli import build_parser  # noqa: PLC0415

    ns = build_parser().parse_args(["eval-labels", "--gemini-model", "m", "--gemini-max-calls", "5"])
    assert gemini_options(ns) == GeminiOptions(model="m", policy=CallPolicy(max_calls=5))


@pytest.mark.parametrize("window", ["0", "-1"])
def test_label_window_must_be_positive(inputs, fake, capsys, window):
    with pytest.raises(SystemExit):
        main(args(inputs, "--window", window))
    assert "must be more than 0" in capsys.readouterr().err


def test_the_default_vocabularies_ship_inside_the_package():
    from dryrun_vision.commands import eval_labels_cmd  # noqa: PLC0415

    pkg = Path(label_cmd.__file__).resolve().parents[1]
    for vocab in (label_cmd.DEFAULT_VOCAB, eval_labels_cmd.DEFAULT_VOCAB):
        assert vocab.is_file() and pkg in vocab.resolve().parents
