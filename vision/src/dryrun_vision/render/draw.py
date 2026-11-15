"""What to draw on one frame: a box and a caption per detection (pure; OpenCV only draws)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from dryrun_vision.formats import ActionSegment, Detection

PALETTE_BGR: tuple[tuple[int, int, int], ...] = (
    (60, 180, 75),
    (200, 130, 0),
    (48, 130, 245),
    (180, 30, 145),
    (240, 240, 70),
    (230, 50, 240),
    (60, 60, 230),
    (128, 128, 0),
    (0, 128, 128),
    (195, 255, 170),
)
"""Colours for tracks that are not a worker (cycled by track id). BGR."""
UNASSIGNED_BGR = (160, 160, 160)
"""Grey: a track that identity left out (customer, flicker) when worker names are shown."""
LINE_PX = 2
FONT_SCALE = 0.6
TEXT_PAD_PX = 4
HEX_RGB_LEN = 6


@dataclass(frozen=True)
class BoxLabel:
    x: float
    y: float
    w: float
    h: float
    text: str
    colour: tuple[int, int, int]
    """BGR."""


def hex_to_bgr(colour: str) -> tuple[int, int, int]:
    """ "#e8312f" -> (47, 49, 232)."""
    h = colour.lstrip("#")
    if len(h) != HEX_RGB_LEN:
        raise ValueError(f'"{colour}" is not a colour like #e8312f.')
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return (b, g, r)


def track_colour(track_id: int) -> tuple[int, int, int]:
    return PALETTE_BGR[track_id % len(PALETTE_BGR)]


def _action_text(
    segments: Sequence[ActionSegment], worker: str, t: float, box_names: Mapping[str, str]
) -> str:
    s = next((s for s in segments if s.worker_id == worker and s.t0 <= t < s.t1), None)
    if s is None:
        return ""
    where = f" {box_names.get(s.box_id, s.box_id[:6])}" if s.box_id else ""
    label = f" ({s.label})" if s.label else ""
    return f" {s.kind}{where}{label}"


def frame_labels(
    detections: Sequence[Detection],
    names: Mapping[int, str] | None = None,
    *,
    colours: Mapping[str, tuple[int, int, int]] | None = None,
    actions: Sequence[ActionSegment] = (),
    run_t: float | None = None,
    box_names: Mapping[str, str] | None = None,
) -> tuple[BoxLabel, ...]:
    """Labels for one frame's detections. With `names` (track id -> worker), workers are named and
    coloured and unassigned tracks are grey; with `actions` the worker's action at run_t is added."""
    out: list[BoxLabel] = []
    for d in detections:
        worker = None if names is None else names.get(d.track_id)
        if names is None:
            text, colour = f"#{d.track_id}", track_colour(d.track_id)
        elif worker is None:
            text, colour = f"#{d.track_id} (not a worker)", UNASSIGNED_BGR
        else:
            text = f"{worker} #{d.track_id}"
            if run_t is not None:
                text += _action_text(actions, worker, run_t, box_names or {})
            colour = (colours or {}).get(worker, track_colour(d.track_id))
        out.append(BoxLabel(d.x, d.y, d.w, d.h, text, colour))
    return tuple(out)


def draw_labels(image: np.ndarray, labels: Sequence[BoxLabel], cv2: Any, header: str = "") -> np.ndarray:  # noqa: ANN401
    """A copy of the image with the boxes, captions and a header line drawn on it."""
    out = image.copy()
    for lb in labels:
        p1, p2 = (round(lb.x), round(lb.y)), (round(lb.x + lb.w), round(lb.y + lb.h))
        cv2.rectangle(out, p1, p2, lb.colour, LINE_PX)
        (tw, th), _ = cv2.getTextSize(lb.text, cv2.FONT_HERSHEY_SIMPLEX, FONT_SCALE, 1)
        top = max(th + 2 * TEXT_PAD_PX, p1[1])
        cv2.rectangle(
            out, (p1[0], top - th - 2 * TEXT_PAD_PX), (p1[0] + tw + 2 * TEXT_PAD_PX, top), lb.colour, -1
        )
        cv2.putText(
            out,
            lb.text,
            (p1[0] + TEXT_PAD_PX, top - TEXT_PAD_PX),
            cv2.FONT_HERSHEY_SIMPLEX,
            FONT_SCALE,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )
    if header:
        cv2.putText(
            out, header, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, FONT_SCALE, (255, 255, 255), 2, cv2.LINE_AA
        )
    return out
