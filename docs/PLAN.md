# Dry Run: build plan

The brief (`docs/BRIEF.md`) is the gold standard. This plan says how we meet it. Shared types live in `src/core/types.ts`; read that file before writing any code.

## The shape of the product

One TypeScript codebase. Three browser pages and one small Node server.

| Part | Path | What it does |
| --- | --- | --- |
| Core | `src/core/` | Pure functions: geometry, walking distance, run reconstruction, calibration, simulation, trust check, prediction. No DOM, no I/O. |
| Inputs | `src/inputs/` | The three inputs (scan, taps, positions), each as live and as replay, behind one interface. Parsing and validation of the file formats (zod). |
| Stage | `src/stage/` | The big-screen app: the toy-city 3D model, the six demo steps, the numbers. Entry `src/stage/main.tsx` (`/`). |
| Tablet | `src/tablet/` | Orders appear; staff tap "done". Entry `src/tablet/main.tsx` (`/tablet`). |
| Camera | `src/camera/` | Hat-colour tracker. Turns a webcam or video file into floor positions. Entry `src/camera/main.tsx` (`/camera`). |
| Server | `server/` | Serves the built app and fixtures, relays live messages (WebSocket), accepts the phone scan (HTTP POST), saves recordings. Port 5179. |
| World | `tools/world/` | Fixture generator. A separate, more detailed "real room" simulation. Must not import the core simulator. |
| Scan app | `ios/DryRunScan/` | Small iPhone app on RoomPlan. Exports `scan.json` and posts it to the server. |
| Fixtures | `fixtures/<run-id>/` | `run.json`, `scan.json`, `setup.json`, `layout.json`, `taps.jsonl`, `positions.jsonl`. |

`npm start` installs if needed, builds if needed, starts the server and opens the stage in replay mode. The demo itself needs no internet; the tablet and phone reach the laptop over a local network.

## The staged kitchen (fixtures)

A counter area of about 4.5 m by 3.5 m, two walls. Boxes, as a scan would label them, and what the owner renames them to:

| Scan category | Renamed | Role | Locked |
| --- | --- | --- | --- |
| table | Order (till) | station | no |
| storage | Espresso machine ("Make") | station | yes |
| table | Finish | station | no |
| refrigerator | Milk fridge | storage | no |
| table | Pickup | pickup | no |
| sink | Sink | fixture | yes |
| chair or unknown | (scan noise) | ignore | no |
| (none: a floor mark, added as a box) | Queue | queue | no |

One menu item ("Latte"): Order, then Make (fetch from Milk fridge), then Finish, then carried to Pickup. Three workers, one per station, hats red, blue and yellow. About 10 orders, one every 6 s or so. Make is the bottleneck because of the long walk to the fridge; orders pile up there. The whole run finishes inside 90 s.

Three recorded runs:

- `counter-a`: the original layout.
- `counter-b-fridge-closer`: the fridge moved next to Make. Same schedule, different random seed.
- `counter-c-fourth-worker`: original layout, a fourth worker (green hat) at Make. Same schedule, different seed.

## Honesty rules in code

- **The world generator and the model are separate.** `tools/world/` moves people step by step with its own randomness: lognormal work times, per-person walking speed, reaction delay before a tap, position noise, the occasional fumble. The core simulator never sees those parameters. It learns only from `taps.jsonl` and `positions.jsonl`.
- **Walking distance is exact.** Shortest walkable path between stand points around obstacles grown by `BODY_RADIUS_M` (visibility graph, Euclidean). It is a function of the layout alone.
- **Time per order is a range.** The model runs many replications (bootstrap of measured work times, common random numbers so numbers do not flicker during a drag) and reports p10 to p90, with the assumption in words: "people work and walk at the pace we measured; only distances and staffing change."
- **The trust check uses held-out orders.** Calibrate on even-numbered orders, simulate the run with the real release times, compare mean order time on odd-numbered orders. Error is one number (percent).
- **The prediction for the second run is made from run A only**, before run B is loaded.
- **No constants tuned to the fixtures.** Any assumed constant (hand-off reach, stand-off, body radius) is in `types.ts` and stated in the UI where it matters.

## The stage app

Six steps, shown as a strip the operator moves through with the arrow keys or a click: **Scan, Run, Trust, Play, Test, Compare**. Each of the three inputs has a source switch (live or recorded). A failed live input switches to the recorded one mid-step without a reload.

1. **Scan.** Boxes rise into place. Live: waits for the phone. Then the owner renames and sets roles in a side panel (rename, role, lock, hide, split a box in two).
2. **Run.** Dots move from the position log; order tickets stack at each station from the tap log. Replay at 1x, with a faster option.
3. **Trust.** Model order times next to measured, one error number.
4. **Play.** Drag unlocked items, add or remove a worker. Two big numbers update with no visible wait: walking per order (exact) and time per order (range). The prediction for the next run is stated as a range.
5. **Test.** The second run plays (live, or the recorded run that matches the change). Result against prediction: inside the range or not, said plainly.
6. **Compare.** Original and changed layouts run side by side on the same orders.

Look: a small warm toy city. Orthographic three-quarter view, chunky rounded boxes, soft shadows, cream floor, large labels, workers as pawns with coloured hats, orders as little tickets that stack. Readable from the back of a room. Fonts are bundled (`@fontsource-variable/*`), nothing from a CDN.

## Live paths (thin)

- **Scan:** the iPhone app maps `CapturedRoom` to our `Scan` and POSTs it to `http://<laptop>:5179/api/scan`. It can also share the file (AirDrop); the stage accepts a dropped `scan.json`.
- **Taps:** the tablet page talks to the server over WebSocket. The stage is the clock: it releases orders and stamps each tap on receipt.
- **Positions:** the filming phone is the laptop's webcam (Continuity Camera or cable). `/camera` finds each hat colour per frame, maps pixels to the floor with a four-point calibration, and sends samples. The same page accepts a video file, which is how it is tested here.

## Server contract

- Static: `/` stage, `/tablet`, `/camera`, `/fixtures/<run-id>/<file>`.
- `GET /api/info` gives LAN addresses for the tablet and phone. `GET /api/fixtures` lists runs.
- `POST /api/scan` takes a `Scan`, validates it, broadcasts it on channel `scan`.
- `POST /api/recordings` saves a run bundle to `recordings/<id>/` in fixture format.
- `WS /ws?role=stage|tablet|camera`: JSON envelopes `{ channel: "scan" | "taps" | "positions" | "control", payload }`, relayed to every other client.
- Responses use `{ success, data?, error? }`.

## Waves

1. Core; world and fixtures and `docs/FORMATS.md`; server, inputs and tablet; iOS scan app; 3D scene and editor.
2. Stage flow (the six steps, wiring everything); camera tracker.
3. Acceptance test (Playwright, replay mode), runbook, limits list, review and polish.

## Rules for everyone building

- Own only your paths. Do not edit `src/core/types.ts`; if a contract must change, say so in your report.
- Do not run git commands that write. The orchestrator commits.
- Tests first for logic. Known-answer tests for every number.
- Immutable data, small files (under about 400 lines), explicit errors, zod at every boundary, no `console.log`.
- Add a line to `docs/DECISIONS.md` (append only, under your own heading) for each choice a teammate might dispute.
- Report plainly: what you ran, on what input, what you saw, and what is not verified.
