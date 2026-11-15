"""Zero-shot labelling with an image-text model (SigLIP 2 by default).

Each label's texts (prompts x templates) are embedded and averaged into one label vector.
Each frame is scored against every label vector (cosine x the model's logit scale), turned into
a distribution with a softmax over the candidates, and the clip's answer is the mean over frames.
The model itself sits behind `ImageTextBackend`, so this math is tested without weights.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

import numpy as np

from dryrun_vision.labels.providers.base import Clip, check_probabilities
from dryrun_vision.labels.vocab import Candidate


class ImageTextBackend(Protocol):
    """Embeds images and texts in one space (rows need not be normalised)."""

    @property
    def logit_scale(self) -> float: ...

    @property
    def logit_bias(self) -> float: ...

    def image_embeddings(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        """(len(frames), d) for RGB uint8 frames."""
        ...

    def text_embeddings(self, texts: Sequence[str]) -> np.ndarray:
        """(len(texts), d)."""
        ...


def _unit_rows(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.maximum(norms, np.finfo(np.float64).tiny)


def _softmax_rows(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(shifted)
    return e / e.sum(axis=1, keepdims=True)


class SiglipProvider:
    def __init__(self, backend: ImageTextBackend, name: str) -> None:
        self._backend = backend
        self._name = name
        self._label_vectors: dict[tuple[str, ...], np.ndarray] = {}  # memo: texts -> unit label vector

    @property
    def name(self) -> str:
        return self._name

    def _label_vector(self, texts: tuple[str, ...]) -> np.ndarray:
        cached = self._label_vectors.get(texts)
        if cached is None:
            emb = _unit_rows(np.asarray(self._backend.text_embeddings(texts), dtype=np.float64))
            cached = _unit_rows(emb.mean(axis=0, keepdims=True))[0]
            self._label_vectors = {**self._label_vectors, texts: cached}
        return cached

    def score(self, clip: Clip, candidates: Sequence[Candidate]) -> tuple[float, ...]:
        labels = np.stack([self._label_vector(c.texts) for c in candidates])
        images = _unit_rows(np.asarray(self._backend.image_embeddings(clip.frames), dtype=np.float64))
        logits = self._backend.logit_scale * images @ labels.T + self._backend.logit_bias
        pooled = _softmax_rows(logits).mean(axis=0)
        return check_probabilities(pooled.tolist(), len(candidates), self._name)
