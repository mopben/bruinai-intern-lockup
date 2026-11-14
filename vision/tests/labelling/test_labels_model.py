"""Real SigLIP 2 weights and the Breakfast data. Opt-in: DRYRUN_MODEL_TESTS=1 uv run pytest -m model."""

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from dryrun_vision.labels.providers.siglip_backend import SIGLIP_REPO, SIGLIP_REVISION, pick_device

VISION = Path(__file__).resolve().parents[2]
BREAKFAST = VISION / "data" / "breakfast"


def _flag(on: bool) -> SimpleNamespace:
    return SimpleNamespace(is_available=lambda: on)


def test_pick_device_prefers_mps_then_cuda():
    def fake(mps: bool, cuda: bool) -> SimpleNamespace:
        return SimpleNamespace(backends=SimpleNamespace(mps=_flag(mps)), cuda=_flag(cuda))

    assert pick_device(fake(True, True)) == "mps"  # type: ignore[arg-type]
    assert pick_device(fake(False, True)) == "cuda"  # type: ignore[arg-type]
    assert pick_device(fake(False, False)) == "cpu"  # type: ignore[arg-type]


def _weights_cached() -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache  # noqa: PLC0415 - optional ml extra
    except ImportError:
        return False
    found = try_to_load_from_cache(SIGLIP_REPO, "model.safetensors", revision=SIGLIP_REVISION)
    return isinstance(found, str)


@pytest.mark.model
def test_siglip_scores_a_real_frame():
    if not _weights_cached():
        pytest.skip(f"{SIGLIP_REPO} weights are not in the Hugging Face cache")
    from PIL import Image  # noqa: PLC0415 - optional ml extra

    from dryrun_vision.labels.providers.base import Clip  # noqa: PLC0415
    from dryrun_vision.labels.providers.registry import make_provider  # noqa: PLC0415
    from dryrun_vision.labels.vocab import candidates_of, read_vocab, station_label_set  # noqa: PLC0415

    preview = BREAKFAST / "preview-P23_cam01_P23_coffee.jpg"
    if not preview.is_file():
        pytest.skip("Breakfast data is not fetched (scripts/fetch_data.sh)")
    frame = np.asarray(Image.open(preview).convert("RGB"))
    vocab = read_vocab(VISION / "src" / "dryrun_vision" / "labels" / "vocabularies" / "breakfast.json")
    cands = candidates_of(vocab, station_label_set(vocab, "coffee"))
    provider = make_provider("siglip")
    probs = provider.score(Clip.of([frame, frame]), cands)
    assert len(probs) == len(cands) and abs(sum(probs) - 1) < 1e-6
    assert provider.name == f"siglip:{SIGLIP_REPO}"
