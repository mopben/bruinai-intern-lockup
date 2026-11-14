# Dry Run: stage runbook

One page. Keys work on the stage page (the laptop browser). Press **I** at any time to see the inputs and the network addresses.

## Before the day (once)

1. Clone the repository. Run `npm start` **with internet**: it installs and builds (a few minutes). Later starts need no internet.
2. The stage opens at http://localhost:5179/ in replay. Press → five times and check all six steps work.
3. Build the scan app and install it on the LiDAR iPhone: see `ios/README.md`.
4. Rehearse the whole demo at least three times, live and from recordings. Count how often the prediction holds (see the last section).

## Set up on stage (about 30 minutes)

- [ ] **Network.** Laptop, tablet and both phones on **one Wi-Fi you control** (a travel router or a phone hotspot). No internet is needed. Venue guest Wi-Fi often blocks devices from reaching each other.
- [ ] **Laptop.** `npm start`. Stage on the projector; press **Shift+F** for full screen (or the browser's own). Press **I**: the drawer lists the Tablet, Camera and Scan upload addresses.
- [ ] **Tablet.** Open the Tablet address. It must say **Connected**. The stage footer then counts "1 tablet".
- [ ] **Scan phone.** Type the laptop address in the app (port 5179 is added).
- [ ] **Scan first, then the camera.** Do the real scan now and send it. The camera calibration belongs to one scan: a new sweep needs a new calibration (about a minute). On stage, send this same scan again (Review screen, **Send again**) and say it was taken before.
- [ ] **Filming phone.** Mounted high as the laptop's webcam. Open the Camera address in Chrome on the laptop, calibrate, sample hats, measure hat heights: `docs/CAMERA.md`. Keep that window visible.
- [ ] **Hats and stations.** Three tapes on the floor, one per station. Hat colours must match the stage (the tablet column headers show each station's hat).
- [ ] **Brief the three people.** *When an order reaches you and you are free: fetch from the fridge and back if your step needs it, do the work, tap Done, carry the item to the next station (or pickup) and walk back. If the next person is within 1 m, hand it over instead. First come, first served.*
- [ ] Just before you start, load the stage fresh: **http://localhost:5179/?mode=live** for the live demo (all three inputs live), or **http://localhost:5179/** for recordings only.

## The demo

Live path first; **from recordings** in brackets. Numbers shown are the recordings'; a live run gives its own. The recorded run is 88.6 s, so press **F** (4×) to fit the time.

| Time | Step | Say / do | Key | The room sees |
| --- | --- | --- | --- | --- |
| 0:00 | 1 Scan | Sweep the phone, press Send. (Recordings: the scan replays by itself.) | P replays the scan | Plain boxes rise, then get names |
| 0:30 | 2 Run | Start the room. (Recordings: it plays on arrival.) | → then **P** "Start run". (Recordings: F) | Dots move, tickets pile at the espresso machine. Ends by itself, or **E** |
| 1:30 | 3 Trust | "On orders it never saw, the model is off by this much." | → | Model error **8%**, five order pairs |
| 1:45 | 4 Play | Hand the mouse to a judge: drag the fridge, or **+ worker** | → | Walking **6.2 m**, time **19–23 s**; both change during the drag |
| 2:15 | 5 Test | Make the same change in the room, then run again. (Recordings: the matching run plays.) | → then **P** (live). (Recordings: F, or E) | Predicted range, measured mean, and a plain verdict |
| 2:45 | 6 Compare | "Same orders, same luck, before and after." | → (P plays again) | Two kitchens side by side |

## When something fails

| Symptom | Press | The room sees |
| --- | --- | --- |
| Scan does not arrive ("Waiting for the phone") | Check the address under **I**. Or AirDrop `scan.json` and drag it onto the stage. Or **I**, Scan: **Recorded** | The kitchen appears |
| Tablet disconnected | Nothing. It retries and resends taps. After 5 s with no tablet, the stage uses recorded taps | "Showing the recorded taps (no tablet connected for 5 s)" |
| Camera lost | Nothing. After 4 s the stage uses recorded positions | "Showing the recorded run (positions: …)" |
| Dots wrong | **I**, Positions: **Recorded** | Recorded dots, run continues |
| The live run is a mess | **I**, set all three to **Recorded**, Esc. A run not yet started then plays the recording at once (**P** if it is over); a running one switches over. **F** for 4× | The recorded run plays |
| Judge freezes at the drag | **M** (fridge next to the espresso machine) or **W** (fourth worker). **Backspace** resets | Numbers jump to the rehearsed change |
| Prediction misses | Nothing. Say: "Outside the range by a second. Ten orders is a short run, and this is why we test it." | "Outside the range: 0.3 s slower than predicted." |
| Save failed | **S** | "Saved on this laptop in recordings/…" |
| Laptop or browser dies | Reload, or `npm start` again: it reopens on the same step (the address keeps it), in replay. Use **M** or **W** again | The recorded demo |

With a fresh phone scan, the recordings come from another kitchen, so none stands by: a failed live input shows its trouble and nothing is filled in (the stage says so). Then the only fallback is all three on **Recorded**.

## Honest state of the prediction

On the bundled recordings both changes land **just above** the range: fridge moved, predicted 8.8–9.7 s, measured 9.9 s; fourth worker, predicted 12.3–13.3 s, measured 14.3 s. Keep step 5 only if rehearsal shows the prediction holds. To skip it: in Play press **6** (straight to Compare).
