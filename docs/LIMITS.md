# Dry Run: limits

What is not verified, what is fragile, and what we would do next. Most important first. Sources: the builders' notes in `docs/DECISIONS.md`, `docs/CAMERA.md`, `ios/README.md`, and runs of the app on the bundled recordings (Nov 14, 2026).

## Not verified

Everything below needs a real device, a real room or real people. None of it has been tried.

- **RoomPlan capture on a LiDAR iPhone.** The capture screen, the Done flow and the mapping of a real `CapturedRoom` have never run. Only the simulator, the unit tests and a device build (unsigned) were checked.
- **Which side RoomPlan calls an object's front.** The stand side of each box depends on it. The owner can change the stand side in the Scan step.
- **The full live path end to end:** a real scan, then camera calibration on that scan, then a live run, then Trust and Play on that run. Each piece ran alone on test input; never all together in a room.
- **Real Wi-Fi** from the phone and the tablet to the laptop, the iOS Local Network prompt, AirDrop of `scan.json`, and the macOS firewall's view of the server. On the build machine the tablet page ran in a second browser tab on the same laptop.
- **A real camera, real hats and real light.** The tracker was tested only on a computer-generated video. Also untested: Continuity Camera's delay and picture quality, caps and beanies (the test hats were round, evenly coloured blobs), mixed daylight and warm light, steel reflections, people bending over, clothes in hat colours.
- **Touch dragging on a real touchscreen.** Dragging was checked with a mouse only.
- **A real projector.** Readability from the back of a room is a design aim, not a measurement.
- **Real people following the run rules** (fetch round trip, work, tap, carry and come back; hand over within 1 m). The fixtures follow them exactly; people may not.
- **Any real café.** No real kitchen has been scanned or run.
- **Signing the scan app with a free Apple ID.**

## Fragile

- **The prediction for a fourth worker is unreliable.** On 40 freshly generated rooms (`npx tsx tools/coverage/coverage.ts 40`), the stated 8-in-10 range held the real result only 24 times, and the prediction was too slow by 1.1 s on average. The model assumes two people at one station do not get in each other's way and that a new person works at the pace of the person already there. That does not match the generated room. A proper fix needs a model of shared stations.
- **The prediction for the fridge move is reliable but wide.** On the same 40 rooms the range held 39 times, with a bias of 0.1 s. The range is about 4 s wide, because the new walk is shorter than any walk measured in the first run, and the screen says so.
- **The two bundled second runs are not evidence.** Both now fall inside their ranges (9.9 s in 8.1–11.6 s; 14.3 s in 13.0–15.7 s). But the model was changed three times after looking at them: walking pace from whole trips, trips timed from rest to rest, and a wider range when a walk is outside the measured lengths. Each change has a reason that does not depend on those runs (see `DECISIONS.md`), and an independent review found the second and third. From here on, the check is the coverage tool on fresh rooms, and then real runs.
- **The trust check cannot see every error.** It compares order times in the layout that was run. An error in walking time hides inside the measured work times there. The screen therefore also shows a separate walking check and what a plain average would score.
- **Ten orders is a short run.** Every average has a wide error. The trust check learns from 5 orders and checks 5. On the original recording the model error is about 8%; across 40 generated rooms it ranged from about 11% fast to 8% slow.
- **The original recording ends at 88.6 s against a 90 s limit.** A slightly slower real run will not fit the 60 to 90 s slot.
- **Hat height.** With the camera about 2.8 m up, 1 cm of hat-height error moves a dot about 3 to 4 cm. On the test video, assuming 1.65 m for everyone gave 10 cm average error (worst 25 cm); measured heights gave 3 cm (worst 14 cm). The fallback calibration with floor points only is labelled approximate: a lens centre 5 px off costs about 11 cm.
- **Hat colour.** At 40% brightness one hat was lost on the test video. Sample the colours again if the light changes. Similar colours (orange and red) get mixed up.
- **The camera calibration belongs to one scan.** A new phone scan has a new floor frame, so the camera must be calibrated again (about a minute). This does not fit between the live scan and the live run on stage.
- **Recordings stand in only for their own kitchen.** After a fresh phone scan the recorded taps and positions do not line up with it. The only fallback is to switch the scan back to recorded too.
- **A live run that partly fell back to the recording** is labelled "(… partly from the recording)" when saved. On a freshly scanned kitchen such a saved run can fail the validator (worker ids and the menu item differ from the recording's).
- **A saved second run is not linked to a saved live first run.** Its `baseRunId` says `live run`, so it does not appear under "Second run (Test)" for that first run. Edit its `run.json` by hand (see the README).
- **Taped floor marks are invisible to RoomPlan.** The queue mark must be added in the Scan step.
- **Two workers at one station are assumed not to get in each other's way.** Collisions between people are not simulated.
- **All walking paths in the bundled recordings are straight lines.** Routing round obstacles is covered only by unit tests.
- **Grown obstacles have square corners**, which overstates a detour round a corner by up to about 0.1 m.
- **The first `npm start` needs internet** to install packages. Later starts do not.
- **The camera page must stay visible on the laptop.** A hidden browser tab slows the tracker down.
- **Compare plays one simulated run per side.** It is one draw, not the range; quote the range.

## What we would do next

1. **Take the first real scan** of the staged counter with the LiDAR iPhone, load it, and check sizes, categories and which side is the front. This is the first true test of level 2.
2. **Run the first real staged run**: tablet, filming phone, three people in hats. Record it, validate the folder, and play it back. This is the first true test of level 3.
3. **Rehearse the prediction and count.** Run the change for real five to ten times and record how often the measured mean lands inside the range. Keep step 5 in the demo only if it holds most of the time.
4. **Measure the camera on the day's light**: average and worst dot error against tape marks, and how often each hat is lost.
5. **Time the full live demo** on the real network and the real projector, with someone at the back of the room reading the numbers.
6. **Practise every fallback** in the runbook at least once with the real devices.
7. Fix what the real runs show, in this order: honest numbers, the instant answer to a drag, the look, then the rest.
