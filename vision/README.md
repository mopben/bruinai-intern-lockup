# vision: developer notes

The Python video pipeline: a filmed run to `positions.jsonl` and `actions.jsonl`. How to use it, and what it was tested on, is in [docs/VISION.md](../docs/VISION.md). This page is for working on the code.

## Setup

Python 3.12 and [uv](https://docs.astral.sh/uv/). From this folder:

```
uv sync                    # the base: formats, geometry, identity, positions, actions (numpy, pydantic)
uv sync --extra ml         # + detector, tracker, video, SigLIP labeller (torch, OpenCV, rfdetr, transformers)
uv sync --extra gemini     # + the Gemini label provider (google-genai)
```

The command is `uv run dryrun-vision <command>`; `uv run dryrun-vision --help` lists them.

## Layout

```
src/dryrun_vision/
  cli.py           the command line; each command is a module in commands/
  clock.py         RunClock: run time = video time - start offset (the one place they are converted)
  formats/         every file format (product files shared with the TS app, plus tracks.jsonl)
  geometry/        camera model from the /camera calibration, floor and path geometry
  kitchen/         scan + setup + layout resolved; menu legs; task graphs (port of src/core/tasks.ts)
  video/           reading video: read_frames (every Nth frame, tracker) and VideoFrames (frames at times, labeller)
  detect/ track/   RF-DETR person boxes and ByteTrack ids -> tracks.jsonl
  identity/        tracks -> people: floor points, stitching fragments, assigning workers, dropping customers
  positions/       people -> 10 Hz positions.jsonl
  actions/         positions -> zone segments (work, fetch, carry, walk, idle)
  labels/          zero-shot labels on work/idle segments (providers: siglip, gemini); vocabularies/ ships the label lists
  render/          draws boxes, names and actions on the video, to check by eye
  evaluate/ mot/   eval-actions (vs taps), eval-tracking (vs MOTChallenge ground truth)
tests/             pytest; labelling/ for the labeller; ml/ for opt-in real-model tests
scripts/           fetch_data.sh and data.sha256
data/              downloaded test data (git-ignored; see DATASETS.md)
runs/              outputs of evaluation runs quoted in the docs
```

How worker boxes reach the labeller: `positions/stage.py:identity_stage` (tracks + calibration + kitchen -> `IdentityResult`, the stitched and assigned tracks) -> `labels/worker_boxes.py:worker_boxes_from_identity` (each worker's time-sorted boxes, video time) -> `label_segments`. The windows are in run time; `labels/scoring.py` turns each into video time with the `RunClock` in `FrameSettings`. `run --label` passes the very same `IdentityResult` and `RunClock` it used for `positions.jsonl`. `label --track-worker 3=red` is a manual override that skips identity.

## Tests

```
uv run pytest                    # everything that needs no model weights (about 50 s)
uv run pytest --cov              # with coverage (96 % on 2026-11-14)
uv run ruff check . && uv run ruff format --check .
uv run python tests/synthetic_sweep.py --sweep --extra-seeds   # the synthetic numbers quoted in docs/VISION.md
```

Opt-in tests that need the real models or data:

```
DRYRUN_ML_TESTS=1 uv run pytest tests/ml          # RF-DETR on a real frame (weights in .weights/)
DRYRUN_MODEL_TESTS=1 uv run pytest tests/labelling # SigLIP 2 on Breakfast clips (Hugging Face cache, data/breakfast)
```

`tests/test_vision_end_to_end.py` runs the `run --label` command on synthetic tracks and a generated video and checks the output folder with the TypeScript validator (needs `npx` and the repo's `node_modules`).

Golden files: `tests/golden/golden.json` comes from the TypeScript fixture tools; `tests/golden/tasks.json` was written by running `itemTasks`, `taskIssues` and `workerCovers` from `src/core/tasks.ts` (with `npx tsx`) on the cases in it. Regenerate it the same way if that file changes.

## Data

`scripts/fetch_data.sh` downloads everything into `data/` (about 750 MB transferred, 182 MB kept) and checks the kept files against `scripts/data.sha256`. It is idempotent. What each dataset is and why it was picked: [DATASETS.md](DATASETS.md).

## Licences

| What | Licence | Use |
| --- | --- | --- |
| RF-DETR code and COCO weights (Roboflow) | Apache-2.0 | person detector |
| SigLIP 2 base, patch 16, 224 (`google/siglip2-base-patch16-224`, pinned revision) | Apache-2.0 | local zero-shot labels |
| Gemini API | Google's API terms; frames are sent to Google | optional labels |
| MOTChallenge 3D MOT 2015 (PETS09-S2L1, TUD-Stadtmitte) | CC BY-NC-SA 3.0, **non-commercial** | tracking and floor-error evaluation |
| Breakfast Actions (26-clip subset) | CC BY 4.0 per the Hugging Face mirror; the lab page states none | label evaluation |
| Mixkit stock clips | 3 under the Mixkit Free licence; clip 15875 under the **Restricted** licence (personal use only) | looking at the output by eye |

The non-commercial and personal-use data is used for testing only and is not shipped: `data/` is git-ignored. Details and quotes in DATASETS.md.
