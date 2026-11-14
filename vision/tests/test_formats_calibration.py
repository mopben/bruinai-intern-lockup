import json
from pathlib import Path

import pytest

from conftest import golden_fixture
from dryrun_vision.errors import FormatError
from dryrun_vision.formats import DEFAULT_ANCHOR_HEIGHT_M, anchor_height, read_calibration


def _write_golden_calibration(tmp_path: Path) -> Path:
    cal = golden_fixture("counter-a")["calibrations"]["boxTops"]["calibration"]
    p = tmp_path / "calibration.json"
    p.write_text(json.dumps(cal, indent=2))
    return p


def test_reads_the_exported_calibration(tmp_path: Path):
    cal = read_calibration(_write_golden_calibration(tmp_path))
    assert cal.image_size.width == 1280
    assert len(cal.pairs) == 9
    assert cal.pairs[0].ref_id
    assert cal.hat_heights["red"] == 1.63


def test_anchor_height_default():
    assert DEFAULT_ANCHOR_HEIGHT_M == 1.70


def test_anchor_height_lookup(tmp_path: Path):
    cal = read_calibration(_write_golden_calibration(tmp_path))
    assert anchor_height(cal, "blue") == 1.7
    assert anchor_height(cal, "nobody") == DEFAULT_ANCHOR_HEIGHT_M


def test_rejects_wrong_format(tmp_path: Path):
    p = tmp_path / "c.json"
    p.write_text('{"format":"other"}')
    with pytest.raises(FormatError, match="format"):
        read_calibration(p)


def test_rejects_implausible_hat_height(tmp_path: Path):
    raw = json.loads(_write_golden_calibration(tmp_path).read_text())
    raw["hatHeights"]["red"] = 3.5
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(raw))
    with pytest.raises(FormatError, match="hatHeights"):
        read_calibration(p)
