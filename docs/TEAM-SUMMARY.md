# Dry Run: project summary

Nov 13, 2026 · @Frank

## The idea

**Scan your kitchen, change one thing, and watch the rush again.**

Dry Run turns a phone scan of a kitchen into a small 3D model that moves. Staff and orders flow through it. You drag a station or add a cook, and the numbers change at once.

This version goes back to the scan-and-play idea. It keeps two things from the data version: the trust check, and kitchen-screen data as a later source. "Dry Run" is a working name.

## Problem

A café or restaurant owner can see that service is slow, but cannot see the cause or test a fix safely.

- **The decisions are made by gut feel.** Move a station, add a cook, or change who stands where. A wrong call during a busy hour loses customers.
- **The margin for error is small.** Wages and benefits take a median 36.5% of sales at full-service restaurants, and a typical restaurant keeps about 5% before tax ([National Restaurant Association figures](https://www.economyinsights.com/p/the-average-profit-margin-for-us-restaurants), [NRA on costs](https://restaurant.org/research-and-media/research/inflation/)).
- **Chains have tools for this.** They pay engineers to time each step, and consultants to build simulations from design files.
- **Independents have neither.** They have no engineer, no design files, and no way to try a change before they make it.

## Who it is for

The first user is the owner or manager of an independent café or restaurant, with 1 to about 10 locations. This person decides layout and staffing and has no modeling background.

The business:

- Has a clear peak where the line or the tickets run late.
- Has no design files for its kitchen.
- Is too small to hire a consultant, but large enough that one extra worker per shift is a real cost.

Not for now: large chains with their own operations teams, and designers of new kitchens.

## The product

The owner scans the space, watches it run, checks that the model matches, and then plays with it.

1. **Scan.** The owner sweeps a phone around the kitchen. A small stylized 3D kitchen appears, built from labeled boxes with real sizes and positions. The owner renames any box the scan labels wrongly.
2. **Bring it to life.** Staff and orders move through the model. Step times come from a short recorded run, or from a tablet that staff tap when an item is done.
3. **Trust check.** The model's order times appear next to the measured ones, with the error stated.
4. **Play.** The owner drags a station or adds a worker. Two numbers update at once: walking distance per order, and time per order.
5. **Compare.** The original and the changed version run side by side.

The two numbers have different strength. Walking distance is exact, because it comes from the layout alone. Time per order is a simulated range, and we state the assumption.

Fixed equipment is locked. Sinks, espresso machines and hoods depend on plumbing and power, so the owner cannot drag them. The owner can move staff positions, the pickup point, the queue, small fridges and ingredient storage.

## The demo (3 minutes)

The room watches a real space become a model, then a judge changes it and the room checks the result.

1. **0:00, the scan.** We sweep a phone around a staged counter with three taped stations. The 3D kitchen appears on the big screen.
2. **0:30, the run.** Three judges work the stations for 60 to 90 seconds. Orders appear on a tablet, and they tap when an item is done. A phone on a tripod watches. On screen, dots move as the judges move, and orders pile up at the slow station.
3. **1:30, the trust check.** The model's order times sit next to the measured ones. We state the error as one number.
4. **1:45, the judge plays.** A judge drags a station closer or adds a fourth worker. The numbers change, and the app predicts a range for the next run.
5. **2:15, the test.** The room makes the change for real and runs again. We compare the count with the prediction.
6. **2:45, the close.** One slide shows how we differ. One line gives the roadmap.

Step 5 stays in only if rehearsal shows that the prediction holds. If it does not hold, the demo ends on step 4.

We keep a pre-scanned model and a recorded run ready in case the live scan or the live run fails.

## Three levels, each a complete demo

The product has three hard parts, so we build it in levels. If a later level fails, the earlier one is still a demo.

| Level | What works | Demo we can give |
| --- | --- | --- |
| 1 | The editor with a hand-built kitchen. Numbers update when things move. | A judge drags a station, and the numbers change. |
| 2 | Level 1 plus the phone scan. | Scan the space, then drag. |
| 3 | Level 2 plus live people from the camera. | The full demo above. |

We reach level 1 by day two.

Out of scope this week:

- A photorealistic 3D copy of the room. The model is stylized boxes.
- Camera tracking in a real, crowded café. We track only the staged run.
- A connection to kitchen-screen data. It is a roadmap line.
- An AI question box.

## How we differ

This is one slide in the pitch. Others simulate kitchens, but they start from design files or factory video, and they serve chains.

| Tool | What it does | What we do differently |
| --- | --- | --- |
| [SpatialSim](https://spatialsim.io/) | Simulates foodservice operations from design files, for new builds and renovations | We start from a phone scan of a kitchen that is already running |
| Simulation consultancies | Build custom models for large chains | Self-service, in minutes, for an independent owner |
| [Squint](https://www.pymnts.com/?p=4178078) and other factory tools | Build time studies from factory video | We serve cafés and restaurants, and the owner can change the model by hand |
| Kitchen-screen reports (Toast, Square) | Show past ticket times | We show the effect of a change |

The pitch line: "They simulate the restaurant you plan to build. We scan the one you are running."

The SpatialSim and Squint rows come from pages we read. SpatialSim lists "a captured existing operation" as a possible input and does not say how it captures one. The consultancy and report rows come from an earlier draft and are not yet checked.

## How we build it in one week

Four parts, built in the order of the three levels.

| Part | What it does | Tools |
| --- | --- | --- |
| Editor and display | Shows the kitchen as 3D boxes. Lets the user drag movable items and add workers. Draws staff and orders as moving dots. | A web 3D library such as three.js |
| Numbers | Walking distance per order, from the layout and each menu item's station order. Time per order, from a small simulation where stations are queues and workers are servers. | Python with SimPy, or the same logic in the browser |
| Scan | Sweeps the room and exports labeled boxes with sizes and positions. | A small iPhone app on Apple's [RoomPlan](https://developer.apple.com/augmented-reality/roomplan) |
| Live run | Step times from tablet taps. Staff positions from a fixed phone camera, using a ready-made person detector and tracker. | Python |

RoomPlan has three limits that matter here. It needs an iPhone or iPad with a LiDAR sensor, which means a Pro model. It recognizes 16 object categories, and none is café equipment, so the user renames boxes. It works best on a single room.

For the live run, we mount the phone high and give each worker a different colored hat. Then people do not block each other, and the tracker does not confuse them.

For four people: one on the editor and display, one on the numbers and the trust check, one on the scan app, and one on the live run and the pitch.

## Risks and what to verify first

The largest risk is scope: three hard parts in one week. The levels above are the answer.

- **The scan needs a Pro iPhone.** If nobody has one, the fallback is photos plus a vision model that guesses a rough floor plan, which the user then corrects by hand.
- **Live tracking works only in a staged setup.** In a real café, counters hide people and workers cross paths. We do not claim it works there yet.
- **The prediction can miss on stage.** We state it as a range, and we rehearse until we know how often it holds.
- **Short runs give uncertain averages.** With about 20 orders, the average step time can be off by roughly 10%.
- **Most equipment cannot move.** If the only movable things do not matter, the gains are small. We need to see this on one real layout.
- **Accuracy on a real business is unproven.** The roadmap answer is kitchen-screen data: Toast [records fire and fulfillment times](https://doc.toasttab.com/doc/devguide/apiKitchenGettingFulfillmentData.html) for every item at every station.

First actions:

- [x] Find out who on the team has an iPhone or iPad Pro with LiDAR.
- [ ] Run Apple's RoomPlan sample app on one room and look at the output.
- [ ] Build the level 1 editor with a hand-built kitchen.
- [ ] Film one staged run and test the person tracker on it.
- [ ] Ask one café owner to let us scan the empty shop.
