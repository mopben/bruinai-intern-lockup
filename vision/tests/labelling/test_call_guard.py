"""The guard around paid API calls: pacing, a per-run cap, bounded retry with backoff, plain errors."""

import threading

import pytest

from dryrun_vision.labels.errors import LabelError
from dryrun_vision.labels.providers.call_guard import CallGuard, CallPolicy, Failure


class FakeTime:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(round(s, 6))
        self.t += s


def guard(policy: CallPolicy, ft: FakeTime) -> CallGuard:
    return CallGuard(policy, "Gemini", sleep=ft.sleep, now=ft.now)


def classify(exc: BaseException) -> Failure:
    return Failure(retry=isinstance(exc, TimeoutError), text=f"failed ({type(exc).__name__})")


def flaky(failures: int, exc: BaseException):
    state = {"n": 0}

    def fn() -> str:
        state["n"] += 1
        if state["n"] <= failures:
            raise exc
        return "ok"

    return fn, state


def test_retries_with_doubling_backoff_then_succeeds():
    ft = FakeTime()
    g = guard(CallPolicy(max_attempts=4, backoff_s=1.0, max_backoff_s=3.0, min_interval_s=0.0), ft)
    fn, state = flaky(3, TimeoutError())
    assert g.call(fn, classify) == "ok"
    assert state["n"] == 4 and ft.sleeps == [1.0, 2.0, 3.0]  # capped at max_backoff_s
    assert g.calls == 4 and g.retries == 3


def test_gives_up_after_max_attempts_with_a_plain_error():
    ft = FakeTime()
    g = guard(CallPolicy(max_attempts=2, backoff_s=0.5, min_interval_s=0.0), ft)
    fn, state = flaky(5, TimeoutError("secret-ish detail"))
    with pytest.raises(LabelError, match=r"Gemini failed \(TimeoutError\) 2 times") as info:
        g.call(fn, classify)
    assert state["n"] == 2 and "secret-ish" not in str(info.value)


def test_errors_that_are_not_worth_retrying_fail_at_once():
    ft = FakeTime()
    g = guard(CallPolicy(min_interval_s=0.0), ft)
    fn, state = flaky(1, ValueError("bad request"))
    with pytest.raises(LabelError, match=r"Gemini failed \(ValueError\)"):
        g.call(fn, classify)
    assert state["n"] == 1 and ft.sleeps == []


def test_label_errors_pass_through_unchanged():
    g = guard(CallPolicy(min_interval_s=0.0), FakeTime())

    def fn() -> str:
        raise LabelError("the answer was not JSON")

    with pytest.raises(LabelError, match="not JSON"):
        g.call(fn, classify)


def test_calls_are_paced():
    ft = FakeTime()
    g = guard(CallPolicy(min_interval_s=0.5), ft)
    for _ in range(3):
        g.call(lambda: "ok", classify)
    assert ft.sleeps == [0.5, 0.5]


def test_the_cap_stops_a_runaway_run():
    g = guard(CallPolicy(max_calls=2, min_interval_s=0.0), FakeTime())
    g.call(lambda: "ok", classify)
    g.call(lambda: "ok", classify)
    with pytest.raises(LabelError, match="cap of 2 calls"):
        g.call(lambda: "ok", classify)
    assert g.calls == 2


def test_retries_count_towards_the_cap():
    g = guard(CallPolicy(max_calls=2, max_attempts=5, backoff_s=0.1, min_interval_s=0.0), FakeTime())
    fn, _ = flaky(5, TimeoutError())
    with pytest.raises(LabelError, match="cap of 2 calls"):
        g.call(fn, classify)


def test_the_count_is_safe_across_threads():
    g = CallGuard(CallPolicy(max_calls=1000, min_interval_s=0.0), "Gemini")
    threads = [
        threading.Thread(target=lambda: [g.call(lambda: 1, classify) for _ in range(50)]) for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert g.calls == 400


@pytest.mark.parametrize(
    "kw",
    [
        {"max_calls": 0},
        {"max_attempts": 0},
        {"backoff_s": -1.0},
        {"min_interval_s": -0.1},
        {"concurrency": 0},
    ],
)
def test_bad_policies_are_refused(kw: dict):
    with pytest.raises(ValueError):
        CallPolicy(**kw)
