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

- **The prediction misses on the bundled recordings, just above the range, for both changes.** Fridge moved: predicted 8.8–9.7 s, measured 9.9 s (0.3 s slower). Fourth worker: predicted 12.3–13.3 s, measured 14.3 s (1.0 s slower). The builders' reading: the range covers sampling uncertainty (few orders, few walking trips), not errors in the model's structure, such as pace that differs from run to run or a new worker's own pace. Nothing was tuned to hide the miss; two changes were made after the first miss (pace from whole trips, pace uncertainty in the range) for reasons stated in `DECISIONS.md`, and the screen says "Just outside" or "Outside" plainly.
- **Ten orders is a short run.** Every average has a wide error. The trust check learns from 5 orders and checks 5. On the original recording the model error is 8%.
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
