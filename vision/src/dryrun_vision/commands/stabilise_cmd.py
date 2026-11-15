"""`dryrun-vision stabilise <video> --out <video>`: warp a handheld video onto one reference frame."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from dryrun_vision.commands.args import non_negative_int, output_file
from dryrun_vision.commands.common import print_warnings
from dryrun_vision.errors import DryRunError, FormatError
from dryrun_vision.formats import StabilisationReport, VideoInfo, read_region, read_tracks


def register(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser(
        "stabilise",
        help="Register every frame of a handheld video to one reference frame and write the steadied video.",
    )
    p.add_argument("video", type=Path, help="the handheld video (.mp4, .mov, ...)")
    p.add_argument("--out", type=output_file, required=True, help="the stabilised .mp4 to write")
    p.add_argument(
        "--reference-frame", type=non_negative_int, default=0,
        help="frame number every other frame is registered to (default 0); calibrate on this frame",
    )  # fmt: skip
    p.add_argument(
        "--report", type=output_file, help="JSON with each frame's homography, inliers and residual"
    )
    p.add_argument("--tracks", type=Path, help="tracks.jsonl of this video: leave people out of the features")
    p.add_argument(
        "--region", type=Path,
        help="JSON of polygons (reference-frame px) to register on, e.g. the floor and worktops; "
        "the rest may then wobble with parallax",
    )  # fmt: skip
    p.add_argument(
        "--viewer-out", type=output_file,
        help="also write a copy cropped to the area every frame fills (no swinging black borders)",
    )  # fmt: skip
    p.set_defaults(func=run)


def _boxes(tracks_path: Path, info: VideoInfo) -> dict:
    from dryrun_vision.stabilise import PersonBox  # noqa: PLC0415 - ml extra, imported only when used

    tracks = read_tracks(tracks_path)
    v = tracks.header.video
    if (v.width, v.height) != (info.width, info.height):
        raise FormatError(
            f"{tracks_path.name} was made on a {v.width}x{v.height} video, but this video is "
            f"{info.width}x{info.height}. Give the tracks of this very video."
        )
    out: dict[int, list] = defaultdict(list)
    for d in tracks.detections:
        out[d.frame].append(PersonBox(d.x, d.y, d.w, d.h))
    return {k: tuple(v) for k, v in out.items()}


def _summary_text(report: StabilisationReport) -> str:
    s = report.summary
    rms = (
        "unknown"
        if s.rms_median_px is None
        else f"median {s.rms_median_px:.2f} px, max {s.rms_max_px:.2f} px"
    )
    where = "" if report.region is None else " inside the region"
    text = (
        f"Registered {s.frames - s.frames_poor} of {s.frames} frames to frame {report.reference_frame}: "
        f"inliers median {s.inliers_median:.0f} (min {s.inliers_min}); residual{where} {rms}; "
        f"camera moved median {s.shift_median_px:.0f} px, max {s.shift_max_px:.0f} px."
    )
    if report.region is not None:
        off = (
            "not measured"
            if s.outside_median_px is None
            else (f"median {s.outside_median_px:.1f} px, 90th percentile {s.outside_p90_px:.1f} px")
        )
        text += f"\nThe picture outside it is off by {off} (parallax: expected)."
    return text


def run(args: argparse.Namespace) -> int:
    from dryrun_vision.stabilise import stabilise_video  # noqa: PLC0415 - ml extra, imported only when used
    from dryrun_vision.video import probe_video  # noqa: PLC0415 - ml extra, imported only when used

    if args.out.resolve() == args.video.resolve():
        raise DryRunError(f"--out {args.out} would overwrite the input video. Give another file name.")
    info = probe_video(args.video)
    boxes = None if args.tracks is None else _boxes(args.tracks, info)
    region = None if args.region is None else read_region(args.region)
    result = stabilise_video(
        args.video, args.out, reference_frame=args.reference_frame, boxes=boxes, region=region,
        report=args.report, viewer_out=args.viewer_out,
    )  # fmt: skip
    print_warnings(result.warnings)
    print(_summary_text(result.report))
    print(f"Wrote {args.out} ({result.codec})" + ("" if args.report is None else f" and {args.report}"))
    crop = result.report.viewer_crop
    if args.viewer_out is not None and crop is not None:
        print(
            f"Wrote the viewer copy {args.viewer_out}: {crop.width}x{crop.height}, the window at "
            f"x={crop.x}, y={crop.y} of the stabilised picture (not for calibration or tracking)."
        )
    return 0
