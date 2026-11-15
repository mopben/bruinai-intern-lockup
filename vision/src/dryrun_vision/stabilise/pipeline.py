"""Stabilise a video in two passes: register every frame to the reference, judge, then warp and write.

Judging before writing means a poorly registered video is refused before any garbage is written.
The report (if asked for) is written either way, so the reasons can be read.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from dryrun_vision.formats import (
    CropRect,
    FrameRegistration,
    StabilisationRegion,
    StabilisationReport,
    VideoInfo,
    write_stabilisation,
)
from dryrun_vision.stabilise.errors import StabiliseError
from dryrun_vision.stabilise.quality import MAX_POOR_SHARE, MIN_INLIERS
from dryrun_vision.stabilise.region import region_mask
from dryrun_vision.stabilise.register import (
    Features,
    PersonBox,
    Registration,
    find_features,
    person_mask,
    register,
)
from dryrun_vision.stabilise.rows import frame_rows, homography_of, thresholds
from dryrun_vision.stabilise.summary import poor_frames_text, summarise
from dryrun_vision.stabilise.viewer import viewer_crop
from dryrun_vision.video import probe_video, read_frames
from dryrun_vision.video.reader import ImageArray, cv2_module
from dryrun_vision.video.writer import open_writer

METHOD = "SIFT features, ratio test, RANSAC homography from each frame straight to the reference frame"
REGION_METHOD = f"{METHOD}, fitted on reference features inside the region only"
BoxesByFrame = Mapping[int, Sequence[PersonBox]]


@dataclass(frozen=True)
class StabiliseResult:
    report: StabilisationReport
    warnings: tuple[str, ...]
    codec: str


@dataclass(frozen=True)
class _Inputs:
    video: Path
    info: VideoInfo
    reference: int
    boxes: BoxesByFrame
    region: StabilisationRegion | None


def _gray(image: ImageArray) -> ImageArray:
    cv2 = cv2_module()
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _people(gray: ImageArray, boxes: Sequence[PersonBox]) -> ImageArray | None:
    return person_mask(gray.shape, boxes) if boxes else None


def _check_reference(feats: Features, ins: _Inputs) -> Features:
    usable = len(feats.points) if feats.in_region is None else int(feats.in_region.sum())
    where = "" if ins.region is None else " inside the region"
    if usable < MIN_INLIERS:
        hint = (
            "Draw the region over the furniture and floor in view." if ins.region else "Pick a sharp frame."
        )
        raise StabiliseError(
            f"The reference frame {ins.reference} has too little texture{where} to register against "
            f"({usable} features; need {MIN_INLIERS}). {hint}"
        )
    return feats


def _reference_features(ins: _Inputs) -> Features:
    frames = ins.info.frames
    if frames and ins.reference >= frames:
        raise StabiliseError(
            f"{ins.video.name} has {frames} frames (0 to {frames - 1}); "
            f"there is no reference frame {ins.reference}."
        )
    for frame in read_frames(ins.video):
        if frame.index == ins.reference:
            gray = _gray(frame.image)
            region = None if ins.region is None else region_mask(gray.shape, ins.region)
            feats = find_features(gray, _people(gray, ins.boxes.get(ins.reference, ())), region)
            return _check_reference(feats, ins)
    raise StabiliseError(
        f"{ins.video.name} ends before frame {ins.reference}; there is no such reference frame."
    )


def _register_all(ins: _Inputs) -> list[tuple[int, Registration]]:
    ref = _reference_features(ins)
    out: list[tuple[int, Registration]] = []
    for frame in read_frames(ins.video):
        if frame.index == ins.reference:
            n = len(ref.points) if ref.in_region is None else int(ref.in_region.sum())
            reg = Registration(np.eye(3), n, n, 0.0)
        else:
            gray = _gray(frame.image)
            reg = register(find_features(gray, _people(gray, ins.boxes.get(frame.index, ()))), ref)
        out.append((frame.index, reg))
    return out


def _crop(image: ImageArray, crop: CropRect) -> ImageArray:
    return image[crop.y : crop.y + crop.height, crop.x : crop.x + crop.width]


def _warp_and_write(
    ins: _Inputs, rows: Sequence[FrameRegistration], out: Path, viewer: tuple[Path, CropRect] | None
) -> str:
    cv2 = cv2_module()
    size = (ins.info.width, ins.info.height)
    by_index = {r.frame: homography_of(r) for r in rows}
    writer, codec = open_writer(out, ins.info.fps, size)
    small = (
        None
        if viewer is None
        else open_writer(viewer[0], ins.info.fps, (viewer[1].width, viewer[1].height))[0]
    )
    try:
        for frame in read_frames(ins.video):
            warped = cv2.warpPerspective(frame.image, by_index.get(frame.index, np.eye(3)), size)
            writer.write(warped)
            if small is not None and viewer is not None:
                small.write(np.ascontiguousarray(_crop(warped, viewer[1])))
    finally:
        writer.release()
        if small is not None:
            small.release()
    return codec


def _report(ins: _Inputs, rows: tuple[FrameRegistration, ...], crop: CropRect | None) -> StabilisationReport:
    return StabilisationReport(
        video=ins.info, reference_frame=ins.reference,
        method=METHOD if ins.region is None else REGION_METHOD, masked_people=bool(ins.boxes),
        region=None if ins.region is None else ins.region.polygons, viewer_crop=crop,
        thresholds=thresholds(), summary=summarise(rows), frames=rows,
    )  # fmt: skip


def _refuse_if_poor(rows: Sequence[FrameRegistration], reference: int) -> tuple[str, ...]:
    poor = [r for r in rows if not r.ok]
    if len(poor) > MAX_POOR_SHARE * len(rows):
        raise StabiliseError(
            f"{len(poor)} of {len(rows)} frames could not be registered to frame {reference} "
            f"({poor_frames_text(poor)}). Stabilising only works for a camera that stays at one spot "
            "and only turns; film from a tripod or hold the phone still, and keep the room in view."
        )
    return (f"{len(poor)} frame(s) registered poorly; {poor_frames_text(poor)}",) if poor else ()


def stabilise_video(
    video: Path,
    out: Path,
    *,
    reference_frame: int = 0,
    boxes: BoxesByFrame | None = None,
    region: StabilisationRegion | None = None,
    report: Path | None = None,
    viewer_out: Path | None = None,
) -> StabiliseResult:
    """Every frame of `video` warped onto `reference_frame`, written to `out` (.mp4).

    With `region`, only reference features inside it are fitted (lock the floor and worktops; the
    rest of the picture may then wobble with parallax, measured as outside_median_px). With
    `viewer_out`, also writes the video cropped to `viewer_crop` (no swinging black border).
    Raises StabiliseError (after writing `report`) when more than MAX_POOR_SHARE of the frames do
    not register well; fewer poor frames borrow a neighbour's homography and are listed in warnings.
    """
    info = probe_video(video)
    ins = _Inputs(video, info, reference_frame, boxes or {}, region)
    regs = _register_all(ins)
    ins = _Inputs(video, info.model_copy(update={"frames": len(regs)}), reference_frame, boxes or {}, region)
    rows = frame_rows(regs, ins.info)
    crop = None
    if viewer_out is not None:
        good = [homography_of(r) for r in rows if r.ok] or [np.eye(3)]
        crop = viewer_crop(good, ins.info.width, ins.info.height)
    result = _report(ins, rows, crop)
    if report is not None:
        write_stabilisation(report, result)
    warnings = _refuse_if_poor(rows, reference_frame)
    viewer = None if viewer_out is None or crop is None else (viewer_out, crop)
    return StabiliseResult(result, warnings, _warp_and_write(ins, rows, out, viewer))
