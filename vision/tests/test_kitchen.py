import json
import logging
import math
from pathlib import Path

import pytest

from conftest import golden_fixture
from dryrun_vision.errors import KitchenError
from dryrun_vision.formats import read_layout, read_scan, read_setup
from dryrun_vision.formats.kitchen_files import MenuItem
from dryrun_vision.geometry import OrientedRect, Vec2
from dryrun_vision.geometry.path import Obstacle, shortest_path
from dryrun_vision.kitchen import STAND_OFF_M, load_kitchen, menu_legs, resolve_kitchen, trip_targets

TOL = 1e-9


def _close_pt(p, q: dict) -> bool:
    return abs(p.x - q["x"]) < TOL and abs(p.z - q["z"]) < TOL


def test_items_match_typescript(fixture_dir: Path, fixture_name: str):
    g = golden_fixture(fixture_name)["kitchen"]
    k = load_kitchen(fixture_dir)
    assert [it.id for it in k.items] == [it["id"] for it in g["items"]]
    for it, gi in zip(k.items, g["items"], strict=True):
        assert it.role == gi["role"] and it.stand_side == gi["standSide"]
        assert _close_pt(it.stand, gi["stand"])
        assert all(_close_pt(p, q) for p, q in zip(it.footprint, gi["footprint"], strict=True))
    for w, gw in zip(k.walls, g["walls"], strict=True):
        assert all(_close_pt(p, q) for p, q in zip(w.footprint, gw["footprint"], strict=True))


def test_bounds_and_worker_stands_match_typescript(fixture_dir: Path, fixture_name: str):
    g = golden_fixture(fixture_name)["kitchen"]
    k = load_kitchen(fixture_dir)
    b = k.bounds
    assert (b.min_x, b.max_x, b.min_z, b.max_z) == pytest.approx(
        (g["bounds"]["minX"], g["bounds"]["maxX"], g["bounds"]["minZ"], g["bounds"]["maxZ"]), abs=TOL
    )
    for w in k.workers:
        assert _close_pt(k.home_station(w.id).stand, g["stands"][w.id])


def test_menu_legs_match_typescript(fixture_dir: Path, fixture_name: str):
    plans = golden_fixture(fixture_name)["plans"]
    expected = [
        (
            p["itemId"],
            s["step"],
            leg["kind"],
            leg["fromId"],
            leg["toId"],
            leg["oneWayM"],
            leg["handoff"],
            leg["blocked"],
        )
        for p in plans
        for s in p["steps"]
        for leg in s["legs"]
    ]
    got = menu_legs(load_kitchen(fixture_dir))
    assert len(got) == len(expected)
    for leg, e in zip(got, expected, strict=True):
        assert (leg.item_id, leg.step, leg.kind, leg.from_id, leg.to_id) == e[:5]
        assert leg.one_way_m == pytest.approx(e[5], abs=1e-9)
        assert leg.round_trip_m == pytest.approx(2 * e[5], abs=1e-9)
        assert (leg.handoff, leg.blocked) == e[6:]


def test_roles_and_lookups(counter_a: Path):
    k = load_kitchen(counter_a)
    assert {i.name for i in k.stations} == {"Order (till)", "Espresso machine", "Finish"}
    assert [i.name for i in k.storage] == ["Milk fridge"]
    assert k.pickup.name == "Pickup"
    assert all(i.role != "ignore" for i in k.items)
    assert k.item("nope") is None
    assert k.home_station("red").name == "Order (till)"
    with pytest.raises(KitchenError, match="No worker"):
        k.home_station("purple")
    assert STAND_OFF_M == 0.35


def test_trip_targets_for_espresso(counter_a: Path):
    k = load_kitchen(counter_a)
    espresso = k.home_station("blue").id
    targets = trip_targets(k, espresso)
    # Espresso -> Finish is a hand-off (no walking), so only the fridge fetch remains.
    assert [(t.kind, k.item(t.target_id).name) for t in targets] == [("fetch", "Milk fridge")]
    finish = k.home_station("yellow").id
    assert [(t.kind, k.item(t.target_id).name) for t in trip_targets(k, finish)] == [("carry", "Pickup")]


def test_problems_are_listed_together(counter_a: Path):
    scan = read_scan(counter_a / "scan.json")
    setup = read_setup(counter_a / "setup.json")
    layout = read_layout(counter_a / "layout.json")
    bad_setup = setup.model_copy(update={"pickup_id": scan.boxes[0].id})
    bad_layout = layout.model_copy(
        update={"placements": {**layout.placements, "ghost": layout.placements[scan.boxes[0].id]}}
    )
    with pytest.raises(KitchenError) as info:
        resolve_kitchen(scan, bad_setup, bad_layout)
    issues = info.value.issues
    assert any("Pickup" in i for i in issues)
    assert any("ghost" in i for i in issues)


def test_box_without_setup_is_a_fixture_with_warning(counter_a: Path):
    scan = read_scan(counter_a / "scan.json")
    setup = read_setup(counter_a / "setup.json")
    layout = read_layout(counter_a / "layout.json")
    sink_id = next(i.box_id for i in setup.items if i.name == "Sink")
    trimmed = setup.model_copy(update={"items": tuple(i for i in setup.items if i.box_id != sink_id)})
    k = resolve_kitchen(scan, trimmed, layout)
    assert k.item(sink_id).role == "fixture"
    assert any(sink_id in w for w in k.warnings)


def test_shortest_paths_match_typescript(fixture_dir: Path, fixture_name: str):
    k = load_kitchen(fixture_dir)
    golden_paths = golden_fixture(fixture_name)["paths"]
    detours = 0
    for g in golden_paths:
        p = shortest_path(k.obstacles, k.item(g["fromId"]).stand, k.item(g["toId"]).stand)
        assert p.length == pytest.approx(g["length"], abs=1e-9)
        assert p.blocked == g["blocked"]
        assert len(p.points) == len(g["points"])
        assert all(_close_pt(a, b) for a, b in zip(p.points, g["points"], strict=True))
        detours += len(p.points) > 2
    assert detours > 10


def test_walled_in_point_is_blocked():
    def box(cx: float, cz: float, hw: float, hd: float) -> Obstacle:
        r = OrientedRect(Vec2(cx, cz), hw, hd, 0.0)
        return Obstacle("o", r, r)

    ring = [box(0, 2, 3, 0.5), box(0, -2, 3, 0.5), box(2, 0, 0.5, 3), box(-2, 0, 0.5, 3)]
    p = shortest_path(ring, Vec2(0, 0), Vec2(5, 5))
    assert p.blocked and p.length == pytest.approx(math.hypot(5, 5))


def _counter_a(counter_a: Path):
    return (
        read_scan(counter_a / "scan.json"),
        read_setup(counter_a / "setup.json"),
        read_layout(counter_a / "layout.json"),
    )


def _with_tasks(setup, tasks: list[dict]):
    item = setup.menu[0]
    new = MenuItem.model_validate({**item.model_dump(by_alias=True), "tasks": tasks})
    return setup.model_copy(update={"menu": (new, *setup.menu[1:])})


def test_a_task_graph_changes_where_each_step_carries_to(counter_a: Path):
    scan, setup, layout = _counter_a(counter_a)
    till, esp, fin = (s.station_id for s in setup.menu[0].steps)
    fridge = setup.menu[0].steps[1].fetch_from
    graph = [
        {"id": "take", "stationId": till},
        {"id": "brew", "stationId": esp, "fetchFrom": list(fridge)},
        {"id": "finish", "stationId": fin, "after": ["take", "brew"]},
    ]
    k = resolve_kitchen(scan, _with_tasks(setup, graph), layout)
    carries = {
        (leg.from_id, leg.to_id)
        for leg in menu_legs(k)
        if leg.kind == "carry" and leg.item_id == setup.menu[0].id
    }
    assert carries == {
        (till, fin),
        (esp, fin),
        (fin, setup.pickup_id),
    }  # the till no longer carries to espresso


def test_task_graph_problems_stop_the_kitchen(counter_a: Path):
    scan, setup, layout = _counter_a(counter_a)
    till = setup.menu[0].steps[0].station_id
    with pytest.raises(KitchenError) as info:
        resolve_kitchen(scan, _with_tasks(setup, [{"id": "take", "stationId": till}]), layout)
    assert any("tasks but" in i for i in info.value.issues)


def test_covers_are_read_but_warned_about(counter_a: Path, caplog: pytest.LogCaptureFixture):
    scan, setup, layout = _counter_a(counter_a)
    esp = setup.menu[0].steps[1].station_id
    red = layout.workers[0].model_copy(update={"covers": (esp,)})
    k = resolve_kitchen(scan, setup, layout.model_copy(update={"workers": (red, *layout.workers[1:])}))
    assert any("covers" in w and "not understood by the video pipeline" in w for w in k.warnings)
    bad = layout.workers[0].model_copy(update={"covers": (setup.pickup_id,)})
    with pytest.raises(KitchenError, match="covers"):
        resolve_kitchen(scan, setup, layout.model_copy(update={"workers": (bad, *layout.workers[1:])}))


def test_load_kitchen_logs_its_warnings(counter_a: Path, tmp_path: Path, caplog: pytest.LogCaptureFixture):
    for name in ("scan.json", "setup.json"):
        (tmp_path / name).write_text((counter_a / name).read_text())
    data = json.loads((counter_a / "layout.json").read_text())
    data["workers"][0]["covers"] = [data["workers"][1]["stationId"]]
    (tmp_path / "layout.json").write_text(json.dumps(data))
    with caplog.at_level(logging.WARNING, logger="dryrun_vision"):
        load_kitchen(tmp_path)
    assert any("covers" in m for m in caplog.messages)
