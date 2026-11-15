"""A generated handheld clip: a textured still scene seen through a known camera shake.

Frame k is the reference picture seen through H_k: frame_k(p) = reference(H_k p), so H_k maps
frame-k pixels to reference pixels, which is exactly what `stabilise` must recover. Frame 0 has
H_0 = identity and is the reference. The scene is drawn larger than the frame (MARGIN_PX on each
side) so a shaken frame has no black border of its own.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

WIDTH, HEIGHT = 320, 240
MARGIN_PX = 48
"""Scene drawn this much beyond each edge, more than the largest shake below."""
SHAPES = 260
SEED = 7


def scene() -> np.ndarray:
    """A still, richly textured BGR picture (random rectangles and circles), (H + 2M) x (W + 2M)."""
    import cv2  # noqa: PLC0415 - only the cv2 tests import this module

    rng = np.random.default_rng(SEED)
    h, w = HEIGHT + 2 * MARGIN_PX, WIDTH + 2 * MARGIN_PX
    img = np.full((h, w, 3), 128, dtype=np.uint8)
    for _ in range(SHAPES):
        colour = tuple(int(c) for c in rng.integers(0, 256, 3))
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        if rng.random() < 0.5:
            cv2.rectangle(
                img, (x, y), (x + int(rng.integers(6, 40)), y + int(rng.integers(6, 40))), colour, -1
            )
        else:
            cv2.circle(img, (x, y), int(rng.integers(3, 18)), colour, -1)
    return img


def shake(k: int) -> np.ndarray:
    """H_k (frame k pixels -> reference pixels): a few px of drift, up to 1.5 degrees of roll,
    up to 2 % zoom and a slight tilt. Identity for k = 0."""
    if k == 0:
        return np.eye(3)
    a = math.radians(1.5 * math.sin(0.7 * k))
    s = 1.0 + 0.02 * math.sin(0.4 * k)
    tx, ty = 14.0 * math.sin(0.9 * k), 9.0 * math.cos(0.5 * k) - 9.0
    cx, cy = WIDTH / 2, HEIGHT / 2
    centre = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]], dtype=np.float64)
    turn = np.array(
        [[s * math.cos(a), -s * math.sin(a), 0], [s * math.sin(a), s * math.cos(a), 0], [0, 0, 1]]
    )
    tilt = np.array([[1, 0, 0], [0, 1, 0], [2e-5 * math.sin(k), 1.5e-5 * math.cos(k), 1]])
    back = np.array([[1, 0, cx + tx], [0, 1, cy + ty], [0, 0, 1]], dtype=np.float64)
    return back @ tilt @ turn @ centre


def frame(big: np.ndarray, h_k: np.ndarray) -> np.ndarray:
    """The frame whose pixel p shows reference pixel H_k p."""
    import cv2  # noqa: PLC0415

    to_scene = np.array([[1, 0, MARGIN_PX], [0, 1, MARGIN_PX], [0, 0, 1]], dtype=np.float64) @ h_k
    return cv2.warpPerspective(big, to_scene, (WIDTH, HEIGHT), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR)


def write_shaky_video(
    path: Path, frames: int, fps: float = 10.0, blank: frozenset[int] = frozenset()
) -> Path:
    """`frames` frames of the shaken scene; frames listed in `blank` are flat grey (nothing to match)."""
    import cv2  # noqa: PLC0415

    big = scene()
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), fps, (WIDTH, HEIGHT))
    assert writer.isOpened()
    for k in range(frames):
        img = np.full((HEIGHT, WIDTH, 3), 128, np.uint8) if k in blank else frame(big, shake(k))
        writer.write(img)
    writer.release()
    return path


def grid_error_px(estimated: np.ndarray, truth: np.ndarray, step: int = 20) -> float:
    """Largest distance (px) between where the two homographies send a grid over the frame."""
    xs, ys = np.meshgrid(np.arange(0, WIDTH + 1, step), np.arange(0, HEIGHT + 1, step))
    pts = np.stack([xs.ravel(), ys.ravel(), np.ones(xs.size)])
    a, b = estimated @ pts, truth @ pts
    return float(np.max(np.hypot(a[0] / a[2] - b[0] / b[2], a[1] / a[2] - b[1] / b[2])))


# --- Two depth layers (parallax): a near plane inside FG_RECT moves differently --------------------

FG_RECT = (30, 130, 290, 236)
"""Reference-frame pixels (x0, y0, x1, y1) of the near layer: about a third of the picture."""
FG_SEED = 11
NEAR_SHAPES = 900


def layer_offset(k: int) -> float:
    """Extra horizontal shift (reference px) of the near layer in frame k: parallax of a few px."""
    return 0.0 if k == 0 else 8.0 * math.sin(1.3 * k)


def shake_near(k: int) -> np.ndarray:
    """H for the near layer: the camera shake, then the parallax shift (frame k px -> reference px)."""
    return np.array([[1, 0, layer_offset(k)], [0, 1, 0], [0, 0, 1]], dtype=np.float64) @ shake(k)


def _near_scene() -> np.ndarray:
    import cv2  # noqa: PLC0415

    rng = np.random.default_rng(FG_SEED)
    h, w = HEIGHT + 2 * MARGIN_PX, WIDTH + 2 * MARGIN_PX
    img = np.full((h, w, 3), 90, dtype=np.uint8)
    for _ in range(NEAR_SHAPES):
        colour = tuple(int(c) for c in rng.integers(0, 256, 3))
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        size = int(rng.integers(3, 12))
        if rng.random() < 0.5:
            cv2.rectangle(img, (x, y), (x + size, y + 2 * size), colour, -1)
        else:
            cv2.circle(img, (x, y), size, colour, -1)
    return img


def _near_mask() -> np.ndarray:
    h, w = HEIGHT + 2 * MARGIN_PX, WIDTH + 2 * MARGIN_PX
    mask = np.zeros((h, w, 3), dtype=np.uint8)
    x0, y0, x1, y1 = FG_RECT
    mask[y0 + MARGIN_PX : y1 + MARGIN_PX, x0 + MARGIN_PX : x1 + MARGIN_PX] = 255
    return mask


def write_parallax_video(path: Path, frames: int, fps: float = 10.0) -> Path:
    """Far layer moves by shake(k), the near layer inside FG_RECT by shake_near(k)."""
    import cv2  # noqa: PLC0415

    far, near, mask = scene(), _near_scene(), _near_mask()
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"mp4v"), fps, (WIDTH, HEIGHT))
    assert writer.isOpened()
    for k in range(frames):
        m = frame(mask, shake_near(k)) > 127
        writer.write(np.where(m, frame(near, shake_near(k)), frame(far, shake(k))))
    writer.release()
    return path


def grid_error_in_px(estimated: np.ndarray, truth: np.ndarray, rect: tuple[int, int, int, int]) -> float:
    """grid_error_px restricted to frame points that land inside rect (reference px) under truth."""
    xs, ys = np.meshgrid(np.arange(0, WIDTH + 1, 10), np.arange(0, HEIGHT + 1, 10))
    pts = np.stack([xs.ravel(), ys.ravel(), np.ones(xs.size)])
    a, b = estimated @ pts, truth @ pts
    bx, by = b[0] / b[2], b[1] / b[2]
    x0, y0, x1, y1 = rect
    keep = (bx >= x0) & (bx < x1) & (by >= y0) & (by < y1)
    return float(np.max(np.hypot(a[0][keep] / a[2][keep] - bx[keep], a[1][keep] / a[2][keep] - by[keep])))
