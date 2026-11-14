# Decision log

Short entries: what we chose and why. Append under your own heading.

## Orchestrator

- **One TypeScript codebase, simulation in the browser.** A drag must answer with no visible wait and the demo must run offline. A Python service would add a process, a network hop and a second language for no gain.
- **Camera tracking by hat colour, in the browser.** The run is staged: high fixed camera, three or four people, each in a different coloured hat. Colour blobs are simpler and more reliable there than a person detector, need no model download, and can be tested on a synthetic video. The filming phone acts as the laptop's webcam.
- **RoomPlan is used for the scan only.** It captures room geometry and has no people tracking, so it cannot supply positions.
- **Fixtures come from a separate world generator** (`tools/world/`), which never shares parameters with the model. Otherwise the trust check and the prediction test would be the model agreeing with itself.
- **Trust check on held-out orders.** Calibrate on even-numbered orders, score on odd-numbered ones. Interleaving avoids confusing drift (people speed up) with model error.
- **Three recorded runs**: original, fridge moved closer, fourth worker. Whichever change a judge picks, a recorded run exists to test the prediction against.
- **The brief wins over the team summary where they differ.** The close is the side-by-side run, not a slide. Level 1 uses a recorded scan, not a hand-built kitchen.
- **`npm start` installs and builds on first run.** That first run needs internet; the demo does not. Committing build output to avoid this was judged worse.
- **The stage is the run clock.** It releases orders and stamps taps on receipt, so device clocks never need to agree.

## Scan app (iOS)

- **The app maps RoomPlan output to our `Scan` itself**, in a pure function with unit tests. We do not ship RoomPlan's own JSON, because its shape cannot be checked without a device.
- **Walls get a nominal thickness of 0.1 m.** RoomPlan walls have none.
- **No re-centring.** x and z stay in the phone's frame, with the origin where the scan started. Nothing downstream needs a centred scan: the scene frames whatever it is given, and positions use the same frame.
- **Categories are RoomPlan's own case names** (`table`, `storage`, `refrigerator`, `washerDryer`). An unknown case becomes `unknown`.
- **Doors, windows, openings and wall curvature are skipped.** The model does not use them.
- **Unknown until a real scan exists:** which side RoomPlan treats as an object's front. The owner can set the stand side in the stage app.

## Core

- **Yaw follows three.js.** Local (x, z) maps to world as x' = x cos(yaw) + z sin(yaw), z' = -x sin(yaw) + z cos(yaw), the same as `object.rotation.y = yaw`. `standSide` "left" is local -x and "right" is local +x (left and right as the viewer sees a yaw-0 box).
- **Grown obstacles have square corners.** Boxes and walls are grown by BODY_RADIUS_M as rectangles, not rounded rectangles, so the visibility graph is over four corners each. This overstates a detour round a corner by at most about 0.1 m (r(√2-1) per corner side). Exact for the model we state; slightly conservative against a real body.
- **Stand points and margins.** STAND_OFF_M (0.35) is larger than BODY_RADIUS_M (0.25), so a stand point is outside its own box's margin. It can still fall inside a neighbour's or a wall's margin. Rule: for one path query, an obstacle whose grown rectangle contains either end point is replaced by its un-grown box (step out of the margin, never through the box); if an end point is inside the box itself, that obstacle is ignored for the query. Gaps exactly one body wide are walkable.
- **No path is not an error.** It returns a straight line with `blocked: true`, so a drag into a corner never throws; the UI should say "no way through".
- **Hand-off uses the straight line** between stand points (≤ HANDOFF_REACH_M, inclusive), even if a wall is in between. Fetches are always walked.
- **Scanned boxes with no setup entry are fixtures** (they block walking) with a warning, rather than an error, so a fresh scan resolves before the owner has named everything.
- **Messy tap logs: a step is done at the earliest tap of itself or any later step.** A later step being done proves the earlier one was. Duplicates keep the first tap. Unknown orders/steps and taps before release are ignored with a warning. Releases come from order events; an order with taps but no order event takes its scheduled time; a log with no order events uses the schedule up to the end of the run.
- **Ticket semantics.** A ticket sits at station k from when step k-1 was done (or release) until step k is done, in both recorded and simulated runs, so they animate the same. In the simulation the item physically arrives after the carry walk; the ticket counts as "at" the next station during the carry.
- **Calibration speed.** Displacement over 0.5 s windows (beats position noise), windows faster than 0.4 m/s count as walking, median across all workers. Fewer than 5 walking windows: assume 1.2 m/s and say so. These thresholds were set before any fixture existed and are not tuned to them. Speed is not bootstrapped (hundreds of windows make it precise); only work times are.
- **Work-time samples = tap - max(arrival, worker free) - fetch walk**, where arrival = previous tap + one-way carry, worker free = their previous tap at this station + carry round trip. Only clean steps are sampled (this and the previous step tapped, in sequence). With several workers at a station and no workerId in the log, the step is given to the worker free earliest. Samples below 0.5 s are raised to 0.5 s and counted. A missing tap leaves the worker-free time stale (it can inflate the next sample); we accept that rather than guess.
- **Trust check: the filter applies to samples, not to queue state.** Calibrating on even orders still uses odd orders' taps to know when a worker became free (otherwise queue waiting would be counted as work), and the speed comes from the whole position log. Neither fits the model to the odd orders' order times, which are only compared, never learned from. Error is signed: (model - measured) / measured.
- **Common random numbers.** Replication r of seed s draws order i, step k's work time from one fixed uniform, and bootstraps each station's samples from a stream keyed by (s, r, hash of station id). So two layouts, or 3 vs 4 workers, see the same luck; a drag never flickers. Default seed 1, 200 replications.
- **Range = p10 to p90 over replications** of the run's mean order time (each replication also resamples the measured work times, so a short run's uncertainty shows). Ranges are rounded outward when shown.
- **Prediction is fast enough to recompute per frame without caching**: resolve world + paths + 200 replications of 10 orders took about 1.5 ms on the build machine (M-series Mac).

## World and fixtures

- **The world has its own geometry, routing and randomness** (`tools/world/`). It imports only types and the three protocol constants (`HANDOFF_REACH_M`, `STAND_OFF_M`, `BODY_RADIUS_M`) from `src/core/types.ts`. Those constants are the staging instructions the real room follows too, not model parameters.
- **People walk in the true room; the model sees a noisy scan of it.** Scan centres are off by about 1 cm, sizes by about 1.5 %, yaws by up to 2 degrees. The camera adds 2 cm noise per axis, a constant calibration offset of about 1 cm, about 1 % dropped samples and one short occlusion per run.
- **Same people in every run.** Person traits (speed 1.0 to 1.3 m/s, acceleration, skill, tap delay, fumble chance, sway) come from one fixed seed; each run's own seed adds day-to-day pace variation of a few percent and all event randomness. Otherwise run B against run A would partly measure different people.
- **One scan, reused by all three runs.** A changed run differs only in `layout.json` (the fridge's placement in B, a fourth worker in C), as a drag in the product would. B's fridge placement is the true new position plus about 1 cm of hand-placement error.
- **Fridge in B is a back-bar fridge behind the Make worker** (door facing the counter, 0.4 m walk). Order, Make and Finish sit side by side on the back counter with no gap, so "next to Make" means behind the worker. The alternative, a gap in the counter line, would have made Order-to-Make a carry and made Order a second bottleneck.
- **Hand-offs and carries.** Order to Make and Make to Finish are hand passes (stand points 0.90 m apart). Finish to Pickup is a carry (1.13 m). The test checks these are not borderline: the same answer comes from the true room and from the noisy scan.
- **World tuned to make the story clear, not the model look good.** Distances and work-time medians were adjusted until A finished under 90 s with a visible queue at Make. Nothing was adjusted against the model's output.
- **The queue floor mark is in the scan as an `unknown` box, 2 cm high.** RoomPlan does not detect floor marks, so a real scan needs it added by hand (or the owner adds it in the editor). The scan noise is a `chair` (a stool in the corner) with low confidence, marked `ignore`.
- **Fixture scans say `source: "synthetic"` and have no `device`.** They look like a RoomPlan export but nobody scanned them; claiming `roomplan` would be dishonest.
- **Walls carry a thickness (about 10 cm) centred in the wall.** RoomPlan reports walls as zero-thickness planes, but our format requires `size.d > 0`. The scan app should pick a nominal thickness.
- **Collisions between people are not simulated.** In run C two people share Make and may walk to the fridge at once; their paths can overlap. With three or four people this is rare and short.
- **The validator has its own zod schemas** (`tools/world/schemas.ts`), with a compile-time drift check against `types.ts`, so it runs without the product. Unknown fields are warnings (likely typos), not errors.

## Scene

- **Look: a painted-wood diorama on a play table.** Cream tiled floor on a birch-ply board (with a "1 m" scale bar and 1 m lines), pale eucalyptus table behind it, chunky rounded blocks with a dark cartoon outline. Role colours are jade (station), lavender (storage), berry (pickup), marigold stripes (queue floor mark), stone (fixture), picked to stay clear of the red/blue/yellow/green worker hats. Tomato is reserved for "orders piling up here".
- **Labels are HTML overlays, not sprites.** Crisp at any projector resolution and use the bundled Baloo 2 font. They hang above each box's back edge so the front of the top (piles, toppers) stays visible; later tags are nudged up instead of overlapping; a tag fades to 30% when a worker's head is under it. Size follows the scene size (18–30 px), so side-by-side halves stay legible.
- **Order tickets pile on the station's top (front-right corner), not on the floor beside it.** The floor beside a station is where the worker stands and where neighbours touch; on top, the pile is never hidden and grows into a tower. At the alert size (default 4) tickets turn tomato, the station's outline turns tomato and a pulsing tomato rim appears on the floor. A count badge shows the true number (only 14 tickets are drawn).
- **The reveal shows raw scan first, then the owner's names.** During `playReveal` every box (including scan noise) is plain white with a dashed slate-blue scanner tag ("table", "storage"). `showNames` repaints by role, adds toppers and lock bolts, and shrinks away `ignore` boxes. Lock bolts appear only after naming, because the scan does not know what is locked.
- **Drag collision: footprints as axis-aligned rectangles (rotated extents), slide per axis.** If the spot under the pointer is free the item goes there (it may hop past an obstacle); otherwise it slides along the blocking face, trying both axis orders. Queue marks and ignored boxes do not block. Exact for quarter-turn yaws; conservative for other angles.
- **Framing uses the scan positions only**, so a drag never makes the camera jump. The drag area is the room bounds minus wall thickness on walled sides.
- **Workers are smoothed with a frame-rate-independent exponential filter (tau 0.14 s)** and snap on jumps over 2.5 m (a replay seek). This adds about 0.15 s of visual lag; acceptable for ~10 Hz noisy logs.
- **Pawns are drawn at 1.25x scale (~0.95 m tall)** so hats peek over 0.9 m counters. Workers standing behind a counter are still partly hidden; we keep a fixed camera rather than x-ray effects.
- **Rendering on demand**: one rAF loop per scene, rendering only when something changed or is animating; pixel ratio capped at 2.
