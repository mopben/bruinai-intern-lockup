"""Which torch device to run on: Apple GPU (MPS) when there is one, else CUDA, else the CPU."""

from __future__ import annotations

from dryrun_vision.detect.base import DetectorError

DEVICES = ("auto", "mps", "cuda", "cpu")


def _available() -> tuple[bool, bool]:
    try:
        import torch  # noqa: PLC0415 - ml extra, imported only when used
    except ImportError as exc:
        raise DetectorError("The detector needs torch from the ml extra: uv sync --extra ml") from exc
    return bool(torch.backends.mps.is_available()), bool(torch.cuda.is_available())


def resolve_device(
    requested: str, mps_available: bool | None = None, cuda_available: bool | None = None
) -> str:
    """ "auto" picks mps, then cuda, then cpu. A device asked for by name must exist."""
    if requested not in DEVICES:
        raise DetectorError(f'"{requested}" is not a device. Use one of: {", ".join(DEVICES)}.')
    if mps_available is None or cuda_available is None:
        mps_available, cuda_available = _available()
    if requested == "auto":
        return "mps" if mps_available else "cuda" if cuda_available else "cpu"
    if requested == "mps" and not mps_available:
        raise DetectorError("MPS is not available on this machine. Use --device cpu.")
    if requested == "cuda" and not cuda_available:
        raise DetectorError("CUDA is not available on this machine. Use --device cpu.")
    return requested
