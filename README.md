# Dry Run

Scan your kitchen, change one thing, and watch the rush again.

Dry Run turns a phone scan of a small kitchen into a moving toy model, where staff and orders flow as they did in a real run. You drag a station or add a worker, and the model says at once how far people walk per order and how long an order takes, as a range you can check with a second real run.

## Quick start

```
npm start
```

This one command installs packages (first time only; needs internet), builds the app if anything changed, starts the laptop server on port 5179 and opens the stage at **http://localhost:5179/**. It starts in replay: every input comes from the bundled recordings, with no network. `Ctrl+C` stops it.

You need:

- **Node.js 22.22 or later** (or 24.15+, or 26+). That is the lowest version every package declares. Built and tested on Node 26.7 and npm 11.19; older versions were not tried.
- **A Mac with Xcode** only to build the iPhone scan app (`ios/README.md`). The rest runs in Chrome on any laptop that runs Node.
- To give the demo, read **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

Stage page options, as URL parameters: `?run=<id>` (base run, default `counter-a`), `mode=replay|live` (`live` puts all three inputs on live), `speed=` (0.25 to 64), `step=1..6` (step to open on). Example: http://localhost:5179/?mode=live

Another port: `PORT=5180 npm start`. Do not open a browser: `DRYRUN_NO_OPEN=1 npm start`.

## What you see

The stage has six steps. Move with → and ←, or jump with 1 to 6.

1. **Scan.** The scanned boxes rise into place, then get the owner's names. Click a box to rename it or change its role.
2. **Run.** Dots are people (from the camera); tickets pile up at the slow station (from the tablet taps).
3. **Trust.** The model's order times next to the measured ones, on orders it did not learn from, with the error as one number.
4. **Play.** Drag the fridge, a station or the pickup, or add a worker. Walking per order (exact) and time per order (a range) update during the drag.
5. **Test.** The run after the change, against the prediction frozen when you left Play. A miss is said plainly.
6. **Compare.** Before and after, side by side, on the same orders.

All keys are in the runbook. Press **I** for the inputs drawer.

## The three inputs

Each input can be live or recorded, switched in the inputs drawer (**I**) at any time. The rest of the app does not care which.

| Input | Live | Recorded | Format and how-to |
| --- | --- | --- | --- |
| Scan (the room as boxes) | iPhone app with RoomPlan sends to `http://<laptop>:5179/api/scan`; or drop a `scan.json` on the stage | `scan.json` in a run folder | [docs/FORMATS.md](docs/FORMATS.md), [ios/README.md](ios/README.md) |
| Taps (orders and "done") | Tablet page `http://<laptop>:5179/tablet` | `taps.jsonl` | [docs/FORMATS.md](docs/FORMATS.md) |
| Positions (where each worker was) | Camera page `http://localhost:5179/camera` on the laptop, with the filming phone as webcam | `positions.jsonl` | [docs/FORMATS.md](docs/FORMATS.md), [docs/CAMERA.md](docs/CAMERA.md) |

The laptop's network addresses are printed by `npm start` and listed in the inputs drawer.

## Record a real run and load it

1. Open the stage live (`?mode=live`), send the scan, and run with the tablet and camera (see the runbook).
2. When a live run ends, the stage saves it to **`recordings/<id>/`** (id like `rec-20261114-153000`) in the same six-file format as `fixtures/`. The screen says "Saved on this laptop in recordings/…". If saving fails, press **S**. Each phone scan is also kept in `recordings/scans/`.
3. Check the folder:
   ```
   npx tsx tools/world/validate.ts recordings/rec-20261114-153000
   ```
   It prints `OK` or a list of problems with file and line. Fix by hand as in FORMATS.md.
4. Load it. Press **I**, then under **Runs** pick it as **First run (base)**. Or open `http://localhost:5179/?run=rec-20261114-153000`.
5. A **second run (Test)** appears in the list only if its `run.json` has `"baseRunId"` equal to the first run's `id`. A live second run made after a live first run says `"baseRunId": "live run"`; change it to the first run's id by hand.
6. To bundle a run with the product, copy its folder to `fixtures/` (the folder name must match `id` in `run.json`).

A camera run can also be recorded on the camera page (**Record**, then **Stop and save**) or made from a filmed video; see CAMERA.md.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Install if needed, build if needed, serve, open the stage |
| `npm test` | Unit tests (Vitest) |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run typecheck` | TypeScript check, no output files |
| `npm run acceptance` | The acceptance test in a real browser (Playwright). Starts its own servers on ports 5191 and 5192. Needs Playwright's Chromium once: `npx playwright install chromium` (internet) |
| `npm run fixtures` | Rebuild the three bundled runs in `fixtures/` from the world generator |
| `npm run build` | Build only (into `dist/`) |
| `npm run serve` | Serve only, without building |
| `npx tsx tools/world/validate.ts <folder>...` | Check run folders |

## Repository map

| Folder | What is in it |
| --- | --- |
| `src/core/` | The numbers: walking paths, run reconstruction, calibration, simulation, trust check, prediction. No screen, no network. |
| `src/inputs/` | The three inputs, live and replayed, behind one interface; file parsing and checks |
| `src/stage/` | The big-screen app: the 3D toy kitchen and the six steps |
| `src/tablet/` | The tablet page where staff tap "done" |
| `src/camera/` | The hat-colour camera tracker page |
| `server/` | The laptop server: pages, run folders, the phone scan upload, the live relay |
| `tools/world/` | The fixture generator (a separate "real room") and the run-folder validator |
| `tools/camera/` | A synthetic camera video and checks for the tracker |
| `tools/start.mjs` | The one command behind `npm start` |
| `fixtures/` | Three recorded runs: `counter-a` (original), `counter-b-fridge-closer`, `counter-c-fourth-worker` |
| `ios/` | The iPhone scan app (Swift, RoomPlan) |
| `e2e/` | The acceptance test (Playwright) |
| `docs/` | Brief, plan, decisions, formats, camera set-up, runbook, limits |
| `recordings/` | Live runs and phone scans saved on this laptop (not in git) |
| `dist/` | Build output (not in git) |

## Documents

- [docs/RUNBOOK.md](docs/RUNBOOK.md): one page for the stage
- [docs/LIMITS.md](docs/LIMITS.md): what is not verified, what is fragile, what next
- [docs/DECISIONS.md](docs/DECISIONS.md): the decision log
- [docs/PLAN.md](docs/PLAN.md): how the build was planned
- [docs/BRIEF.md](docs/BRIEF.md): the brief (the gold standard)
- [docs/FORMATS.md](docs/FORMATS.md), [docs/CAMERA.md](docs/CAMERA.md), [ios/README.md](ios/README.md)

## What was verified, and how

"Not verified on a real device" means exactly that: nobody has tried it with the real hardware or people.

| Part | Ran on | What was seen | Not verified on a real device |
| --- | --- | --- | --- |
| Core numbers (`src/core`) | 74 unit tests, with known answers (distances, ticket timing, calibration, simulation, trust, prediction) | Pass. On `counter-a`: model error 8% on 5 held-out orders; walking 6.2 m per order; time per order 19–23 s | Any real run. On the two recorded changes the measured mean lands just above the range: 9.9 s against 8.8–9.7 s, and 14.3 s against 12.3–13.3 s |
| Fixtures (`tools/world`, `fixtures/`) | 36 unit tests; the validator on all three folders | All three load: 10 orders each; 88.6 s, 70.9 s, 75.2 s long | They are generated, not recorded (`source: "synthetic"`) |
| Stage app (`src/stage`) | 71 unit tests; the six steps driven in Chrome on the laptop in replay and live mode | All six steps; keys M, W, Backspace, E, F, I; a mouse drag of the fridge (6.2 m to 3.1 m, 19–23 s to 8–10 s); failover to recorded positions after 4 s and recorded taps after 5 s with no tablet; a live run saved to `recordings/` | A real projector; touch dragging; a run from a real scan |
| Tablet (`src/tablet`) | 6 unit tests; the page in a second browser tab on the laptop | Orders appear when the run starts; a tap is accepted and the ticket moves on | A real tablet over Wi-Fi |
| Server and inputs (`server/`, `src/inputs`) | 16 + 64 unit tests; scans POSTed with `curl` | Scan accepted, saved in `recordings/scans/`, shown on the stage | Phone and tablet over real Wi-Fi |
| Scan app (`ios/`) | 27 unit tests in the iPhone 18 Pro simulator (see below); builder's simulator run and unsigned device build | Builder: summary screen, POST to a local listener, error messages | **RoomPlan capture on a LiDAR iPhone has never run.** Which side RoomPlan calls an object's front is unknown |
| Camera tracker (`src/camera`, `tools/camera`) | 58 + 6 unit tests; a computer-generated video of `counter-a` through the real page | Dots on average 3 cm from the truth, worst 14 cm; hats found in 94–100% of frames | A real phone camera, real hats, real light, Continuity Camera delay |

Unit tests: `npx vitest run` gave **331 passed in 37 files** (Nov 14, 2026). Scan app: with the bundled sample now a copy of `fixtures/counter-a/scan.json`, **26 of 27 pass**. The one failure, `testBundledSampleDecodesAndIsTheStagedCounter`, decodes the sample fine but expects the old sample's set of object types, which has no `unknown` (the 2 cm queue floor mark); that expected set needs updating. The acceptance test (`npm run acceptance`) was being finished when this was written; run it to see its current state.
