"""RF-DETR (Roboflow, Apache-2.0) with its pretrained COCO weights, people only.

The weights download from Roboflow's own server on first use (the rfdetr package does
this and checks the MD5). By default they go to rfdetr's cache (~/.roboflow/models, or
$RF_HOME); `weights_dir` puts them elsewhere.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from dryrun_vision.detect.base import DetectorError, ImageArray, PersonBox

RFDETR_SIZES: dict[str, str] = {
    "nano": "RFDETRNano",
    "small": "RFDETRSmall",
    "medium": "RFDETRMedium",
    "large": "RFDETRLarge",
}
"""Model size -> rfdetr class. All four have Apache-2.0 COCO weights."""
DEFAULT_SIZE = "medium"
"""Medium: about 50 ms a frame on an M2 Pro (MPS) and a good recall on small, far people."""
WEIGHT_FILES: dict[str, str] = {
    "nano": "rf-detr-nano.pth",
    "small": "rf-detr-small.pth",
    "medium": "rf-detr-medium.pth",
    "large": "rf-detr-large-2026.pth",
}
"""The file names rfdetr downloads each size to (rfdetr.config)."""
DEFAULT_MIN_SCORE = 0.2
"""Boxes below this score are dropped. Low on purpose: ByteTrack uses weak boxes (0.2..0.5) to keep
a track alive through partial occlusion; only boxes above its own higher threshold start tracks."""
PERSON = "person"
COCO_PERSON_ID = 1
"""Raw COCO category id of a person; used when the model gives no class names."""


def person_boxes(
    xyxy: npt.NDArray[np.float64],
    class_names: Sequence[str],
    scores: npt.NDArray[np.float64],
    min_score: float,
) -> tuple[PersonBox, ...]:
    """The person boxes at or above min_score, in model order. Zero-size boxes are dropped."""
    out: list[PersonBox] = []
    for (x1, y1, x2, y2), name, score in zip(xyxy.tolist(), class_names, scores.tolist(), strict=True):
        if name == PERSON and score >= min_score and x2 > x1 and y2 > y1:
            out.append(PersonBox(float(x1), float(y1), float(x2), float(y2), min(1.0, float(score))))
    return tuple(out)


def _model_class(size: str) -> Any:  # noqa: ANN401 - rfdetr classes are not typed
    if size not in RFDETR_SIZES:
        raise DetectorError(f'"{size}" is not a model size. Use one of: {", ".join(RFDETR_SIZES)}.')
    try:
        import rfdetr  # noqa: PLC0415 - ml extra, imported only when used
    except ImportError as exc:
        raise DetectorError("The detector needs rfdetr from the ml extra: uv sync --extra ml") from exc
    return getattr(rfdetr, RFDETR_SIZES[size])


def _names(pred: Any) -> list[str]:  # noqa: ANN401
    names = (pred.data or {}).get("class_name")
    if names is not None:
        return [str(n) for n in names]
    return [PERSON if int(c) == COCO_PERSON_ID else "other" for c in pred.class_id]


class RFDetrDetector:
    """Detector Protocol over an RF-DETR model. Loading takes a few seconds (and a download once)."""

    def __init__(
        self,
        size: str = DEFAULT_SIZE,
        device: str = "cpu",
        min_score: float = DEFAULT_MIN_SCORE,
        weights_dir: Path | None = None,
    ) -> None:
        cls = _model_class(size)
        kwargs: dict[str, str] = {"device": device}
        if weights_dir is not None:
            kwargs["pretrain_weights"] = str(weights_dir / WEIGHT_FILES[size])
        self._model = cls(**kwargs)
        self._min_score = min_score
        self._name = f"rf-detr-{size}"

    @property
    def name(self) -> str:
        return self._name

    def detect(self, image: ImageArray) -> tuple[PersonBox, ...]:
        rgb = np.ascontiguousarray(image[:, :, ::-1])
        pred = self._model.predict(rgb, threshold=self._min_score, include_source_image=False)
        xyxy = np.asarray(pred.xyxy, dtype=np.float64).reshape(-1, 4)
        scores = np.asarray(pred.confidence, dtype=np.float64).reshape(-1)
        return person_boxes(xyxy, _names(pred), scores, self._min_score)
