"""Hand review of actions.jsonl: the review table, applying corrections, and the provenance sidecar."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from dryrun_vision.cli import main
from dryrun_vision.errors import DryRunError
from dryrun_vision.formats import ActionSegment, ActionsHeader, read_actions, write_actions
from dryrun_vision.review import (
    REVIEW_COLUMNS,
    apply_review,
    provenance_path,
    read_provenance,
    read_review,
    write_review,
)

HEADER = ActionsHeader(started_at="2026-11-14T22:44:31.000Z", source="zones+model", model="gemini:test")
SEGMENTS = (
    ActionSegment(
        worker_id="drink",
        t0=0.1,
        t1=2.9,
        kind="work",
        box_id="st-drink",
        label="pouring a drink",
        confidence=0.9,
    ),
    ActionSegment(
        worker_id="chips", t0=0.1, t1=3.5, kind="work", box_id="st-chips", label="waiting", confidence=0.8
    ),
    ActionSegment(worker_id="drink", t0=2.9, t1=8.1, kind="walk"),
    ActionSegment(worker_id="chips", t0=3.5, t1=6.9, kind="walk"),
    ActionSegment(
        worker_id="drink",
        t0=8.1,
        t1=12.3,
        kind="work",
        box_id="st-drink",
        label="handling a cup",
        confidence=0.7,
    ),
)
NAMES = {"st-drink": "Drink station", "st-chips": "Chips station"}


@pytest.fixture
def actions(tmp_path: Path) -> Path:
    path = tmp_path / "actions.jsonl"
    write_actions(path, HEADER, SEGMENTS)
    return path


def _table(tmp_path: Path, actions: Path, edits: dict[int, dict[str, str]]) -> Path:
    path = tmp_path / "review.csv"
    write_review(path, read_actions(actions), NAMES)
    rows = list(csv.DictReader(path.open()))
    for r in rows:
        r.update(edits.get(int(r["row"]), {}))
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return path


def test_review_table_lists_segments_by_worker_then_time(tmp_path: Path, actions: Path):
    path = tmp_path / "review.csv"
    write_review(path, read_actions(actions), NAMES)
    rows = list(csv.DictReader(path.open()))
    assert list(rows[0]) == list(REVIEW_COLUMNS)
    assert [(r["worker"], r["t0"]) for r in rows] == [
        ("chips", "0.1"), ("chips", "3.5"), ("drink", "0.1"), ("drink", "2.9"), ("drink", "8.1")
    ]  # fmt: skip
    first = rows[0]
    assert first["row"] == "1" and first["station"] == "Chips station" and first["model_label"] == "waiting"
    assert first["model_confidence"] == "0.8"
    assert all(r["correct_kind"] == r["correct_label"] == r["note"] == "" for r in rows)


def test_untouched_review_changes_nothing(tmp_path: Path, actions: Path):
    review = _table(tmp_path, actions, {})
    out = tmp_path / "out.jsonl"
    result = apply_review(actions, review, out)
    assert out.read_bytes() == actions.read_bytes()
    c = result.provenance.counts
    assert (c.model_labels, c.model_labels_kept, c.model_labels_changed, c.labels_added_by_hand) == (
        3,
        3,
        0,
        0,
    )


def test_corrections_are_applied_and_untouched_lines_stay_byte_identical(tmp_path: Path, actions: Path):
    edits = {
        1: {"correct_label": "putting chips on a plate"},  # chips 0.1-3.5: label changed
        2: {
            "correct_kind": "work",
            "correct_box": "st-chips",
            "correct_label": "taking a drink",
        },  # walk -> work
        5: {"correct_label": "-"},  # drink 8.1-12.3: model label removed
    }
    out = tmp_path / "out.jsonl"
    result = apply_review(actions, _table(tmp_path, actions, edits), out)
    segs = {(s.worker_id, s.t0): s for s in read_actions(out).segments}
    assert segs[("chips", 0.1)].label == "putting chips on a plate"
    assert segs[("chips", 3.5)].kind == "work" and segs[("chips", 3.5)].box_id == "st-chips"
    assert segs[("drink", 8.1)].label is None and segs[("drink", 8.1)].confidence is None
    before = actions.read_text().splitlines()
    after = out.read_text().splitlines()
    untouched = [ln for ln in before if '"drink"' in ln and ('"t0":0.1' in ln or '"t0":2.9' in ln)]
    assert len(untouched) == 2
    assert all(ln in after for ln in untouched)  # untouched rows are byte-identical
    c = result.provenance.counts
    assert (c.model_labels, c.model_labels_kept, c.model_labels_changed, c.model_labels_removed) == (
        3,
        1,
        1,
        1,
    )
    assert (c.labels_added_by_hand, c.kinds_changed) == (1, 1)
    by = {(p.worker_id, p.t0): p for p in result.provenance.segments}
    assert by[("chips", 0.1)].label == "human" and by[("chips", 0.1)].kind == "zones"
    assert by[("chips", 3.5)].kind == "human" and by[("drink", 0.1)].label == "model"
    assert by[("drink", 2.9)].label == "none"


def test_times_can_be_moved_and_segments_deleted(tmp_path: Path, actions: Path):
    edits = {3: {"correct_t1": "8.1", "note": "still pouring"}, 4: {"correct_kind": "delete"}}
    out = tmp_path / "out.jsonl"
    result = apply_review(actions, _table(tmp_path, actions, edits), out)
    drink = [s for s in read_actions(out).segments if s.worker_id == "drink"]
    assert [(s.t0, s.t1, s.kind) for s in drink] == [(0.1, 8.1, "work"), (8.1, 12.3, "work")]
    assert result.provenance.counts.segments_deleted == 1
    assert result.provenance.counts.times_changed == 1


@pytest.mark.parametrize(
    ("edits", "words"),
    [
        ({3: {"correct_t1": "9.0"}}, "row 3"),  # overlaps the walk that follows
        ({4: {"correct_kind": "jogging"}}, 'row 4: "jogging" is not a kind'),
        ({4: {"correct_kind": "carry"}}, "row 4: a carry needs a box"),
        ({1: {"correct_t0": "abc"}}, "row 1: correct_t0"),
        ({1: {"correct_t1": "0.05"}}, "row 1"),
    ],
)
def test_corrections_that_break_the_contract_are_refused(
    tmp_path: Path, actions: Path, edits: dict, words: str
):
    out = tmp_path / "out.jsonl"
    with pytest.raises(DryRunError, match=words):
        apply_review(actions, _table(tmp_path, actions, edits), out)
    assert not out.exists()


def test_a_row_for_another_actions_file_is_refused(tmp_path: Path, actions: Path):
    review = _table(tmp_path, actions, {})
    text = review.read_text().replace(",2.9,8.1,", ",2.9,8.2,")
    review.write_text(text)
    with pytest.raises(DryRunError, match=r"row 4: no drink segment from 2\.9 to 8\.2"):
        apply_review(actions, review, tmp_path / "out.jsonl")


def test_review_file_with_missing_columns_is_refused(tmp_path: Path, actions: Path):
    bad = tmp_path / "review.csv"
    bad.write_text("row,worker\n1,drink\n")
    with pytest.raises(DryRunError, match="columns"):
        read_review(bad)


def test_provenance_sidecar_is_written_next_to_the_output(tmp_path: Path, actions: Path):
    out = tmp_path / "actions.suggested.jsonl"
    apply_review(actions, _table(tmp_path, actions, {1: {"correct_label": "eating"}}), out)
    side = provenance_path(out)
    assert side.name == "actions.suggested.provenance.json"
    data = read_provenance(side)
    assert data.counts.model_labels_changed == 1 and len(data.segments) == 5
    assert json.loads(side.read_text())["format"] == "dryrun.actions-provenance"


def test_cli_review_table_and_apply(
    tmp_path: Path, actions: Path, capsys: pytest.CaptureFixture[str], counter_a: Path
):
    review = tmp_path / "review.csv"
    assert main(["review-table", str(actions), "--out", str(review)]) == 0
    rows = list(csv.DictReader(review.open()))
    rows[0]["correct_label"] = "eating"
    with review.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    out = tmp_path / "fixed.jsonl"
    assert main(["apply-review", str(actions), str(review), "--out", str(out)]) == 0
    text = capsys.readouterr().out
    assert "model labels kept 2 of 3" in text and "changed 1" in text
    assert provenance_path(out).is_file()
    assert counter_a.is_dir()


def test_cli_apply_review_error_is_plain(tmp_path: Path, actions: Path, capsys: pytest.CaptureFixture[str]):
    review = _table(tmp_path, actions, {2: {"correct_kind": "fly"}})
    assert main(["apply-review", str(actions), str(review), "--out", str(tmp_path / "o.jsonl")]) == 1
    err = capsys.readouterr().err
    assert "row 2" in err and "Traceback" not in err


def test_review_rows_must_be_numbers_and_unique(tmp_path: Path, actions: Path):
    review = _table(tmp_path, actions, {})
    lines = review.read_text().splitlines()
    review.write_text("\n".join([lines[0], lines[1], lines[1]]) + "\n")
    with pytest.raises(DryRunError, match="same row number"):
        read_review(review)
    review.write_text("\n".join([lines[0], "x" + lines[1]]) + "\n")
    with pytest.raises(DryRunError, match="line 2: row, t0 and t1 must be numbers"):
        read_review(review)
    with pytest.raises(DryRunError, match="does not exist"):
        read_review(tmp_path / "nope.csv")
