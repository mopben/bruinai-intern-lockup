# Video to actions: demo page

`index.html` shows the vision pipeline on real and synthetic data: tracks over the PETS09-S2L1 video with a floor map, the synthetic `counter-a` run cut into actions, Gemini and SigLIP labels on three held-out Breakfast clips, and the stock café clip 4296. It is one HTML file with inline CSS and JS; it loads `data/*.json` and `media/*` by relative path.

Section 00, "Our kitchen", shows the team's own 2026-11-14 kitchen clip (`runs/kitchen/user-stable.mp4`, its tracks, workers named by hand, `recordings/kitchen-combo-1` actions and the suggested hand corrections with their provenance). It shows real people from the team: keep it local and ask them before uploading it anywhere.

## Rebuild the data and media

`data/` and `media/` are generated and git-ignored. From `vision/`:

```
uv run python demo/build_demo.py
```

It needs the datasets (`scripts/fetch_data.sh`), the saved pipeline outputs in `runs/pets/`, `runs/eval-labels/` and `runs/cafe-2026-11-14/`, the bundled `../fixtures/counter-a`, and `ffmpeg`/`ffprobe` on the PATH. It calls no online service. If an input is missing it says which and stops.

It re-encodes a video only when its source is newer, so a second run takes a few seconds. At the end it checks that every number printed in `index.html` matches its source file and lists them; if you change a source, update the page until it says "All numbers on the page match their sources."

## View it locally

Serve the folder (the page fetches its JSON, so opening the file directly will not work):

```
cd vision/demo && python3 -m http.server 8000
```

and open <http://localhost:8000/>. Python's simple server does not answer range requests, so scrubbing a video may jump back to the start; a real host, or any server with range support, does not have that problem.

## Files

- `build_demo.py`: runs the four builders below, writes `data/*.json`, checks the page's numbers.
- `demo_pets.py`, `demo_kitchen.py`, `demo_breakfast.py`, `demo_cafe.py`: one per section.
- `demo_media.py`: ffmpeg re-encoding (H.264 main, yuv420p, no audio, faststart) and poster frames.
- `demo_common.py`: paths, rounding, errors.
