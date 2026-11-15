import json
from pathlib import Path

import pytest

from dryrun_vision.errors import FormatError
from dryrun_vision.formats import Detection
from dryrun_vision.geometry import Vec2
from dryrun_vision.identity import DroppedTrack, Fragment, IdentityResult, Person
from dryrun_vision.labels.crop import Box
from dryrun_vision.labels.vocab import (
    Vocabulary,
    candidates_of,
    idle_label_set,
    read_vocab,
    station_label_set,
)
from dryrun_vision.labels.worker_boxes import (
    TimedBox,
    WorkerBoxes,
    worker_boxes_from_identity,
    worker_boxes_from_tracks,
)

VISION = Path(__file__).resolve().parents[2]


def det(frame: int, tid: int, x: float = 10, score: float = 0.9) -> Detection:
    return Detection(frame=frame, t=frame / 10, track_id=tid, x=x, y=5, w=20, h=40, score=score)


def test_box_at_nearest_within_gap():
    wb = WorkerBoxes("red", (TimedBox(0.0, Box(0, 0, 10, 10)), TimedBox(1.0, Box(50, 0, 10, 10))))
    assert wb.box_at(0.2, 0.5) == Box(0, 0, 10, 10)
    assert wb.box_at(0.7, 0.5) == Box(50, 0, 10, 10)
    assert wb.box_at(1.6, 0.5) is None
    assert WorkerBoxes("x", ()).box_at(0.0, 0.5) is None


def test_worker_boxes_must_be_time_sorted():
    with pytest.raises(ValueError, match="sorted"):
        WorkerBoxes("red", (TimedBox(1.0, Box(0, 0, 1, 1)), TimedBox(0.5, Box(0, 0, 1, 1))))


def test_from_tracks_groups_by_worker_and_keeps_best_score_at_one_time():
    dets = [det(0, 1), det(0, 2, x=99), det(1, 1), det(1, 3, x=77, score=0.95), det(2, 3)]
    out = worker_boxes_from_tracks(dets, {1: "red", 2: "blue", 3: "red"})
    by = {w.worker_id: w for w in out}
    assert [b.t for b in by["red"].boxes] == [0.0, 0.1, 0.2]
    assert by["red"].boxes[1].box.x == 77  # two red tracks at t=0.1: higher score wins
    assert by["blue"].boxes[0].box.x == 99


def test_from_tracks_ignores_unmapped_tracks():
    out = worker_boxes_from_tracks([det(0, 9)], {1: "red"})
    assert out == ()


def _fragment(tid: int, frames: range, x: float) -> Fragment:
    dets = tuple(det(f, tid, x=x) for f in frames)
    return Fragment(tid, dets, tuple(Vec2(0.0, 0.0) for _ in dets))


def test_from_identity_follows_the_stitched_tracks():
    red = Person("red", (_fragment(4, range(0, 3), 10), _fragment(7, range(5, 7), 30)))
    blue = Person("blue", (_fragment(2, range(1, 3), 50),))
    ident = IdentityResult((red, blue), (DroppedTrack((9,), "never inside the working area", 1.0),), ())
    out = worker_boxes_from_identity(ident)
    assert set(out) == {"red", "blue"}
    assert [b.t for b in out["red"].boxes] == [0.0, 0.1, 0.2, 0.5, 0.6]  # video time, both fragments
    assert [b.box.x for b in out["red"].boxes] == [10, 10, 10, 30, 30]
    assert out["blue"].boxes[0].box == Box(50, 5, 20, 40)


def test_from_identity_keeps_one_box_per_time():
    frag = Fragment(1, (det(0, 1, score=0.5), det(0, 1, x=40, score=0.9)), (Vec2(0, 0), Vec2(0, 0)))
    out = worker_boxes_from_identity(IdentityResult((Person("red", (frag,)),), (), ()))
    assert [b.box.x for b in out["red"].boxes] == [40]


def vocab_json(**over: object) -> dict:
    base = {
        "format": "dryrun.vocab",
        "version": 1,
        "templates": ["a photo of a person {}."],
        "waitingLabel": "waiting",
        "stations": [
            {
                "match": ["espresso"],
                "labels": [
                    {"label": "pulling a shot", "prompts": ["pulling an espresso shot"]},
                    {"label": "waiting", "prompts": ["standing still"]},
                ],
            }
        ],
        "defaultStation": {
            "labels": [
                {"label": "working", "prompts": ["working at a counter"]},
                {"label": "waiting", "prompts": ["standing still"]},
            ]
        },
        "idle": {
            "labels": [
                {"label": "talking", "prompts": ["talking"]},
                {"label": "waiting", "prompts": ["standing still"]},
            ]
        },
    }
    return {**base, **over}


def write(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "v.json"
    p.write_text(json.dumps(data))
    return p


def test_vocab_reads_and_picks_station_by_name(tmp_path: Path):
    v = read_vocab(write(tmp_path, vocab_json()))
    assert station_label_set(v, "Espresso machine").labels[0].label == "pulling a shot"
    assert station_label_set(v, "Till").labels[0].label == "working"
    assert idle_label_set(v).labels[0].label == "talking"


def test_candidates_expand_templates(tmp_path: Path):
    v = read_vocab(write(tmp_path, vocab_json(templates=["a photo of a person {}.", "someone {}"])))
    c = candidates_of(v, station_label_set(v, "espresso"))
    assert c[0].label == "pulling a shot"
    assert c[0].texts == ("a photo of a person pulling an espresso shot.", "someone pulling an espresso shot")
    assert c[0].prompts == ("pulling an espresso shot",)


def test_vocab_needs_waiting_label_everywhere(tmp_path: Path):
    data = vocab_json()
    data["idle"]["labels"][1]["label"] = "resting"
    with pytest.raises(FormatError, match="waiting"):
        read_vocab(write(tmp_path, data))


def test_vocab_rejects_duplicate_labels_and_bad_templates(tmp_path: Path):
    data = vocab_json()
    data["idle"]["labels"][0]["label"] = "waiting"
    with pytest.raises(FormatError, match="twice"):
        read_vocab(write(tmp_path, data))
    with pytest.raises(FormatError, match=r"\{\}"):
        read_vocab(write(tmp_path, vocab_json(templates=["no slot"])))


def test_vocab_station_needs_match_and_known_fields(tmp_path: Path):
    data = vocab_json()
    data["stations"][0]["match"] = []
    with pytest.raises(FormatError, match="match"):
        read_vocab(write(tmp_path, data))
    with pytest.raises(FormatError, match="not a known field"):
        read_vocab(write(tmp_path, vocab_json(extra=1)))


def test_vocab_label_needs_a_prompt(tmp_path: Path):
    data = vocab_json()
    data["idle"]["labels"][0]["prompts"] = []
    with pytest.raises(FormatError, match="prompts"):
        read_vocab(write(tmp_path, data))


@pytest.mark.parametrize("name", ["cafe.json", "breakfast.json"])
def test_shipped_vocabularies_are_valid(name: str):
    v = read_vocab(VISION / "src" / "dryrun_vision" / "labels" / "vocabularies" / name)
    assert isinstance(v, Vocabulary)
    assert all(len(candidates_of(v, s)) >= 2 for s in (*v.stations, v.default_station, v.idle))


def test_breakfast_vocab_covers_the_dataset_labels():
    v = read_vocab(VISION / "src" / "dryrun_vision" / "labels" / "vocabularies" / "breakfast.json")
    every = {c.label for c in candidates_of(v, v.default_station)}
    assert every == {
        "SIL", "take_cup", "pour_coffee", "pour_milk", "pour_sugar", "stir_coffee",
        "add_teabag", "pour_water", "spoon_sugar", "spoon_powder", "stir_milk",
    }  # fmt: skip
    assert {c.label for c in candidates_of(v, station_label_set(v, "milk"))} == {
        "SIL", "pour_milk", "spoon_powder", "stir_milk",
    }  # fmt: skip
