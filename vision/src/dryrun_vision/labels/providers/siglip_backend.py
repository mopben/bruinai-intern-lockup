"""The real SigLIP 2 model via Hugging Face transformers (torch). Loaded only when used.

Weights: google/siglip2-base-patch16-224 (Apache-2.0), pinned to one revision so results
do not change under us. About 1.5 GB in the Hugging Face cache.
"""

from __future__ import annotations

from collections.abc import Sequence
from types import ModuleType
from typing import TYPE_CHECKING

import numpy as np

from dryrun_vision.labels.errors import LabelError

if TYPE_CHECKING:
    import torch

SIGLIP_REPO = "google/siglip2-base-patch16-224"
SIGLIP_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
TEXT_MAX_TOKENS = 64
"""SigLIP 2 text towers were trained on 64 padded tokens; pad to exactly that."""
IMAGE_BATCH = 32
"""Frames per forward pass."""


def pick_device(torch: ModuleType) -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _features(out: object) -> torch.Tensor:
    """transformers 5 returns a model output from get_*_features; older versions a tensor."""
    return getattr(out, "pooler_output", out)  # type: ignore[no-any-return]


class TorchSiglipBackend:
    def __init__(self, repo: str = SIGLIP_REPO, revision: str = SIGLIP_REVISION) -> None:
        try:
            import torch  # noqa: PLC0415 - optional ml extra, heavy
            from transformers import AutoModel, AutoProcessor  # noqa: PLC0415
        except ImportError as exc:
            raise LabelError("The siglip provider needs torch and transformers: uv sync --extra ml") from exc
        self._torch = torch
        self._device = pick_device(torch)
        self._dtype = torch.float32 if self._device == "cpu" else torch.float16
        try:
            self._processor = AutoProcessor.from_pretrained(repo, revision=revision)
            model = AutoModel.from_pretrained(repo, revision=revision, dtype=self._dtype)
        except OSError as exc:
            raise LabelError(
                f"Could not load {repo} (revision {revision[:8]}). Connect to the internet once to "
                f"download it (about 1.5 GB) or check the Hugging Face cache. ({exc})"
            ) from exc
        self._model = model.to(self._device).eval()
        self.logit_scale = float(self._model.logit_scale.exp().item())
        self.logit_bias = float(self._model.logit_bias.item())

    def image_embeddings(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        chunks = [self._images(frames[i : i + IMAGE_BATCH]) for i in range(0, len(frames), IMAGE_BATCH)]
        return np.concatenate(chunks, axis=0)

    def _images(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        writable = [np.array(f) for f in frames]  # clip frames are read-only; torch wants writable arrays
        inputs = self._processor(images=writable, return_tensors="pt")
        pixels = inputs["pixel_values"].to(self._device, self._dtype)
        with self._torch.no_grad():
            out = _features(self._model.get_image_features(pixel_values=pixels))
        return out.float().cpu().numpy()

    def text_embeddings(self, texts: Sequence[str]) -> np.ndarray:
        inputs = self._processor(
            text=[t.lower() for t in texts], padding="max_length", max_length=TEXT_MAX_TOKENS,
            truncation=True, return_tensors="pt",
        )  # fmt: skip
        with self._torch.no_grad():
            out = _features(self._model.get_text_features(input_ids=inputs["input_ids"].to(self._device)))
        return out.float().cpu().numpy()
