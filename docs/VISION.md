# Video pipeline: positions and actions from a filmed run, without hats

The camera page (CAMERA.md) finds each worker by the colour of their hat. The video pipeline in `vision/` does the same job from a filmed video without hats: a person detector finds everyone in each frame, a tracker follows them, and the pipeline works out which track is which worker from where they stand. It writes the same `positions.jsonl` the stage already loads, plus an `actions.jsonl` that says what each worker was doing (FORMATS.md).

**Read this first.** It has never been run on a real café video with a scan and a calibration of the same kitchen. Its parts were tested on public datasets and on synthetic data (see "How it was tested" at the end). It runs on a filmed video after the run, on the laptop, not live during the run.

## What it replaces, and what it does not

- It replaces the **coloured hats**, and the colour sampling, for a filmed run. Workers are named by where they rest: whoever stands at the till most is the till worker of `layout.json`.
- It still needs the **camera calibration** from the camera page (four or more floor points on that video), the **run folder** (scan, setup, layout, and taps or run.json), and a **fixed camera** that does not move during the video.
- It does **not** run live. The stage's live dots still come from the camera page.
- It does **not** replace the taps. Taps say when an order was done; the video says where people were.
- **Model labels are experimental.** The `label` step adds words like "steaming milk" to the work segments. Measured on real home-kitchen clips, the local model (SigLIP) is about as good as always guessing the most common action; Gemini was right about two frames in three. Neither was measured on café footage. Do not show those labels as facts.

## What it does

```
video ──track──> tracks.jsonl ──identity──> one track per worker ──positions──> positions.jsonl (10 Hz)
                                                    │                                  │
                                                    │                          actions (zones)
                                                    │                                  │
                                                    └───────── label (optional) ──> actions.jsonl
```

1. **track**: RF-DETR (medium) finds people in every frame; ByteTrack gives each a track id. About 17 frames per second on an M2 Pro.
2. **identity**: turns each box into a floor point, joins pieces of one person's track that broke (someone walked in front, up to 4 s), drops people who never come inside the working area (customers), and names the rest after the workers in `layout.json` by where they rest.
3. **positions**: one floor point per worker 10 times a second, lightly smoothed. Gaps longer than 0.5 s stay gaps.
4. **actions**: cuts each worker's time into `work`, `fetch`, `carry`, `walk` and `idle` from where they are and where they go (FORMATS.md, "actions.jsonl").
5. **label** (optional): looks at a crop of the worker in a few frames of each 2 s window of a `work` or `idle` segment and picks a word from a short list for that station (`vision/src/dryrun_vision/labels/vocabularies/cafe.json`). Providers: `siglip` (local, the default) or `gemini` (Google's API, online).

## Setup

You need Python 3.12 and [uv](https://docs.astral.sh/uv/). Once, from the repository folder:

```
cd vision && uv sync --extra ml
```

That installs PyTorch, OpenCV and the models' code (a few GB). The first `track` downloads the RF-DETR weights from Roboflow (400 MB; `--weights-dir` says where to keep them) and the first `label` with SigLIP downloads its weights from Hugging Face (the cache is 2.9 GB here); after that it works offline. For Gemini also run `uv sync --extra gemini`.

## A filmed run, step by step

You need four things:

- **The video** of the run from a fixed camera (the mount in CAMERA.md). Note how many seconds of video there are before the run starts (before the first order on the tablet): this is the **start offset**. Say 4.2 s.
- **The run folder** the stage saved for that run (`recordings/<id>/`), with `scan.json`, `setup.json`, `layout.json` and `taps.jsonl`.
- **The calibration of that video**: on the camera page, open the video file, calibrate on it (CAMERA.md, step 3), and press **Export**. It must be made on this video or one of the same size from the same, unmoved camera.
- **Each worker's head height** in that file (see "Head height" below).

Then, from `vision/` (paths are examples):

```
uv run dryrun-vision run ~/Movies/run.mov \
  --calibration ~/Downloads/calibration.json \
  --run ../recordings/rec-20261114-153000 \
  --start-offset 4.2 \
  --out runs/rec-20261114-153000
```

Tracking processes about 17 frames a second on the M2 Pro, so a minute of 30 fps video takes about two minutes (`--stride 2` halves that, at some cost in tracking). It writes `tracks.jsonl`, `positions.jsonl` and `actions.jsonl` into the `--out` folder and prints who it found:

```
Found 3 workers. Wrote to runs/rec-20261114-153000:
  tracks.jsonl
  positions.jsonl: 2527 samples at 10 Hz
  actions.jsonl: 45 zone segments (10 carry, 10 fetch, 2 walk, 23 work), 20 trips
  red: 849 samples, 0.0-88.5 s of video, from track(s) 1
  blue: 828 samples, 0.0-88.5 s of video, from track(s) 2, 3
  yellow: 850 samples, 0.0-88.5 s of video, from track(s) 4
  left out track(s) 91 (55.0 s): never inside the working area
```

(This output is from the synthetic test below, not from a real video.) Read the warnings it prints on the way: a worker "not found", "share station", gaps, or points outside the room all mean something to check.

To add model labels, add `--label` (and `--provider gemini` for Gemini). The file's header then says `"source":"zones+model"`.

**Put the results in the run folder and check it.** Copy the two files over the ones the stage saved, keeping a copy of the originals, and run the validator from the repository folder:

```
cp ../recordings/rec-20261114-153000/positions.jsonl ../recordings/rec-20261114-153000/positions-camera.jsonl
cp runs/rec-20261114-153000/positions.jsonl runs/rec-20261114-153000/actions.jsonl ../recordings/rec-20261114-153000/
cd .. && npx tsx tools/world/validate.ts recordings/rec-20261114-153000
```

It must say `OK`. Then load the run on the stage as usual.

**The start offset is one number for everything.** `run`, `positions`, `label` and `render` all take `--start-offset` and use it the same way: run time = video time − offset. Give each command the same value.

**The steps one at a time** (same flags): `track` (video to `tracks.jsonl`), `positions` (`tracks.jsonl` to `positions.jsonl`), `actions` (a run folder with `positions.jsonl` to `actions.jsonl`), `label` (adds labels to an `actions.jsonl`; with `--tracks` and `--calibration` it finds the workers exactly as `positions` does). `run --tracks runs/.../tracks.jsonl` reuses an earlier tracking, which saves the slow step when you only change the calibration or the offset.

## Checking it by eye

```
uv run dryrun-vision render ~/Movies/run.mov \
  --tracks runs/rec-20261114-153000/tracks.jsonl \
  --calibration ~/Downloads/calibration.json --run ../recordings/rec-20261114-153000 \
  --actions runs/rec-20261114-153000/actions.jsonl --start-offset 4.2 \
  --out runs/rec-20261114-153000/check.mp4
```

Open `check.mp4`. Each box is named after the worker it was given to, in their colour, with the track number and the current action (and the model label in brackets, if there is one). Grey boxes are people left out (customers). Look for:

- **A name that jumps** from one person to another: identity took the wrong track. Usually two workers swapped places, or a customer stood in the working area for a long time.
- **A box that drops out** for long stretches: the detector does not see that person there (a counter or a machine hides too much of them).
- **A box much taller than the person**, for example over a raised arm: the floor point under it is wrong for those frames.

Without `--calibration` and `--run` it shows only the tracker's numbers, which is the first thing to check on a new camera position.

## The calibration, and head height

The pipeline reuses the camera page's calibration file as it is: the floor points and box-top points give the camera model, and `imageSize` must match the video.

**Head height.** The camera page's `hatHeights` is the height of each worker's hat: the **Measure** button gives the middle of the hat. This pipeline puts the **top of the head** (the top edge of the person's box) at that height. The top of a cap or a head is a few centimetres higher than the middle of a hat, and with the camera about 2.8 m up each centimetre of height error moves the dot about 3 to 4 cm on the floor. So for this pipeline either type each worker's standing height into the camera page (floor to the top of the head, in metres), or add about 3 cm to a measured hat height. Workers without an entry are taken as 1.70 m.

The floor point is under the top-centre of the box, at that height ("head anchor", the default). With `--anchor foot` it is the bottom-centre of the box on the floor, which needs no height but needs the feet in view; behind a counter they usually are not.

## Labels with Gemini

```
export GEMINI_API_KEY=...        # in your shell; never in a file in the repository
uv run dryrun-vision label ...  --provider gemini
```

- **Privacy.** Every labelled window sends four crops of one worker to Google. The café and the staff must agree to that first. SigLIP runs on the laptop and sends nothing.
- **Cost and limits.** The pipeline makes one request per 2 s window of a `work` or `idle` segment: about 90 for a 90 s run with three workers. It stops after `--gemini-max-calls` requests (default 1000), retries rate limits and server errors up to 5 times with a growing wait, and sends at most 4 at once. A window that still fails is left without a label and the run carries on (it says how many at the end). It prints the requests and tokens used.
- **Model.** `--gemini-model` (default `gemini-3.8-flash`, the model it was measured with).

**What was measured** (2026-11-14, `gemini-3.8-flash`, the same Breakfast clips, windows and development/held-out split as SigLIP; table at the end). With the 4–6 labels of each activity Gemini labelled 68.6 % of held-out frames right, against 27.1 % for SigLIP and 26.9 % for always guessing the most common action, and found 40 of 52 action segments (SigLIP: 4). It cost 633 requests for 633 windows (no retries, no failures), about 5,300 tokens per window (4,440 in, 130 out, 740 of the model's own "thinking"), 3.36 million tokens in all, and took 30 minutes with 4 requests in flight: about 11 s per request. For a 90 s run with three workers that is roughly 90 requests and 5 minutes. The price per token of this model was not looked up; check it on Google's pricing page before a long run. It has not been tried on café footage.

## How it was tested (and what was not)

There was no real café video with a scan and a calibration. Each part was tested on the best data there was. Where a number comes from synthetic data, it says so.

**Tracking and floor position on a real video: PETS09-S2L1** (MOTChallenge 3D MOT 2015: an outdoor campus, one fixed camera 7 m up, 19 people over 795 frames, with hand-drawn boxes and floor positions as ground truth). `uv run dryrun-vision eval-tracking runs/pets/tracks.jsonl --gt data/mot15-3d/PETS09-S2L1/gt/gt.txt --tsai data/mot15-3d/PETS09-S2L1/maps/View_001.txt`, from `vision/`:

- Detection at IoU 0.5: precision 0.907, recall 0.957. MOTA 0.857, IDF1 0.828, 11 id switches, 28 track ids for 19 people. About 17 frames per second on the M2 Pro (17.7 and 16.2 in two runs).
- Floor error against the ground truth: foot anchor median 0.20 m (p90 0.40 m); head anchor at an assumed 1.70 m median 0.30 m (p90 0.83 m). The ground truth comes from hand-drawn box bottoms, and one pixel of box edge is worth about 7 cm in that scene, so this mostly measures how two people's boxes disagree, not the camera model.
- The lean correction (the box's top-centre is not straight above the feet when a person is seen from the side) is used for the head anchor only. Its benefit is shown on synthetic boxes. On PETS09 it moved the head anchor's median from 0.309 to 0.303 m and made the foot anchor worse (0.198 to 0.209 m), so the foot anchor does without it.
- Joining broken tracks with the default 4 s gap gave 20 identities for 19 people and lowered IDF1 to 0.782 in this crowd; a 1 or 2 s gap gives 0.891. The default was not changed after seeing this. (An earlier count said 0.774: the IDF1 calculation had a bug, fixed on 2026-11-14; raw IDF1 did not move.)

**Identity, positions and actions: synthetic tracks** (`vision/tests/test_synthetic_end_to_end.py`, `vision/tests/synthetic_sweep.py`). Person boxes drawn from the bundled runs' own positions with the exact calibration, then corrupted: 2 px of jitter on every box edge, 5 % of boxes lost, six 0.6 s occlusions per worker, one worker's track id changing after a 1.5 s gap, and two customers just outside the room. No detector is involved, so this tests everything after the detector. On `counter-a` and `counter-c-fourth-worker`, 5 random draws each:

- Every worker found with the right name; the broken track joined; both customers left out.
- Floor error per worker: mean 1.9–2.0 cm, worst single sample 6.3–7.7 cm (synthetic).
- All 20 fetch and carry trips found, both ends within 0.71 s; the zone action agrees with the one made from the true positions in 91–96 % of 0.1 s steps (synthetic).
- Heavier corruption (`synthetic_sweep.py --sweep`): with 5 px jitter, 15 % lost and 12 occlusions the mean floor error is about 3.5 cm (worst 19 cm) and all trips are still found; with 10 px, 30 % and 20 occlusions about 7 cm (worst 46 cm), agreement drops to 54–60 % and 1 of 20 trips is missed in 2 of 10 draws; with 15 px, 50 % and 30 occlusions about 11 cm, agreement 19–37 %, and up to 5 trips missed. Names stayed right at every level.

**Zone actions against the taps** (`uv run dryrun-vision eval-actions ../fixtures/<run>`, the bundled runs' own positions):

| Run | Done taps inside a `work` segment | ending within 2 s of one | no `work` segment | Fridge fetches found |
| --- | --- | --- | --- | --- |
| counter-a | 23 of 30 | 7 | 0 | 10 of 10 |
| counter-b-fridge-closer | 23 of 30 | 7 | 0 | 0 of 10 |
| counter-c-fourth-worker | 21 of 30 | 7 | 2 | 10 of 10 |

Two limits show here and are built into the method, not bugs to fix with a threshold:

- **A worker who never leaves their station gets one long `work` segment.** In counter-a the till worker is `work` for 100 % of the run and 10 of the 30 taps share one segment. Positions cannot tell waiting from working.
- **A fetch shorter than the 0.5 m trip threshold shows as `walk`.** In counter-b the fridge is 0.43 m from the espresso stand point, so none of its 10 fetches is found; the worker shows 45 % `walk`.

**Labels: Breakfast Actions** (26 real clips of people making coffee, milk and tea in home kitchens, 15 fps, split by person into a development half and a held-out half; everything tuned on the development half only). `uv run dryrun-vision eval-labels`; the full numbers are in `vision/runs/eval-labels/`. Frame accuracy on the held-out half, labels smoothed over 3 windows:

| Provider | Labels offered | Crop | Held-out accuracy | Always the most common | Segments found (of 52) | Development accuracy |
| --- | --- | --- | --- | --- | --- | --- |
| SigLIP 2 (local) | the 4–6 of the clip's activity | whole frame | 27.1 % | 26.9 % | 4 | 38.2 % (majority 38.2 %) |
| SigLIP 2 (local) | the 4–6 of the clip's activity | centre | 36.1 % | 26.9 % | 9 | 36.2 % |
| SigLIP 2 (local) | all 11 | whole frame | 21.9 % | 15.0 % | 3 | 31.4 % (majority 31.3 %) |
| SigLIP 2 (local) | all 11 | centre | 24.4 % | 15.0 % | 7 | 28.8 % |
| Gemini (`gemini-3.8-flash`) | the 4–6 of the clip's activity | whole frame | **68.6 %** | 26.9 % | 40 | 65.4 % (majority 38.2 %) |
| Gemini (`gemini-3.8-flash`) | all 11 | whole frame | **54.5 %** | 15.0 % | 28 | 60.7 % (majority 31.3 %) |

Chance is about 21 % with the activity's labels and 9 % with all 11. The Gemini centre-crop runs were not made (each run is 633 requests and 30–38 minutes). A segment counts as found when it overlaps a true segment of the same label by at least half.

With the confidence threshold tuned on the development half, SigLIP (threshold 0.8, the top of the search grid) labels only 25 % of held-out frames, and 42 % of those correctly. Gemini (its own tuned threshold, 0.6) labels 55 % of held-out frames, 82 % of them correctly; with all 11 labels (0.5) 75 % at 60 %. Gemini's errors are not random: "spoon sugar" was never recognised (it was called "add teabag" or "nothing happening"), and "spoon powder" only a third of the time. The full confusion tables are in the JSON files.

**Conclusion: local zero-shot labelling is not good enough to trust for fine actions.** SigLIP 2 is about at the "always guess the most common action" baseline. Gemini did much better on the same clips, with nothing tuned on the held-out half: 68.6 % with each activity's labels and 54.5 % with all 11, against baselines of 26.9 % and 15.0 %. That is evidence that a large online model can tell these fine actions apart in home kitchens. It is not evidence about a café counter seen from 2.8 m up, and it still mislabels a third of the frames. Treat labels as experimental until they are measured on real café footage, with Gemini or with a model fine-tuned on café video.

**Stock café clips, by eye** (4 clips of 5–10 s from Mixkit, `vision/data/stock-cafe/`, rendered to `vision/runs/cafe/`). Staff were found and kept the same id in the three simple clips. In the crowded kitchen clip the tracker gave 12 ids for about 9 people, changed one person's id after an occlusion, put a second box on a hairnet, and a raised arm lifted the top of one box about 120 px above the head. These clips have no kitchen or calibration, so only tracking was looked at.

On 2026-11-14 `track` and `render` were run again on the barista clip (4296, 9.5 s, 1280x720): 2 people, 2 ids, 284 boxes each, nothing missed by eye (`vision/runs/cafe-2026-11-14/`). `label` was run on it with stand-in inputs: the bundled `counter-a` folder for the kitchen, a hand-made `actions.jsonl` with one 9.4 s `idle` segment per person, and `--track-worker` to name the two tracks. By eye the man is talking to someone and the woman is drying glasses with a cloth (`cleaning`). SigLIP said `waiting` for both. Gemini (10 requests, 53,000 tokens, 27 s) said `waiting` and then `talking` for both: right for the man after 4 s, wrong for the woman. Two people for 9 s is an anecdote, not a measurement; it is here so you can see what the output looks like (`barista-4296.siglip-actions.jsonl`, `barista-4296.gemini-actions.jsonl`). This clip also pans slightly, which a real setup must not.

**End to end, automated** (`vision/tests/test_vision_end_to_end.py`): synthetic tracks of `counter-a` through `run --label` with a fake label provider on a small generated video, then the product's own validator on a folder of the bundled run's scan, setup, layout and taps with the new `positions.jsonl` and `actions.jsonl`. It prints `OK: ... can be loaded (10 orders, 88.6 s, 3 workers tracked, 2527 position samples, 52 action segments)`. Everything in that chain is real code; the boxes, the video and the label model are stand-ins.

**Never verified:** any real café run end to end (video, scan and calibration of one kitchen); a high camera tilted down indoors; counters hiding the lower body with the head anchor; workers sharing a station (told apart only by the order they are listed in `layout.json`); customers leaning over the counter into the working area; variable-frame-rate phone video (frame times are assumed evenly spaced); labels on café footage with either provider.

## Known issues

- **Workers sharing a station** are told apart only by the order they are listed in; a worker who **covers** other stations is found by the home station only, and trips that start at a covered station show as `walk` (the pipeline warns).
- **Task graphs** (`tasks` in `setup.json`) are read and change which station a step carries to, as on the stage. `capacity` is read and not used.
- **The stage's reader is looser than FORMATS.md** for `actions.jsonl`: a `walk` or `idle` line with a `boxId` has it silently dropped, and a `label` without `confidence` is accepted. Files from this pipeline never have either.
- Unknown fields in the product files are warned about and ignored, as the stage's validator does; `tracks.jsonl`, the calibration and the vocabularies are strict.
