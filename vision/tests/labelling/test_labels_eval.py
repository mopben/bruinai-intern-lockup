import json
from pathlib import Path

import pytest

from dryrun_vision.cli import main
from dryrun_vision.labels.errors import LabelError
from dryrun_vision.labels.evaluation.breakfast import discover_clips, read_frame_labels, split_by_person
from dryrun_vision.labels.providers import registry
from dryrun_vision.labels.vocab import bundled_vocab
from labelling.helpers import FakeProvider, by_brightness, write_video

VISION = Path(__file__).resolve().parents[2]
BREAKFAST_VOCAB = bundled_vocab("breakfast")
FPS = 5.0
FRAMES = 40  # 8 s; gray rises 5 per frame, so frames 20+ are "bright"


@pytest.fixture
def data(tmp_path: Path) -> Path:
    root = tmp_path / "breakfast"
    (root / "videos").mkdir(parents=True)
    (root / "labels_coarse").mkdir()
    for person, activity in [("P01", "milk"), ("P02", "tea"), ("P03", "milk"), ("P04", "coffee")]:
        name = f"{person}_cam01_{person}_{activity}"
        write_video(root / "videos" / f"{name}.avi", FRAMES, (32, 24), FPS)
        first = {"milk": "pour_milk", "tea": "take_cup", "coffee": "take_cup"}[activity]
        (root / "labels_coarse" / f"{name}.txt").write_text(f"1-5 SIL  \n6-20 {first}  \n21-42 SIL  \n")
    return root


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider(by_brightness, name="fake:model")
    monkeypatch.setattr(registry, "FACTORIES", {"fake": lambda _options: provider})
    return provider


def test_read_frame_labels_maps_one_based_inclusive_and_clamps(tmp_path: Path):
    p = tmp_path / "l.txt"
    p.write_text("1-1 SIL  \n2-3 take_cup  \n4-7 SIL  \n")
    assert read_frame_labels(p, 5) == ("SIL", "take_cup", "take_cup", "SIL", "SIL")


def test_read_frame_labels_errors(tmp_path: Path):
    p = tmp_path / "l.txt"
    p.write_text("1-2 SIL\n4-5 SIL\n")
    with pytest.raises(LabelError, match="frame 3"):
        read_frame_labels(p, 5)
    p.write_text("one two\n")
    with pytest.raises(LabelError, match="line 1"):
        read_frame_labels(p, 5)


def test_split_alternates_people(data: Path):
    dev, held = split_by_person(discover_clips(data))
    assert {c.person for c in dev} == {"P01", "P03"} and {c.person for c in held} == {"P02", "P04"}
    assert dev[0].activity == "milk" and dev[0].camera == "cam01"


def test_discover_needs_videos(tmp_path: Path):
    with pytest.raises(LabelError, match=r"No \.avi"):
        discover_clips(tmp_path)
    (tmp_path / "videos").mkdir()
    (tmp_path / "videos" / "odd.avi").write_bytes(b"")
    with pytest.raises(LabelError, match="does not look like"):
        discover_clips(tmp_path)


def test_eval_labels_end_to_end(data: Path, tmp_path: Path, fake: FakeProvider, capsys):
    out = tmp_path / "out"
    argv = ["eval-labels", "--data", str(data), "--vocab", str(BREAKFAST_VOCAB), "--provider", "fake",
            "--out-dir", str(out)]  # fmt: skip
    assert main(argv) == 0
    text = capsys.readouterr().out
    assert "candidates: all | crop: whole" in text and "candidates: activity | crop: centre" in text
    assert "held-out" in text and "majority (dev)" in text
    files = sorted(p.name for p in out.glob("*.json"))
    assert files == [
        "fake-activity-centre.json",
        "fake-activity-whole.json",
        "fake-all-centre.json",
        "fake-all-whole.json",
    ]
    r = json.loads((out / "fake-activity-whole.json").read_text())
    assert set(r["dev"]["clips"]) == {"P01_cam01_P01_milk", "P03_cam01_P03_milk"}
    raw = r["dev"]["raw"]
    assert raw["frames"] == 2 * FRAMES and 0 <= raw["accuracy"] <= 1
    # milk candidates: pour_milk first; dark windows (first 4 s) -> pour_milk, bright -> spoon_powder
    assert raw["recall"]["pour_milk"] == pytest.approx(1.0)
    assert r["dev"]["baselines"]["majority"] == pytest.approx(25 / 40)
    assert r["dev"]["baselines"]["chance"] == pytest.approx(1 / 4)
    assert r["windowScores"][0]["windows"][0]["probs"] is not None
    assert r["tunedOnDev"]["smoothWindows"] in (1, 3, 5)
    assert r["windowsPerSecond"] > 0


def test_eval_labels_limit_and_bad_choices(data: Path, tmp_path: Path, fake: FakeProvider, capsys):
    base = ["eval-labels", "--data", str(data), "--vocab", str(BREAKFAST_VOCAB), "--provider", "fake",
            "--out-dir", str(tmp_path / "o")]  # fmt: skip
    assert main([*base, "--limit", "1", "--crops", "whole", "--settings", "all"]) == 0
    r = json.loads((tmp_path / "o" / "fake-all-whole.json").read_text())
    assert len(r["dev"]["clips"]) == 1 and len(r["heldOut"]["clips"]) == 1
    assert main([*base, "--crops", "tracks"]) == 1
    assert "--crops" in capsys.readouterr().err
