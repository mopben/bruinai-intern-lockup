"""Re-encodes source videos to small H.264 files the browser can play, and pulls poster frames."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from demo_common import MEDIA_OUT, DemoError

DEFAULT_CRF = 24
"""x264 quality for the small clips. The noisy PETS clip needs a higher value (see demo_pets)."""
KEYFRAME_SECONDS = 2
POSTER_QUALITY = 4
MAX_MEDIA_BYTES = 15 * 1000 * 1000


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    frames: int


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise DemoError(
            "ffmpeg is not installed or not on PATH. Install it (brew install ffmpeg) and run again."
        )
    return exe


def _run(cmd: list[str]) -> str:
    done = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        tail = done.stderr.strip().splitlines()[-3:]
        raise DemoError(f"{Path(cmd[0]).name} failed on {cmd[-1]}: {' / '.join(tail)}")
    return done.stdout


def probe(path: Path) -> VideoInfo:
    """Size, rate and decoded frame count of a video (counting frames decodes the file)."""
    exe = shutil.which("ffprobe")
    if exe is None:
        raise DemoError("ffprobe is not installed or not on PATH (it comes with ffmpeg).")
    out = _run([
        exe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", str(path),
    ])  # fmt: skip
    s = json.loads(out)["streams"][0]
    num, den = (int(v) for v in s["r_frame_rate"].split("/"))
    return VideoInfo(int(s["width"]), int(s["height"]), num / den, int(s["nb_read_frames"]))


def _fresh(dst: Path, src: Path) -> bool:
    return dst.is_file() and dst.stat().st_size > 0 and dst.stat().st_mtime >= src.stat().st_mtime


def encode(src: Path, name: str, fps: float, crf: int = DEFAULT_CRF, width: int | None = None) -> Path:
    """media/<name>.mp4: H.264 main profile, yuv420p, no audio, faststart, native rate; native size
    unless `width` is given (height follows, kept even)."""
    MEDIA_OUT.mkdir(parents=True, exist_ok=True)
    dst = MEDIA_OUT / f"{name}.mp4"
    if not _fresh(dst, src):
        gop = str(max(1, round(fps * KEYFRAME_SECONDS)))
        _run([
            _ffmpeg(), "-y", "-v", "error", "-i", str(src), "-an",
            *(["-vf", f"scale={width}:-2"] if width else []), "-c:v", "libx264", "-preset", "slow",
            "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", str(crf), "-g", gop,
            "-fps_mode", "passthrough", "-movflags", "+faststart", str(dst),
        ])  # fmt: skip
    if dst.stat().st_size > MAX_MEDIA_BYTES:
        raise DemoError(f"{dst.name} is {dst.stat().st_size} bytes, over the 15 MB limit; raise CRF.")
    return dst


def poster(video: Path, frame: int, name: str) -> Path:
    """media/<name>.jpg: decoded frame `frame` (0-based) of the encoded video."""
    dst = MEDIA_OUT / f"{name}.jpg"
    if not _fresh(dst, video):
        _run([
            _ffmpeg(), "-y", "-v", "error", "-i", str(video), "-vf", f"select=eq(n\\,{frame})",
            "-frames:v", "1", "-q:v", str(POSTER_QUALITY), str(dst),
        ])  # fmt: skip
    return dst
