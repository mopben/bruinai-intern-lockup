import sys
import types
from dataclasses import dataclass, field
from typing import ClassVar

import numpy as np
import pytest

from dryrun_vision.detect import (
    DetectorError,
    PersonBox,
    RFDetrDetector,
    person_boxes,
    resolve_device,
)


def test_person_box_checks_its_corners():
    b = PersonBox(1.0, 2.0, 11.0, 32.0, 0.9)
    assert (b.width, b.height) == (10.0, 30.0)
    with pytest.raises(ValueError, match="right of"):
        PersonBox(5.0, 0.0, 5.0, 10.0, 0.5)
    with pytest.raises(ValueError, match="score"):
        PersonBox(0.0, 0.0, 5.0, 10.0, 1.5)


def test_person_boxes_keeps_only_people_above_the_score():
    xyxy = np.array([[0, 0, 10, 20], [5, 5, 15, 25], [1, 1, 2, 2], [0, 0, 4, 8]], dtype=float)
    names = ["person", "dog", "person", "person"]
    scores = np.array([0.9, 0.95, 0.1, 0.5])
    got = person_boxes(xyxy, names, scores, min_score=0.3)
    assert [b.score for b in got] == [0.9, 0.5]
    assert got[0] == PersonBox(0.0, 0.0, 10.0, 20.0, 0.9)


def test_person_boxes_drops_degenerate_boxes():
    got = person_boxes(np.array([[3, 3, 3, 9]], dtype=float), ["person"], np.array([0.9]), min_score=0.1)
    assert got == ()


@pytest.mark.parametrize(
    ("asked", "mps", "cuda", "want"),
    [
        ("auto", True, False, "mps"),
        ("auto", False, True, "cuda"),
        ("auto", False, False, "cpu"),
        ("cpu", True, True, "cpu"),
        ("mps", True, False, "mps"),
    ],
)
def test_resolve_device(asked: str, mps: bool, cuda: bool, want: str):
    assert resolve_device(asked, mps_available=mps, cuda_available=cuda) == want


def test_resolve_device_refuses_what_is_missing():
    with pytest.raises(DetectorError, match="MPS is not available"):
        resolve_device("mps", mps_available=False, cuda_available=False)
    with pytest.raises(DetectorError, match="not a device"):
        resolve_device("gpu", mps_available=True, cuda_available=False)


@dataclass
class _FakePrediction:
    xyxy: np.ndarray
    confidence: np.ndarray
    class_id: np.ndarray
    data: dict = field(default_factory=dict)


class _FakeModel:
    instances: ClassVar[list["_FakeModel"]] = []

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.seen: list[np.ndarray] = []
        _FakeModel.instances.append(self)

    def predict(self, image: np.ndarray, threshold: float, include_source_image: bool) -> _FakePrediction:
        self.seen.append(image)
        assert include_source_image is False
        return _FakePrediction(
            xyxy=np.array([[0, 0, 10, 30], [2, 2, 8, 8]], dtype=float),
            confidence=np.array([0.8, 0.9]),
            class_id=np.array([1, 3]),
            data={"class_name": np.array(["person", "car"])},
        )


@pytest.fixture
def fake_rfdetr(monkeypatch: pytest.MonkeyPatch) -> type[_FakeModel]:
    mod = types.ModuleType("rfdetr")
    mod.RFDETRMedium = _FakeModel  # type: ignore[attr-defined]
    mod.RFDETRNano = _FakeModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "rfdetr", mod)
    _FakeModel.instances = []
    return _FakeModel


def test_rfdetr_detector_with_a_fake_model(fake_rfdetr: type[_FakeModel], tmp_path):
    det = RFDetrDetector(size="medium", device="cpu", weights_dir=tmp_path)
    assert det.name == "rf-detr-medium"
    model = fake_rfdetr.instances[0]
    assert model.kwargs == {"device": "cpu", "pretrain_weights": str(tmp_path / "rf-detr-medium.pth")}
    bgr = np.zeros((4, 4, 3), dtype=np.uint8)
    bgr[..., 0] = 255  # blue in BGR
    boxes = det.detect(bgr)
    assert boxes == (PersonBox(0.0, 0.0, 10.0, 30.0, 0.8),)
    assert model.seen[0][0, 0].tolist() == [0, 0, 255]  # handed over as RGB


def test_rfdetr_detector_default_weights_place(fake_rfdetr: type[_FakeModel]):
    RFDetrDetector(size="nano", device="cpu")
    assert fake_rfdetr.instances[0].kwargs == {"device": "cpu"}


def test_rfdetr_detector_unknown_size(fake_rfdetr: type[_FakeModel]):
    with pytest.raises(DetectorError, match="not a model size"):
        RFDetrDetector(size="huge", device="cpu")


def test_rfdetr_missing_is_a_plain_error(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setitem(sys.modules, "rfdetr", None)
    with pytest.raises(DetectorError, match="ml extra"):
        RFDetrDetector(size="medium", device="cpu")
