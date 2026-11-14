"""The most complete end-to-end check we can run without a filmed café.

Real code, stand-in inputs:
- tracks: synthetic person boxes drawn from the fixture's own positions (tests/synth.py: jitter,
  lost boxes, occlusions, an id change, two customers), not a detector on a video;
- video: a tiny generated clip at the calibration's picture size (grey frames, 1 fps), so the
  labeller really decodes, crops and scores frames, but there is nothing in them to see;
- label provider: a fake that scores by brightness (no model);
- calibration: the fixture's exact golden calibration.
Everything between is the shipped pipeline through the `run` command: identity -> positions ->
zone actions -> labels, with --start-offset. The output folder is then checked by the product's
own TypeScript validator (tools/world/validate.ts), exactly as a filmed run would be.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import FIXTURES_DIR, REPO_ROOT
from dryrun_vision.cli import main
from dryrun_vision.formats import read_actions, read_positions, write_tracks
from dryrun_vision.labels.providers import registry
from synth import fixture_tracks

pytest.importorskip("cv2")

from labelling.helpers import FakeProvider, by_brightness, write_video

FIXTURE = "counter-a"
RUN_FILES = ("run.json", "scan.json", "setup.json", "layout.json", "taps.jsonl")
VIDEO_FPS = 1.0
VALIDATOR_TIMEOUT_S = 120


@pytest.fixture
def fake_labels(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider(by_brightness, name="fake-model")
    monkeypatch.setattr(registry, "FACTORIES", {"fake": lambda _options: provider})
    return provider


def _inputs(tmp_path: Path) -> tuple[Path, Path, Path]:
    s = fixture_tracks(FIXTURE)
    tracks, cal = tmp_path / "tracks.jsonl", tmp_path / "calibration.json"
    write_tracks(tracks, s.header, s.detections)
    cal.write_text(json.dumps(s.calibration.to_json()))
    frames = int(s.header.video.frames / s.header.video.fps * VIDEO_FPS) + 1
    size = (s.header.video.width, s.header.video.height)
    video = write_video(tmp_path / "run.avi", frames, size, VIDEO_FPS)
    return tracks, cal, video


def _stage_folder(out: Path, dest: Path) -> Path:
    """The fixture's own scan/setup/layout/taps plus our positions.jsonl and actions.jsonl."""
    dest.mkdir()
    for name in RUN_FILES:
        shutil.copy(FIXTURES_DIR / FIXTURE / name, dest / name)
    for name in ("positions.jsonl", "actions.jsonl"):
        shutil.copy(out / name, dest / name)
    return dest


def test_run_with_labels_gives_a_folder_the_stage_accepts(tmp_path: Path, fake_labels: FakeProvider, capsys):
    tracks, cal, video = _inputs(tmp_path)
    out = tmp_path / "out"
    argv = ["run", str(video), "--tracks", str(tracks), "--calibration", str(cal),
            "--run", str(FIXTURES_DIR / FIXTURE), "--out", str(out),
            "--label", "--provider", "fake"]  # fmt: skip
    assert main(argv) == 0
    printed = capsys.readouterr()
    assert "Found 3 workers" in printed.out and "has no boxes" not in printed.err

    positions, actions = read_positions(out / "positions.jsonl"), read_actions(out / "actions.jsonl")
    assert {s.worker_id for s in positions.samples} == {"red", "blue", "yellow"}
    assert actions.header.source == "zones+model" and actions.header.model == "fake-model"
    assert {s.worker_id for s in actions.segments if s.label} == {"red", "blue", "yellow"}
    assert {s.kind for s in actions.segments if s.label} <= {"work", "idle"}
    assert fake_labels.calls, "the labeller never reached the provider"

    if shutil.which("npx") is None:
        pytest.skip("node is not installed: the TypeScript validator cannot run")
    folder = _stage_folder(out, tmp_path / FIXTURE)
    res = subprocess.run(
        ["npx", "tsx", "tools/world/validate.ts", str(folder)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=VALIDATOR_TIMEOUT_S, check=False,
    )  # fmt: skip
    assert res.returncode == 0, res.stdout + res.stderr
    assert "OK" in res.stdout, res.stdout
