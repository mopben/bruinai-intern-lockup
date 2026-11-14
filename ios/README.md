# Dry Run Scan (iPhone app)

A small app that scans the staged counter with Apple's RoomPlan and gets a `scan.json` onto the laptop. It does three things: capture, show a short summary, send. Everything else (renaming boxes, roles, locks, the floor marks) happens in the stage app on the laptop.

**RoomPlan capture on a real LiDAR device is not verified by the builder.** See "Verified / not verified" below.

## Requirements

- An iPhone or iPad **with LiDAR**: iPhone 12 Pro or later Pro models, or an iPad Pro (2020 or later). On any other device the app says so and offers only the bundled sample scan.
- A Mac with Xcode (built with Xcode 27.2, iOS SDK 27.2). Deployment target is iOS 17.
- A free Apple ID is enough to install on your own phone.
- Optional: [xcodegen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), only if you change `project.yml`.

## Build and install

1. Open `ios/DryRunScan.xcodeproj` in Xcode.
2. Select the **DryRunScan** target, tab **Signing & Capabilities**:
   - **Team**: pick your Apple ID (add it under Xcode > Settings > Accounts if it is not listed).
   - **Bundle Identifier**: change `com.dryrun.scan` to something unique, e.g. `com.yourname.dryrunscan`. Free accounts cannot reuse an identifier someone else registered.
   - To keep this across `xcodegen generate`, put the team in `project.yml` (`DEVELOPMENT_TEAM`) and the identifier under the DryRunScan target.
3. Plug in the phone, select it as the run destination, press Run.
4. First run on the phone: Settings > General > VPN & Device Management > trust your developer profile. Also enable Developer Mode if iOS asks.
5. When the app first sends, iOS asks for **Local Network** access. Say **Allow**. If you said no: Settings > Privacy & Security > Local Network > Dry Run Scan.

Command line (no phone needed):

```sh
cd ios
xcodegen generate                      # only after editing project.yml
xcodebuild test -project DryRunScan.xcodeproj -scheme DryRunScan \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
xcodebuild build -project DryRunScan.xcodeproj -scheme DryRunScan \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

## Scanning the staged counter well

- **Light**: bright, even light. Avoid strong backlight from windows; RoomPlan will ask you to turn on lights if it is too dark.
- **Clear the floor** around the counter of bags and cables, and keep people out of the sweep.
- **Start** a step back from the counter, phone at chest height, pointing at a wall.
- **Sweep slowly**: walk the length of the counter, then back, so each item is seen from the front and from a corner. Follow Apple's on-screen hints ("Move closer", "Slow down"). Include the two walls; they give the room its frame.
- 30 to 60 seconds is plenty for a 4.5 m x 3.5 m area. Then press the big **Done**. Wait for "Building the room..." to finish.
- What RoomPlan sees: it knows household types only. Counters and work surfaces come out as **table**; a cabinet or a box with an espresso machine on it often comes out as **storage**; fridges, sinks, stoves, ovens, dishwashers are recognised by name. Small items on top of a table (the espresso machine itself, a till) are usually **not** separate boxes.
- **Taped floor marks are not detected** (the queue mark). Add and rename them in the stage app.
- Check the summary: you should see roughly the number of items on the counter, 2 walls, and an extent near the real room size (about 4.5 m x 3.5 m). If it says 0 objects or the size is far off, press **Back to start** and scan again.

## Sending

1. On the laptop, start the product (`npm start`). The stage screen shows the laptop's address.
2. Phone and laptop on the **same Wi-Fi** (a phone hotspot works; venue guest Wi-Fi often blocks device-to-device traffic).
3. Type the address in the app, e.g. `192.168.1.20`. Port 5179 is used unless you type one (`192.168.1.20:5179`). The app remembers it.
4. Press **Send to laptop**. The app POSTs the JSON to `http://<address>:5179/api/scan` and says plainly what happened:
   - green "Sent. The laptop accepted the scan." on `{ "success": true }`;
   - red with the server's `error` text if the server refused it;
   - red "refused the connection", "no answer in 8 s" or "cannot find" for network problems.
   The button becomes **Retry**.

### Fallback when the network fails

Press **Share scan.json (AirDrop / Files)**. AirDrop it to the laptop (or save to Files and move it by cable), then drag `scan.json` onto the stage screen.

If the phone itself fails, the stage app has the recorded scan. The app also has **Send sample scan** (a hand-written scan of the staged counter, marked SAMPLE) to test the send path without LiDAR.

## What the app produces

Exactly the `Scan` type in `src/core/types.ts` (human description in `docs/FORMATS.md`). Mapping from RoomPlan's `CapturedRoom`:

| Scan field | From RoomPlan |
| --- | --- |
| `boxes[]` | `room.objects`, in RoomPlan's order, ids `box-1`, `box-2`, ... |
| `category` | `CapturedRoom.Object.Category` case name, verbatim: `storage`, `refrigerator`, `stove`, `bed`, `sink`, `washerDryer`, `toilet`, `bathtub`, `oven`, `dishwasher`, `table`, `sofa`, `chair`, `fireplace`, `television`, `stairs`; a future unknown case becomes `unknown` |
| `center` | translation of `transform`, then y shifted so the lowest object or wall bottom is y = 0 (ARKit's origin is where the phone was, not the floor) |
| `size` | `dimensions` x, y, z as w, h, d |
| `yaw` | rotation of `transform` about +y: `atan2(z.x, z.z)` of the transform's local z axis, in (-pi, pi]. yaw = 0 means local +z faces world +z; +90 deg turns local +z to world +x |
| `confidence` | `low` / `medium` / `high` |
| `walls[]` | `room.walls`, ids `wall-1`, ...; `size.w` length, `h` height; RoomPlan walls have zero thickness, so `d` is set to 0.1 m |
| `source`, `device`, `capturedAt` | `"roomplan"`, hardware model + iOS version (e.g. `iPhone17,1 iOS 27.2`), ISO time of capture |

All numbers are rounded to 3 decimals (millimetres; yaw to 0.001 rad). Doors, windows, openings, floors, sections and curved-wall geometry are **skipped**. x and z are left in ARKit's frame (origin where the scan started); they are not re-centred.

## Code map

- `DryRunScan/Sources/Scan/` – pure: `ScanModel` (Codable mirror of types.ts), `ScanMapper` (input -> Scan), `ScanGeometry` (yaw, rounding), `ScanSummary`, `ScanJSON`.
- `DryRunScan/Sources/Capture/` – the only RoomPlan code: `RoomPlanAdapter` (CapturedRoom -> plain structs, no maths) and `RoomCaptureController` (RoomCaptureView, Done, result).
- `DryRunScan/Sources/Send/` – address parsing, the POST, device name.
- `DryRunScan/Sources/Views/`, `App/` – three screens: Home, Capture, Review.
- `DryRunScan/Resources/sample-scan.json` – the bundled sample.
- `DryRunScanTests/` – 27 unit tests.

## Verified / not verified

Verified by the builder on a Mac (Xcode 27.2, iPhone 18 Pro simulator, iOS 27.2):

- Unit tests pass (27): yaw sign and size for 0, 90, -45 and 180 deg with rotations built by `simd_quatf` (independent of the code under test), centre from translation, millimetre rounding (no `-0`), floor normalisation, wall thickness, ids and header fields, JSON keys exactly as in types.ts, optional fields omitted rather than `null`, encode/decode round trip, the bundled sample decodes, address parsing, server reply handling, summary extent.
- The app compiles for a real device (`generic/platform=iOS`, unsigned), so the RoomPlan code type-checks against the device SDK.
- In the simulator: the "cannot scan" message shows, **Send sample scan** shows the summary (7 objects, 2 walls, 4.6 m x 3.6 m), **Send to laptop** POSTed to a throwaway local listener, which received `POST /api/scan` with `Content-Type: application/json` and a body with exactly the Scan keys; the app showed the green success line. With the listener stopped, the app showed "refused the connection" and a Retry button. Screenshots: `ios/docs/`.

Not verified:

- **RoomPlan capture on a real LiDAR device.** The capture screen, the Done flow, the coaching UI and the mapping of a real `CapturedRoom` have never run. In particular, whether RoomPlan's object "front" (local +z) is the side a person stands at is not known; the stage app lets the owner set the stand side.
- Sending over real Wi-Fi from a phone, and the Local Network permission prompt.
- The Share sheet / AirDrop (the button appears; it was not exercised).
- Against the real Dry Run server: it did not exist yet when this was built. Only a throwaway listener was used.
- Signing with a free Apple ID.
