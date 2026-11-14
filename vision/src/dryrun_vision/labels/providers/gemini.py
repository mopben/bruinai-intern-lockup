"""Labelling with the Gemini API (google-genai SDK): clip frames + candidate labels -> JSON scores.

The API key is read from the GEMINI_API_KEY environment variable only, and only handed to the
SDK client; it is never logged or stored, and error messages are built from status codes and
exception type names only. Calls go through a CallGuard (call_guard.py): pacing, a per-run cap,
bounded retry with backoff. Written against google-genai 3.3.

Privacy: every scored window sends a few frames of a worker to Google.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from dryrun_vision.labels.errors import LabelError, WindowNotScoredError
from dryrun_vision.labels.providers.base import Clip, check_probabilities
from dryrun_vision.labels.providers.call_guard import CallGuard, CallPolicy, Failure
from dryrun_vision.labels.vocab import Candidate

API_KEY_ENV = "GEMINI_API_KEY"
GEMINI_MODEL = "gemini-3.8-flash"
"""The default model (override with --gemini-model)."""
JPEG_QUALITY = 85
RETRY_CODES = frozenset({408, 429, 500, 502, 503, 504})
"""HTTP statuses worth another try: timeouts, rate limits and server trouble."""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "probability": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["label", "probability"],
            },
        }
    },
    "required": ["scores"],
}

_INSTRUCTIONS = (
    "These {n} frames come from a short clip of one cafe worker, in time order. "
    "Which of these labels describes what the worker is doing? Labels (with descriptions):\n{labels}\n"
    "Answer with JSON only: a probability from 0 to 1 for every label, adding up to 1."
)


class _Response(Protocol):
    @property
    def text(self) -> str | None: ...


class _ModelsApi(Protocol):
    def generate_content(self, *, model: str, contents: object, config: object = None) -> _Response: ...


class GenaiClient(Protocol):
    """The part of google.genai.Client this provider uses."""

    @property
    def models(self) -> _ModelsApi: ...


class _Score(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: str
    probability: float = Field(ge=0)


class _Answer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    scores: list[_Score]


def _jpeg(frame: np.ndarray) -> bytes:
    import cv2  # noqa: PLC0415 - optional ml extra

    ok, buf = cv2.imencode(".jpg", frame[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise LabelError("A clip frame could not be encoded as JPEG for Gemini.")
    return buf.tobytes()


def _prompt(n_frames: int, candidates: Sequence[Candidate]) -> str:
    lines = "\n".join(f'- "{c.label}": {"; ".join(c.prompts)}' for c in candidates)
    return _INSTRUCTIONS.format(n=n_frames, labels=lines)


def parse_answer(text: str | None, candidates: Sequence[Candidate], who: str) -> tuple[float, ...]:
    """The answer's probabilities in candidate order. Missing labels count 0; the rest is normalised."""
    if not text:
        raise WindowNotScoredError(f"{who} gave an empty answer.")
    try:
        answer = _Answer.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise WindowNotScoredError(f"{who} answered with something that is not the JSON asked for.") from exc
    names = [c.label for c in candidates]
    seen = [s.label for s in answer.scores]
    unknown = [s for s in seen if s not in names]
    if unknown:
        raise WindowNotScoredError(f'{who} answered with label "{unknown[0]}", which is not a candidate.')
    twice = [s for s in set(seen) if seen.count(s) > 1]
    if twice:
        raise WindowNotScoredError(f'{who} scored label "{twice[0]}" twice.')
    by_label = {s.label: s.probability for s in answer.scores}
    raw = [by_label.get(n, 0.0) for n in names]
    total = sum(raw)
    if total <= 0:
        raise WindowNotScoredError(f"{who} gave every label probability 0 (all zero).")
    return check_probabilities([p / total for p in raw], len(names), who)


@dataclass(frozen=True)
class GeminiUsage:
    calls: int = 0
    retries: int = 0
    prompt_tokens: int = 0
    output_tokens: int = 0
    thought_tokens: int = 0
    total_tokens: int = 0

    def summary(self) -> str:
        return (
            f"{self.calls} calls ({self.retries} retries), {self.total_tokens} tokens "
            f"({self.prompt_tokens} in, {self.output_tokens} out, {self.thought_tokens} thinking)"
        )


@dataclass(frozen=True)
class GeminiOptions:
    model: str = GEMINI_MODEL
    policy: CallPolicy = field(default_factory=CallPolicy)


def _token(meta: object, name: str) -> int:
    value = getattr(meta, name, None)
    return int(value) if isinstance(value, int) else 0


def classify(exc: BaseException) -> Failure:
    """Plain words for a failed request, from its status code or type name only (never its text)."""
    from google.genai import errors  # noqa: PLC0415 - optional gemini extra

    if isinstance(exc, errors.APIError):
        return Failure(
            retry=exc.code in RETRY_CODES, text=f"was refused by the Gemini API ({exc.code} {exc.status})"
        )
    if isinstance(exc, _network_errors()):
        return Failure(retry=True, text=f"could not be reached ({type(exc).__name__})")
    return Failure(retry=False, text=f"failed unexpectedly ({type(exc).__name__})")


def _network_errors() -> tuple[type[BaseException], ...]:
    import requests  # noqa: PLC0415 - the HTTP library google-genai 3.3 uses

    return (requests.RequestException, ConnectionError, TimeoutError)


class GeminiProvider:
    """Thread-safe: `score` may be called from up to `max_concurrency` threads at once."""

    def __init__(
        self, client: GenaiClient, model: str = GEMINI_MODEL, guard: CallGuard | None = None
    ) -> None:
        self._client = client
        self._model = model
        self._guard = guard or CallGuard(CallPolicy(), self.name)
        self._lock = threading.Lock()
        self._tokens = GeminiUsage()

    @property
    def name(self) -> str:
        return f"gemini:{self._model}"

    @property
    def max_concurrency(self) -> int:
        return self._guard.policy.concurrency

    @property
    def usage(self) -> GeminiUsage:
        with self._lock:
            return replace(self._tokens, calls=self._guard.calls, retries=self._guard.retries)

    def __repr__(self) -> str:
        return f"GeminiProvider(model={self._model!r})"

    def _request(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[list[Any], Any]:
        from google.genai import types  # noqa: PLC0415 - optional gemini extra

        images = [types.Part.from_bytes(data=_jpeg(f), mime_type="image/jpeg") for f in clip.frames]
        config = types.GenerateContentConfig(
            response_mime_type="application/json", response_json_schema=RESPONSE_SCHEMA, temperature=0.0
        )
        return [_prompt(len(clip.frames), candidates), *images], config

    def _count(self, response: object) -> None:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return
        with self._lock:
            t = self._tokens
            self._tokens = replace(
                t,
                prompt_tokens=t.prompt_tokens + _token(meta, "prompt_token_count"),
                output_tokens=t.output_tokens + _token(meta, "candidates_token_count"),
                thought_tokens=t.thought_tokens + _token(meta, "thoughts_token_count"),
                total_tokens=t.total_tokens + _token(meta, "total_token_count"),
            )

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        contents, config = self._request(clip, candidates)
        response = self._guard.call(
            lambda: self._client.models.generate_content(model=self._model, contents=contents, config=config),
            classify,
        )
        self._count(response)
        return parse_answer(response.text, candidates, self.name)


def _default_client(api_key: str) -> GenaiClient:
    try:
        from google import genai  # noqa: PLC0415 - optional gemini extra
    except ImportError as exc:  # pragma: no cover - google-genai is an optional extra
        raise LabelError("The gemini provider needs google-genai: uv sync --extra gemini") from exc
    return genai.Client(api_key=api_key)


def gemini_from_env(
    options: GeminiOptions | None = None,
    env: Mapping[str, str] | None = None,
    client_factory: Callable[[str], GenaiClient] | None = None,
) -> GeminiProvider:
    """A provider using the key in GEMINI_API_KEY; LabelError if it is not set."""
    opts = options or GeminiOptions()
    key = (os.environ if env is None else env).get(API_KEY_ENV, "").strip()
    if not key:
        raise LabelError(
            f"The gemini provider needs an API key in the {API_KEY_ENV} environment variable. "
            "Set it in your shell (never in a file in the repo), or use --provider siglip."
        )
    factory = client_factory or _default_client
    guard = CallGuard(opts.policy, f"Gemini ({opts.model})")
    return GeminiProvider(factory(key), opts.model, guard)
