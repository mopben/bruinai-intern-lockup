# Camera tracker: setting it up on the day

The camera page (`/camera`) watches the counter through the filming phone, finds each worker's coloured hat, works out where on the floor that person stands, and sends those positions to the stage about 10 times a second. It runs on the laptop, in the browser. The phone is the laptop's webcam.

**Read this first.** The tracker has only been tested on a computer-generated video of the bundled run (see "How it was tested" at the end). It has not been tried with a real phone, real hats or real light. Leave 20 minutes on the day to set it up and check it. If it fails, the stage falls back to the recorded positions (see "When it fails").

## What you need

- The filming phone, an iPhone that can act as a Mac webcam (Continuity Camera, macOS 13 or later), or any phone with a USB webcam app and a cable.
- A way to mount the phone **high and fixed**: a tall tripod, or a clamp on a shelf. About 2.5 to 3 m up, at the customer side of the counter, tilted down so the whole working area fits in the picture. Higher is better (see "Hat height" below).
- One baseball cap or beanie per worker, each a **different strong colour**: red, blue, yellow, green. Plain, no big logos. The colour each worker wears must match their colour in the stage's kitchen (`layout.json`, `workers[].color`).
- Nothing else in view in those colours that is bigger than a fist: no red tray, blue cloth or yellow sign. Small things (a mug) are ignored.

## 1. Mount the phone

- Put it where it sees the whole floor the workers use: all the stations, the fridge, the pickup. Landscape.
- Do not touch it after you calibrate. If it moves, calibrate again (it takes a minute).
- Keep the phone on a charger, with auto-lock off.

## 2. Connect the phone as the webcam

- **Continuity Camera:** phone and Mac on the same Apple ID, Wi-Fi and Bluetooth on, phone locked, mounted landscape and still. It then appears in the camera list.
- **Cable:** plug it in and start the webcam app on the phone.

On the laptop, start Dry Run (`npm start`) and open **http://localhost:5179/camera** in Chrome, in its own window on the laptop screen (the stage goes on the projector). Keep this page visible: browsers slow down hidden tabs.

Press **Use camera**, allow camera access, and choose the phone in the camera list. The page remembers the choice. If it says access was refused, click the camera icon in the address bar, allow it, and press **Try again**.

The top bar shows **Connected to the laptop** and **Stage is listening** when the stage is open. The kitchen arrives from the stage by itself ("Kitchen: from the stage"). Without a stage, choose a run under "load from a recorded run".

## 3. Calibrate (about a minute)

Calibration tells the page where the floor is in the picture.

1. Press **Calibrate**. The map on the right shows the kitchen from above, with **circles** (floor corners of boxes, ends of walls) and **squares** (top corners of boxes).
2. Click a circle on the map, then click **the same spot** in the camera picture. Do this for **at least 4 floor points**, spread out over the floor: near and far, left and right. Pick corners you can see clearly; the back corners of counters against the wall are usually hidden.
3. Then do **2 or 3 squares** (box top corners) on different boxes. These make the hat height correction exact.
4. Check. Each point shows its error in cm. Green is under 5 cm, amber under 15 cm, red is worse. The box outlines drawn over the picture should sit on the real boxes. If a point is red, or the page says "Point 3 disagrees with the others", delete it and click it again.
5. Press **Done**.

The calibration is saved in the browser for this camera and this scan, so it survives a reload. Press **Export** to keep a copy as a file, and **Import** to load it on another laptop.

The calibration uses the scan's positions of the boxes. If the scan is wrong (a box is 20 cm off), points on that box will show large errors. Use points on other boxes.

## 4. Sample hat colours and measure hat heights

For each worker, on their card:

1. **Sample**: click the middle of their hat in the picture. The page now looks for the colour the camera really sees, which fixes most lighting trouble.
2. **Measure**: ask the worker to stand on their spot at their own station (where they stand to work), then click their hat. The page works out how high the hat is. You can also type the height (floor to the middle of the hat, in metres).

Hat height matters. The page has to know how high the hat is to know where the person stands under it. With the camera about 2.8 m up, every 1 cm of hat height error moves the dot about 3 to 4 cm on the floor. A lower camera makes this worse.

## 5. Check it is locked

Each worker's card shows:

- **locked** (green): the hat is found in this frame.
- **holding** (amber): lost for a moment (someone walked in front). The last position is kept for up to half a second.
- **lost** (red): not found. Nothing is sent for this person, and the page does not guess.
- **two hats?**: two blobs of that colour. Remove the other object, or sample again.

The small black picture on each card is the **mask**: everything the tracker thinks is that hat. You want **one clean blob** where the hat is and nothing else. The bar shows how often the hat was found over the last couple of seconds.

Walk each worker around their whole route (to the fridge, the pickup) and watch their dot on the map follow them.

## 6. During the run

Nothing to press. The page sends positions while it tracks; the stage uses them only while a run is going.

## Recording a run to `positions.jsonl`

Press **Record** before the run and **Stop and save** after it. The browser downloads `positions-<date>.jsonl` in the format of `docs/FORMATS.md`, with times counted from when you pressed Record. Only frames where the hat was actually seen are written (gaps are left out, as the format allows). Trim the start to match the taps as described in FORMATS.md ("Trimming the start").

## Turning a filmed video into `positions.jsonl`

If someone filmed a run with the phone on the mount (same position as when you calibrated, or calibrate again on the video):

1. Press **Open video file** (or drop the file on the page). `.mp4` and `.mov` from an iPhone play in Chrome on a Mac.
2. Calibrate on the video (or Import the calibration if the phone did not move). Sample colours on the video too.
3. Press **Turn whole video into positions.jsonl**. The page steps through the whole video, 10 frames per second of video time, as fast as the laptop can (about half real time for a 90 s 720p video), and downloads the file. Times are seconds from the start of the video.

You can also press Play and watch it track, with Record, to check a part.

**Without hats.** A filmed video can also go through the Python video pipeline in `vision/`, which finds people with a person detector instead of hat colours and also writes `actions.jsonl`. It reuses the calibration you export here (press **Export** after calibrating on the video). For that pipeline `hatHeights` means the height of the top of each worker's head, a few centimetres above where you would measure a hat's middle. See [VISION.md](VISION.md). It has not been tried on a real café video.

## When it fails

- **The stage falls back by itself.** If no position arrives for 4 seconds, or the laptop link drops, the stage switches the dots to the recorded positions of the matching run, mid-run, without a restart. Say "we're showing the recorded run for the dots" and carry on. The recorded dots only line up with the recorded kitchen: after a fresh phone scan they belong to another floor frame, and the stage warns "The recording standing by is from another kitchen".
- **A new scan needs a new calibration.** The calibration is saved per scan. After a fresh phone scan the page has none for it; calibrate again before the run.
- **One worker keeps getting lost:** sample their hat again. Check their mask for other blobs. Check nothing hides their hat at that spot (a lamp, a shelf).
- **Dots are offset or mirrored:** calibration. Press Calibrate and look at the box outlines; redo the red points. If the camera was bumped, start over.
- **Dots are right at the counter but wrong near the camera (or the other way round):** hat height. Measure it again.
- **Two hats look alike** (orange and red, light blue and green): change a hat. Pick colours far apart.
- **It is slow or jerky:** close other apps and keep the page visible. Continuity Camera adds some delay (not measured here; expect a fraction of a second).

## How it was tested (and what was not)

There was no camera, no hats and no people while building this. Everything below is from a computer-generated video (`tools/camera/`): the bundled run `counter-a` drawn as a fixed camera 2.8 m up would see it, with shaded boxes, people with coloured hats at slightly different heights, a lamp that hides a hat when someone walks past, an arm raised over a hat now and then, a slow brightness swing, blur, sensor noise and video compression.

- Calibrated with 6 floor points and 3 box tops, clicked with about 1.5 px of hand error: average error 1.0 cm.
- Whole video (886 frames) through the real page: dots on average **3 cm** from the truth, worst 14 cm (a hat half hidden by the lamp). Found in 100 % of frames for two workers and 94 % for the one who walks under the lamp.
- With every hat assumed at 1.65 m instead of measured: average 10 cm, worst 25 cm. Measuring the heights with the Measure button got them within 1 cm and the average back to 3 cm.
- Hats were still found at half and at 1.6 times normal brightness without sampling again. At 40 % brightness one hat was lost: sample again if the light changes a lot.

**Not tested:** a real phone, Continuity Camera's delay and picture quality, real hat fabrics and shapes (a cap's brim and a beanie differ from the round blobs in the test video), real kitchen lighting (mixed daylight and warm bulbs, reflections off steel), people bending over and leaning, real clothes in hat-like colours. Expect to adjust the colour sampling, the hat heights and the camera position on the day.

To make the test video and run the checks yourself:

```
npx tsx tools/camera/make-video.ts fixtures/counter-a /tmp/synth        # about 5 minutes
npx vite build && PORT=5192 npm run serve                                 # in another terminal
npx tsx tools/camera/browser-check.ts http://localhost:5192 /tmp/synth /tmp/synth/calibration-measured.json /tmp/check
npx tsx tools/camera/compare.ts /tmp/check/tracked-positions.jsonl fixtures/counter-a
```
