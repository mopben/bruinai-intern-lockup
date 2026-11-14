import json
import logging
from pathlib import Path

import pytest

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import (
    read_layout,
    read_positions,
    read_run_folder,
    read_run_meta,
    read_scan,
    read_setup,
    read_taps,
    read_tracks,
)


def test_reads_every_fixture_folder(fixture_dir: Path):
    run = read_run_folder(fixture_dir)
    assert run.meta.id == fixture_dir.name
    assert len(run.scan.boxes) > 0
    assert len(run.layout.workers) >= 3
    assert run.positions.header.hz == 10
    assert len(run.positions.samples) > 1000
    assert run.taps.events[-1].type == "end"


def test_scan_fields_are_snake_case_and_frozen(counter_a: Path):
    scan = read_scan(counter_a / "scan.json")
    box = scan.boxes[0]
    assert box.size.w > 0
    with pytest.raises(Exception, match="frozen"):
        box.yaw = 1.0  # type: ignore[misc]


def test_setup_and_layout(counter_a: Path):
    setup = read_setup(counter_a / "setup.json")
    layout = read_layout(counter_a / "layout.json")
    assert setup.menu[0].steps[1].fetch_from
    assert setup.items[0].stand_side == "front"
    assert layout.workers[0].station_id == setup.menu[0].steps[0].station_id
    assert read_run_meta(counter_a / "run.json").source == "synthetic"


def test_taps_kinds(counter_a: Path):
    taps = read_taps(counter_a / "taps.jsonl")
    kinds = {e.type for e in taps.events}
    assert kinds == {"order", "done", "end"}
    done = [e for e in taps.events if e.type == "done"]
    assert done[0].worker_id == "red"
    assert taps.header.started_at == "2026-11-12T15:10:05.000Z"


def test_json_error_names_file(tmp_path: Path):
    p = tmp_path / "scan.json"
    p.write_text("{ not json")
    with pytest.raises(FormatError, match=r"scan\.json"):
        read_scan(p)


def test_missing_file_is_a_plain_message(tmp_path: Path):
    with pytest.raises(FormatError, match="does not exist"):
        read_scan(tmp_path / "scan.json")


def test_negative_size_is_rejected(counter_a: Path, tmp_path: Path):
    text = (counter_a / "scan.json").read_text().replace('"w": 0.7135', '"w": -0.7135', 1)
    p = tmp_path / "scan.json"
    p.write_text(text)
    with pytest.raises(FormatError, match=r"boxes\[\d+\]\.size\.w"):
        read_scan(p)


def test_jsonl_error_names_line_and_field(counter_a: Path, tmp_path: Path):
    lines = (counter_a / "positions.jsonl").read_text().splitlines()
    lines[3] = lines[3].replace('"x":', '"x":"oops","y":')
    p = tmp_path / "positions.jsonl"
    p.write_text("\n".join(lines) + "\n")
    with pytest.raises(FormatError, match=r"positions\.jsonl line 4: field \"x\""):
        read_positions(p)


def test_unknown_field_in_a_product_file_is_a_warning(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    p = tmp_path / "positions.jsonl"
    p.write_text(
        '{"type":"header","format":"dryrun.positions","version":1,"startedAt":"2026-11-12T15:10:05.000Z","hz":10}\n'
        '{"type":"pos","t":0,"workerId":"red","x":1,"z":1,"workerid":"r"}\n'
        '{"type":"pos","t":0.1,"workerId":"red","x":1,"z":1,"workerid":"r"}\n'
    )
    with caplog.at_level(logging.WARNING, logger="dryrun_vision"):
        f = read_positions(p)
    assert len(f.samples) == 2
    assert caplog.messages == [
        'positions.jsonl line 2: has unknown field "workerid"; it is ignored (check the spelling) (2 lines)'
    ]
    assert "workerid" not in f.samples[0].to_json()


def test_unknown_nested_fields_in_json_files_are_warnings(counter_a: Path, tmp_path: Path, caplog):
    data = json.loads((counter_a / "layout.json").read_text())
    data["workers"][0]["hatSize"] = "L"
    data["futureThing"] = 1
    p = tmp_path / "layout.json"
    p.write_text(json.dumps(data))
    with caplog.at_level(logging.WARNING, logger="dryrun_vision"):
        read_layout(p)
    assert sorted(caplog.messages) == [
        'layout.json: has unknown field "futureThing"; it is ignored (check the spelling)',
        'layout.json: has unknown field "workers[0].hatSize"; it is ignored (check the spelling)',
    ]


def test_our_own_tracks_file_stays_strict(tmp_path: Path):
    p = tmp_path / "tracks.jsonl"
    p.write_text(
        '{"type":"header","format":"dryrun.tracks","version":1,"video":{"file":"v.mp4","width":4,'
        '"height":4,"fps":10,"frames":1},"detector":"d","tracker":"t","oops":1}\n'
    )
    with pytest.raises(FormatError, match="oops"):
        read_tracks(p)


def test_new_contract_fields_are_read(counter_a: Path, tmp_path: Path):
    setup = json.loads((counter_a / "setup.json").read_text())
    setup["items"][0]["capacity"] = 1
    layout = json.loads((counter_a / "layout.json").read_text())
    station = setup["menu"][0]["steps"][1]["stationId"]
    layout["workers"][0]["covers"] = [station]
    (tmp_path / "setup.json").write_text(json.dumps(setup))
    (tmp_path / "layout.json").write_text(json.dumps(layout))
    assert read_setup(tmp_path / "setup.json").items[0].capacity == 1
    assert read_layout(tmp_path / "layout.json").workers[0].covers == (station,)


def test_header_must_come_first(tmp_path: Path):
    p = tmp_path / "positions.jsonl"
    p.write_text('{"type":"pos","t":0,"workerId":"red","x":1,"z":1}\n')
    with pytest.raises(FormatError, match="line 1"):
        read_positions(p)


def test_empty_jsonl(tmp_path: Path):
    p = tmp_path / "taps.jsonl"
    p.write_text("\n\n")
    with pytest.raises(FormatError, match="empty"):
        read_taps(p)


def test_blank_lines_are_ignored_and_bad_date_rejected(tmp_path: Path):
    p = tmp_path / "taps.jsonl"
    p.write_text('{"type":"header","format":"dryrun.taps","version":1,"startedAt":"yesterday"}\n\n')
    with pytest.raises(FormatError, match="date and time"):
        read_taps(p)


def test_negative_time_rejected(tmp_path: Path):
    p = tmp_path / "taps.jsonl"
    p.write_text(
        '{"type":"header","format":"dryrun.taps","version":1,"startedAt":"2026-11-12T15:10:05.000Z"}\n'
        '{"type":"end","t":-1}\n'
    )
    with pytest.raises(FormatError, match="line 2"):
        read_taps(p)


def test_missing_folder_file(tmp_path: Path):
    with pytest.raises(FormatError, match=r"run\.json"):
        read_run_folder(tmp_path)
