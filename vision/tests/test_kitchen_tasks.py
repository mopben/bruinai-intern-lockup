"""Task graphs and covered stations, golden-tested against src/core/tasks.ts.

tests/golden/tasks.json was written by running the TypeScript itemTasks / taskIssues / workerCovers
on these cases (the script is quoted in vision/README.md, "Golden files").
"""

import json
from dataclasses import asdict

import pytest

from conftest import VISION_DIR
from dryrun_vision.formats.kitchen_files import MenuItem, WorkerDef
from dryrun_vision.kitchen.tasks import item_tasks, task_issues, worker_covers

GOLDEN = json.loads((VISION_DIR / "tests" / "golden" / "tasks.json").read_text())


def _ts_shape(task: object) -> dict:
    d = asdict(task)  # type: ignore[call-overload]
    return {"index": d["index"], "id": d["id"], "stationId": d["station_id"],
            "fetchFrom": list(d["fetch_from"]), "after": list(d["after"]), "next": d["next"]}  # fmt: skip


@pytest.mark.parametrize("case", GOLDEN["items"], ids=lambda c: c["item"]["id"])
def test_item_tasks_and_issues_match_the_typescript(case: dict):
    item = MenuItem.model_validate(case["item"])
    assert [_ts_shape(t) for t in item_tasks(item)] == case["tasks"]
    assert list(task_issues(item)) == case["issues"]


@pytest.mark.parametrize("case", GOLDEN["workers"], ids=lambda c: c["worker"]["id"])
def test_worker_covers_match_the_typescript(case: dict):
    assert list(worker_covers(WorkerDef.model_validate(case["worker"]))) == case["covers"]
