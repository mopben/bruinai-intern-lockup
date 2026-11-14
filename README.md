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

Stage page options, as URL parameters: `?run=<id>` (base run, default `counter-a`), `mode=replay|live` (`live` puts all three inputs on live), `speed=` (0.25 to 64), `step=1..3` (step to open on), `view=compare|run|test` (within step 3). Example: http://localhost:5179/?mode=live

Another port: `PORT=5180 npm start`. Do not open a browser: `DRYRUN_NO_OPEN=1 npm start`.

## What you see

The stage is laid out like an editor: a dark activity bar on the far left picks one of three steps, a resizable side panel beside it holds the step's controls, and the kitchen fills the rest. Move through the views with → and ←, or jump to a step with 1 to 3; clicking the active step's button (or pressing its number again while on it) toggles the panel.

1. **Build.** The scanned boxes rise into place, then get the owner's names. Click a box to rename it or change its role. The panel also has **Add a scan**, **Add a floor mark**, and the **Inputs** section.
2. **Edit.** Drag the fridge, a station or the pickup, add a worker, or change the number of orders. Walking per order (exact) and time per order (a simulated range) update as you edit. **Profit per hour** follows too, from the prices and costs (key **C** opens the **Prices and costs** section in the Edit panel: menu prices and ingredients, wage per worker, electricity, rent, orders in a busy hour; kept in this browser, and **Export** / **Import** move them as a `prices-and-costs.json` file). **Suggest changes** (key **A**) tries a worker more or less at each station and moving every unlocked box, and lists what pays, best first; **Try** puts one on the board. Lock a box in Build to keep it in place.
3. **Run.** Switch between **Before vs after** (simulated side by side), **Original run**, and **After the change** (the real test against a frozen prediction). A changed order count affects simulation only; the real test keeps its own schedule.

All keys are in the runbook. **Shift+F** for full screen.

## The three inputs

Each input can be live or recorded, switched in the Inputs section of the Build panel (step **1**) at any time. The rest of the app does not care which.

| Input | Live | Recorded | Format and how-to |
| --- | --- | --- | --- |
| Scan (the room as boxes) | iPhone app with RoomPlan sends to `http://<laptop>:5179/api/scan`; or drop a `scan.json` on the stage | `scan.json` in a run folder | [docs/FORMATS.md](docs/FORMATS.md), [ios/README.md](ios/README.md) |
| Taps (orders and "done") | Tablet page `http://<laptop>:5179/tablet` | `taps.jsonl` | [docs/FORMATS.md](docs/FORMATS.md) |
| Positions (where each worker was) | Camera page `http://localhost:5179/camera` on the laptop, with the filming phone as webcam | `positions.jsonl` | [docs/FORMATS.md](docs/FORMATS.md), [docs/CAMERA.md](docs/CAMERA.md) |

The laptop's network addresses are printed by `npm start` and listed in Inputs, in the Build panel.

## Record a real run and load it

1. Open the stage live (`?mode=live`), send the scan, and run with the tablet and camera (see the runbook).
2. When a live run ends, the stage saves it to **`recordings/<id>/`** (id like `rec-20261114-153000`) in the same six-file format as `fixtures/`. The screen says "Saved on this laptop in recordings/…". If saving fails, press **S**. Each phone scan is also kept in `recordings/scans/`.
3. Check the folder:
   ```
   npx tsx tools/world/validate.ts recordings/rec-20261114-153000
   ```
   It prints `OK` or a list of problems with file and line. Fix by hand as in FORMATS.md.
4. Load it. Open Build (**1**), then under **Runs** in the Inputs section pick it as **First run (base)**. Or open `http://localhost:5179/?run=rec-20261114-153000`.
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
| `npm run check` | Typecheck, unit tests and the acceptance test, in that order |
| `npm run fixtures` | Rebuild the three bundled runs in `fixtures/` from the world generator |
| `npm run build` | Build only (into `dist/`) |
| `npm run serve` | Serve only, without building |
| `npx tsx tools/world/validate.ts <folder>...` | Check run folders |

## Repository map

| Folder | What is in it |
| --- | --- |
| `src/core/` | The numbers: walking paths, run reconstruction, calibration, simulation, trust check, prediction. No screen, no network. |
| `src/inputs/` | The three inputs, live and replayed, behind one interface; file parsing and checks |
| `src/stage/` | The big-screen app: the 3D toy kitchen and the three steps |
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
| Core numbers (`src/core`) | 85 unit tests, with known answers (distances, ticket timing, calibration, simulation, trust, prediction), plus a coverage check on 40 freshly generated rooms (`npx tsx tools/coverage/coverage.ts 40`) | Pass. On `counter-a`: model error about 8% on 5 held-out orders; walking 6.2 m per order; time per order 19–23 s. On 40 fresh rooms the stated range held the real result 39 times for the fridge move and 24 times for the fourth worker | Any real run. The fourth-worker prediction is too slow by about 1.1 s on average. The two bundled second runs now fall inside their ranges, but they were looked at while the model was being fixed, so they are not evidence |
| Fixtures (`tools/world`, `fixtures/`) | 36 unit tests; the validator on all three folders | All three load: 10 orders each; 88.6 s, 70.9 s, 75.2 s long | They are generated, not recorded (`source: "synthetic"`) |
| Stage app (`src/stage`) | Unit tests and the three steps driven in Chrome on the laptop in replay and live mode | Build, Edit and Run & results; keys M, W, Backspace, E, F, I; a mouse drag of the fridge; failover to recorded positions after 4 s and recorded taps after 5 s with no tablet; a live run saved to `recordings/` | A real projector; touch dragging; a run from a real scan |
| Tablet (`src/tablet`) | 6 unit tests; the page in a second browser tab on the laptop | Orders appear when the run starts; a tap is accepted and the ticket moves on | A real tablet over Wi-Fi |
| Server and inputs (`server/`, `src/inputs`) | 16 + 64 unit tests; scans POSTed with `curl` | Scan accepted, saved in `recordings/scans/`, shown on the stage | Phone and tablet over real Wi-Fi |
| Scan app (`ios/`) | 27 unit tests in the iPhone 18 Pro simulator (see below); builder's simulator run and unsigned device build | Builder: summary screen, POST to a local listener, error messages | **RoomPlan capture on a LiDAR iPhone has never run.** Which side RoomPlan calls an object's front is unknown |
| Camera tracker (`src/camera`, `tools/camera`) | 58 + 6 unit tests; a computer-generated video of `counter-a` through the real page | Dots on average 3 cm from the truth, worst 14 cm; hats found in 94–100% of frames | A real phone camera, real hats, real light, Continuity Camera delay |

Unit tests: `npx vitest run` gave **350 passed in 42 files** (Nov 14, 2026). Acceptance: `npm run acceptance` gave **27 passed**, three runs in a row, about 2.3 minutes each, with every non-local request blocked. Scan app: `xcodebuild test` gave **27 of 27 passed** on the iPhone 18 Pro simulator.
