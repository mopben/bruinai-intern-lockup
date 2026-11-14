import json
import shutil
from pathlib import Path

import pytest

from dryrun_vision.cli import main
from dryrun_vision.formats import read_actions


def test_actions_writes_a_valid_file(counter_a: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    out = tmp_path / "actions.jsonl"
    assert main(["actions", str(counter_a), "--out", str(out)]) == 0
    f = read_actions(out)
    assert f.header.source == "zones"
    assert f.header.started_at == "2026-11-12T15:10:05.000Z"
    assert len(f.segments) > 10
    assert "segments" in capsys.readouterr().out


def test_actions_to_stdout(counter_a: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["actions", str(counter_a)]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[0])["format"] == "dryrun.actions"


def test_eval_actions_prints_and_writes_json(
    counter_a: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    actions = tmp_path / "actions.jsonl"
    main(["actions", str(counter_a), "--out", str(actions)])
    js = tmp_path / "eval.json"
    assert main(["eval-actions", str(counter_a), "--actions", str(actions), "--json", str(js)]) == 0
    text = capsys.readouterr().out
    assert "done taps" in text
    assert json.loads(js.read_text())["taps"]["taps"] == 30


def test_eval_actions_without_actions_file(counter_a: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["eval-actions", str(counter_a)]) == 0
    assert "zones (computed now)" in capsys.readouterr().out


def test_bad_folder_is_a_plain_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["eval-actions", str(tmp_path / "nope")]) == 1
    err = capsys.readouterr().err
    assert "is not a folder" in err and "Traceback" not in err


def test_broken_kitchen_is_a_plain_error(counter_a: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    run = tmp_path / "run"
    shutil.copytree(counter_a, run)
    layout = json.loads((run / "layout.json").read_text())
    layout["workers"][0]["stationId"] = "nope"
    (run / "layout.json").write_text(json.dumps(layout))
    assert main(["actions", str(run)]) == 1
    assert "not a station" in capsys.readouterr().err


def test_warnings_go_to_stderr(counter_a: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    run = tmp_path / "run"
    shutil.copytree(counter_a, run)
    lines = (run / "positions.jsonl").read_text().splitlines()
    kept = [lines[0]] + [ln for ln in lines[1:] if not 10 <= json.loads(ln)["t"] < 12.5]  # a 2.5 s gap
    (run / "positions.jsonl").write_text("\n".join(kept) + "\n")
    assert main(["actions", str(run), "--out", str(tmp_path / "a.jsonl")]) == 0
    assert "gap" in capsys.readouterr().err


def test_no_command_shows_help(capsys: pytest.CaptureFixture[str]):
    with pytest.raises(SystemExit):
        main([])


def test_file_warnings_are_printed_on_stderr(counter_a, tmp_path, capsys):
    for f in counter_a.iterdir():
        (tmp_path / f.name).write_text(f.read_text())
    data = json.loads((counter_a / "layout.json").read_text())
    data["workers"][0]["hatSize"] = "L"
    (tmp_path / "layout.json").write_text(json.dumps(data))
    assert main(["actions", str(tmp_path), "--out", str(tmp_path / "a.jsonl")]) == 0
    err = capsys.readouterr().err
    assert 'warning: layout.json: has unknown field "workers[0].hatSize"' in err
