import json
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from dryrun_vision.labels.errors import LabelError
from dryrun_vision.labels.providers import registry
from dryrun_vision.labels.providers.base import Clip, check_probabilities
from dryrun_vision.labels.providers.call_guard import CallGuard, CallPolicy
from dryrun_vision.labels.providers.gemini import API_KEY_ENV, GeminiOptions, GeminiProvider, gemini_from_env
from dryrun_vision.labels.providers.siglip import SiglipProvider
from dryrun_vision.labels.vocab import Candidate

CANDS = (
    Candidate("pouring", ("pouring milk",), ("a photo of pouring milk", "someone pouring milk")),
    Candidate("waiting", ("standing still",), ("a photo of standing still",)),
)


def clip(n: int = 2, value: int = 10) -> Clip:
    return Clip.of([np.full((8, 6, 3), value, dtype=np.uint8) for _ in range(n)])


# ---- clip and probability checks


def test_clip_copies_and_freezes_frames():
    f = np.zeros((4, 4, 3), dtype=np.uint8)
    c = Clip.of([f])
    f[0, 0, 0] = 9
    assert c.frames[0][0, 0, 0] == 0
    with pytest.raises(ValueError):
        c.frames[0][0, 0, 0] = 1
    assert f.flags.writeable


def test_clip_rejects_bad_frames():
    with pytest.raises(ValueError, match="RGB"):
        Clip.of([np.zeros((4, 4), dtype=np.uint8)])
    with pytest.raises(ValueError, match="at least one"):
        Clip.of([])


def test_check_probabilities():
    assert check_probabilities([0.25, 0.75], 2, "x") == (0.25, 0.75)
    with pytest.raises(LabelError, match="3 probabilities for 2"):
        check_probabilities([0.2, 0.3, 0.5], 2, "x")
    with pytest.raises(LabelError, match="negative"):
        check_probabilities([-0.1, 1.1], 2, "x")
    with pytest.raises(LabelError, match="add up"):
        check_probabilities([0.2, 0.2], 2, "x")


# ---- siglip with a fake backend


@dataclass
class FakeBackend:
    logit_scale: float = 10.0
    logit_bias: float = -5.0
    text_calls: list[tuple[str, ...]] = field(default_factory=list)

    def image_embeddings(self, frames):
        # frame brightness decides the direction: dark -> e0, bright -> e1
        rows = [[1.0, 0.0] if f.mean() < 100 else [0.0, 1.0] for f in frames]
        return np.array(rows)

    def text_embeddings(self, texts):
        self.text_calls.append(tuple(texts))
        return np.array([[1.0, 0.0] if "pouring" in t else [0.0, 1.0] for t in texts])


def test_siglip_scores_by_similarity_and_pools_frames():
    b = FakeBackend()
    p = SiglipProvider(b, "siglip:fake")
    dark = p.score(clip(value=10), CANDS)
    assert dark[0] > 0.99 and abs(sum(dark) - 1) < 1e-9
    mixed = Clip.of([np.full((4, 4, 3), 10, np.uint8), np.full((4, 4, 3), 200, np.uint8)])
    m = p.score(mixed, CANDS)
    assert abs(m[0] - 0.5) < 1e-6
    assert p.name == "siglip:fake"


def test_siglip_caches_text_embeddings():
    b = FakeBackend()
    p = SiglipProvider(b, "s")
    p.score(clip(), CANDS)
    p.score(clip(), CANDS)
    assert len(b.text_calls) == len(CANDS)  # once per label, never again


def test_siglip_averages_prompt_embeddings_per_label():
    b = FakeBackend()
    p = SiglipProvider(b, "s")
    mixed_label = (Candidate("a", ("x",), ("pouring", "standing")), Candidate("b", ("y",), ("standing",)))
    probs = p.score(clip(value=10), mixed_label)
    assert probs[0] > probs[1]  # the mean of e0 and e1 is closer to a dark frame than e1 is


# ---- gemini with a fake client


@dataclass
class FakeResponse:
    text: str | None


@dataclass
class FakeModels:
    answer: str | None
    calls: list[dict[str, Any]] = field(default_factory=list)

    def generate_content(self, *, model: str, contents: Any, config: Any = None) -> FakeResponse:
        self.calls.append({"model": model, "contents": contents, "config": config})
        return FakeResponse(self.answer)


@dataclass
class FakeClient:
    models: FakeModels


def gemini(answer: str | None) -> tuple[GeminiProvider, FakeModels]:
    models = FakeModels(answer)
    return GeminiProvider(FakeClient(models), model="gemini-test"), models


def answer(**scores: float) -> str:
    return json.dumps({"scores": [{"label": k, "probability": v} for k, v in scores.items()]})


def test_gemini_request_shape():
    p, models = gemini(answer(pouring=0.8, waiting=0.2))
    probs = p.score(clip(n=3), CANDS)
    assert probs == pytest.approx((0.8, 0.2))
    call = models.calls[0]
    assert call["model"] == "gemini-test"
    text, *images = call["contents"]
    assert isinstance(text, str) and '"pouring"' in text and "pouring milk" in text and '"waiting"' in text
    assert len(images) == 3
    assert images[0].inline_data.mime_type == "image/jpeg"
    assert images[0].inline_data.data[:2] == b"\xff\xd8"  # JPEG magic
    assert call["config"].response_mime_type == "application/json"
    assert call["config"].temperature == 0
    assert call["config"].response_json_schema["required"] == ["scores"]
    assert p.name == "gemini:gemini-test"


def test_gemini_missing_labels_count_as_zero_and_are_normalised():
    p, _ = gemini(answer(pouring=3.0))
    assert p.score(clip(), CANDS) == pytest.approx((1.0, 0.0))


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (None, "empty"),
        ("not json", "not the JSON"),
        (json.dumps({"scores": "x"}), "not the JSON"),
        (answer(dancing=0.5, waiting=0.5), "dancing"),
        (json.dumps({"scores": [{"label": "waiting", "probability": 0.5}] * 2}), "twice"),
        (answer(pouring=0.0, waiting=0.0), "all zero"),
        (answer(pouring=-1.0, waiting=0.5), "not the JSON"),
    ],
)
def test_gemini_malformed_answers_are_plain_errors(raw, message):
    p, _ = gemini(raw)
    with pytest.raises(LabelError, match=message):
        p.score(clip(), CANDS)


NO_WAIT = CallPolicy(backoff_s=0.0, max_backoff_s=0.0, min_interval_s=0.0, max_attempts=3)


@dataclass
class Scripted:
    """generate_content raises the scripted errors in turn, then answers."""

    errors: list[BaseException]
    answer: str
    usage: Any = None
    calls: int = 0

    def generate_content(self, **_: Any) -> Any:
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return SimpleNamespace(text=self.answer, usage_metadata=self.usage)


def scripted(errs: list[BaseException], policy: CallPolicy = NO_WAIT, usage: Any = None):
    models = Scripted(errs, answer(pouring=1.0), usage)
    guard = CallGuard(policy, "Gemini (m)")
    return GeminiProvider(FakeClient(models), model="m", guard=guard), models  # type: ignore[arg-type]


def api_error(code: int, status: str) -> BaseException:
    from google.genai import errors  # noqa: PLC0415 - optional gemini extra

    return errors.APIError(code, {"error": {"message": "test-key in a message", "status": status}})


def test_gemini_rate_limits_and_server_errors_are_retried():
    p, models = scripted([api_error(429, "RESOURCE_EXHAUSTED"), api_error(503, "UNAVAILABLE")])
    assert p.score(clip(), CANDS) == pytest.approx((1.0, 0.0))
    assert models.calls == 3 and p.usage.calls == 3 and p.usage.retries == 2


def test_gemini_gives_up_after_bounded_retries_without_secrets():
    p, models = scripted([api_error(429, "RESOURCE_EXHAUSTED")] * 5)
    with pytest.raises(LabelError, match="429 RESOURCE_EXHAUSTED") as info:
        p.score(clip(), CANDS)
    assert models.calls == 3 and "test-key" not in str(info.value) and "3 times" in str(info.value)


def test_gemini_client_errors_are_not_retried():
    p, models = scripted([api_error(400, "INVALID_ARGUMENT")])
    with pytest.raises(LabelError, match="400 INVALID_ARGUMENT") as info:
        p.score(clip(), CANDS)
    assert models.calls == 1 and "test-key" not in str(info.value)


def test_gemini_network_errors_are_retried_and_named_plainly():
    import requests  # noqa: PLC0415 - comes with google-genai

    p, models = scripted([requests.ConnectionError("https://x/?key=test-key")] * 5)
    with pytest.raises(LabelError, match="could not be reached") as info:
        p.score(clip(), CANDS)
    assert models.calls == 3 and "test-key" not in str(info.value) and "ConnectionError" in str(info.value)


def test_gemini_counts_tokens_when_the_service_reports_them():
    usage = SimpleNamespace(
        prompt_token_count=1000, candidates_token_count=40, thoughts_token_count=7, total_token_count=1047
    )
    p, _ = scripted([], usage=usage)
    p.score(clip(), CANDS)
    p.score(clip(), CANDS)
    u = p.usage
    assert (u.calls, u.prompt_tokens, u.output_tokens, u.thought_tokens, u.total_tokens) == (
        2,
        2000,
        80,
        14,
        2094,
    )
    assert "2 calls" in u.summary() and "2094 tokens" in u.summary()


def test_gemini_cap_and_concurrency_come_from_the_policy():
    p, _ = scripted([], policy=CallPolicy(max_calls=1, min_interval_s=0.0, concurrency=3))
    assert p.max_concurrency == 3
    p.score(clip(), CANDS)
    with pytest.raises(LabelError, match="cap of 1 calls"):
        p.score(clip(), CANDS)


def test_gemini_missing_key_is_a_plain_error():
    with pytest.raises(LabelError, match=API_KEY_ENV):
        gemini_from_env(env={})
    with pytest.raises(LabelError, match=API_KEY_ENV):
        gemini_from_env(env={API_KEY_ENV: "  "})


def test_gemini_from_env_passes_the_key_to_the_client_only():
    seen = {}

    def factory(api_key: str) -> FakeClient:
        seen["key"] = api_key
        return FakeClient(FakeModels(answer(pouring=1.0)))

    opts = GeminiOptions(model="m", policy=CallPolicy(max_calls=7))
    p = gemini_from_env(opts, env={API_KEY_ENV: "test-key"}, client_factory=factory)
    assert seen == {"key": "test-key"} and p.name == "gemini:m"
    assert "test-key" not in p.name and "test-key" not in repr(p)


# ---- registry


def test_registry_unknown_provider():
    with pytest.raises(LabelError, match="siglip"):
        registry.make_provider("nope")


def test_registry_builds_gemini_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    with pytest.raises(LabelError, match=API_KEY_ENV):
        registry.make_provider("gemini")


def test_registry_passes_gemini_options(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(API_KEY_ENV, "test-key")
    p = registry.make_provider("gemini", GeminiOptions(model="gemini-x", policy=CallPolicy(concurrency=2)))
    assert p.name == "gemini:gemini-x" and p.max_concurrency == 2  # type: ignore[attr-defined]
