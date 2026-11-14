# Dry Run: build brief

Nov 13, 2026 · @Frank

## Mission

Build Dry Run: **scan your kitchen, change one thing, and watch the rush again.**

An owner of a small café or restaurant can see that service is slow. The owner cannot see the cause, and cannot test a fix without risking a busy hour. Chains pay engineers and consultants for this. Independents have a phone.

Dry Run turns a phone scan of a real kitchen into a small 3D model that moves. Staff and orders flow through it as they did in a real run. The owner drags a station or adds a worker, and sees at once what the change does.

You are building this for a three-minute live demo in front of investors on \[demo date\]. The demo is the product. Every choice you make serves that demo.

## What must be true

These rules do not bend. If a design choice conflicts with one of them, change the design.

1. **A real space becomes a model.** The kitchen on screen comes from a scan of a physical room, with real sizes and positions. It is never drawn by hand for the final demo.
2. **The model moves like the real run.** When people work in the real space, their dots move in the model, and orders pile up where they piled up in reality.
3. **Trust comes before play.** Before any change, the model shows its own order times next to the measured ones, with the error as one number.
4. **One change, by hand, with an instant answer.** A person drags a station or adds a worker. The numbers respond with no visible wait.
5. **The prediction can be checked.** The model states what the next real run will produce, as a range. The room can run it and compare.
6. **Every number is honest.** Walking distance is exact, from the layout. Time per order is a simulated range with its assumption stated. Nothing is hard-coded, and nothing is faked to look good.
7. **It feels like a small toy city, not a dashboard.** The model is stylized, warm and readable from the back of a room on a projector. Charts support the model and never replace it.
8. **An owner needs no instructions.** A person with no technical background understands each screen in a few seconds.
9. **It survives the stage.** The demo runs without a network connection. If a live input fails, a recorded one takes over without a restart.

## The acceptance test

The work is done when an operator can give this demo, start to finish, in three minutes.

1. **The scan.** The operator sweeps a phone around a staged counter with three marked stations. The 3D kitchen appears on the big screen.
2. **The run.** Three people work the stations for 60 to 90 seconds. Orders appear on a tablet, and each person taps when an item is done. A fixed phone camera watches. On screen, dots move as the people move, and orders pile up at the slow station.
3. **The trust check.** The model's order times appear next to the measured ones, with the error as one number.
4. **The play.** A judge drags a station closer, or adds a fourth worker. Walking distance per order and time per order update at once. The model predicts a range for the next run.
5. **The test.** The room makes the change for real and runs again. The screen compares the result with the prediction.
6. **The close.** The original and the changed version run side by side.

The operator is a student on a stage with one laptop, one phone, one tablet and a projector. Design for that person under pressure.

## Your situation

You have no phone, no camera and no people. The demo needs all three. Plan the whole build around this fact.

The real world reaches the product through three inputs:

- **The scan:** the room as labeled boxes with sizes and positions.
- **The taps:** which order item was finished, at which station, and when.
- **The positions:** where each worker was over time, from the camera.

Each input must work in two forms: live from a device, and replayed from a file. The rest of the product must not know which form it receives.

This gives you a way to finish and verify the work alone:

- **Make fixtures.** Create a realistic recorded scan, tap log and position log for a three-station counter, including one clear bottleneck. Create a second set for the changed layout, so the prediction has something to be checked against.
- **Make replay a first-class mode.** The full acceptance test must pass from fixtures alone, from a clean checkout, with one command.
- **Make the live paths thin.** The phone scan and the camera tracking are the parts you cannot test on real hardware. Keep them small and separate, and say plainly what you verified and how.

The team will record real inputs on their own devices and place them in the same formats. Document those formats so that a person can do this without reading your code.

The scan uses Apple's RoomPlan, which needs an iPhone or iPad with a LiDAR sensor. It recognizes household object types and has none for café equipment, so the product must let a person rename and correct what the scan produced.

## Order of work

Build in three levels. Each level is a complete demo, so a failure at a later level never leaves the team with nothing.

| Level | What works | The demo it supports |
| --- | --- | --- |
| 1 | The model, the play and the numbers, on a recorded scan and recorded taps | Steps 3, 4 and 6 of the acceptance test |
| 2 | Level 1 plus the phone scan | Steps 1, 3, 4 and 6 |
| 3 | Level 2 plus live taps and live positions from the camera | All six steps |

Finish and polish each level before you start the next. A beautiful level 1 is worth more than a rough level 3.

If time runs short, protect the rules in "What must be true" in this order: honest numbers, the instant answer to a change, the toy-city feel, then everything else.

## What is yours to decide

Everything about how. You choose the languages, the libraries, the architecture, the file formats, the simulation method, the tracking method and the visual design. Choose what gives the most reliable demo, not what is most impressive to build.

A few facts about the problem that your choices must respect:

- **Fixed equipment does not move.** Sinks, espresso machines and hoods depend on plumbing and power. Lock them. People can move staff positions, the pickup point, the queue, small fridges and ingredient storage.
- **Short runs give uncertain averages.** A 90-second run has few orders. Show ranges, and do not show false precision.
- **The camera view is controlled.** It is high and fixed, with three or four people who each wear a different colored hat. Do not build for a crowded real café.

## What not to build

- A photorealistic copy of the room.
- Camera tracking for real, crowded spaces.
- A connection to restaurant point-of-sale or kitchen-screen systems.
- An AI chat box or assistant.
- Accounts, sign-in, cloud hosting or a phone layout.

If you find time left over, spend it on polish and reliability of what exists. Do not add features.

## How to work

- **Do not stop to ask.** Nobody is watching while you work. When a choice is unclear, take the reading that best serves the acceptance test, and continue.
- **Write down each decision that matters.** Keep a short log of what you chose and why, so the team can disagree later without reading the code.
- **Verify by running.** Look at the screen your code produces before you call a level done. Test the numbers against cases where the right answer is known.
- **Check the model against itself.** The trust check must be a real comparison. Make sure the simulation is not fitted to the same data it is then checked against.
- **Report plainly.** For each part, say whether you ran it, on what input, and what you saw. Say "not verified on a real device" where that is true.
- **Keep the work recoverable.** Commit often, with messages a person can follow.

## Deliverables

- **The product,** in one repository, which starts with one command.
- **Replay mode,** which passes the full acceptance test from fixtures alone, with no network.
- **The fixtures,** for the original layout and the changed layout.
- **The input formats,** documented so that a person can record a real scan, tap log and camera run and load them.
- **A stage runbook,** one page: what to set up, what to press at each step of the demo, and what to do when a live input fails.
- **The decision log.**
- **A limits list:** what is not verified, what is fragile, and what you would do next.

## Definition of done

A person who has never seen the code clones the repository, runs one command, and gives the three-minute demo from fixtures by following the runbook. Every rule in "What must be true" holds while that person does it.

## For Frank: fill in, then delete this section

The brief leaves these open because only you know them. Each one changes what the builder can do.

- [ ] **The demo date.** Replace "\[demo date\]" in the Mission section.
- [ ] **Where the builder runs.** The phone scan app can only be compiled on a Mac with Xcode. If the builder runs elsewhere, say that it writes the scan app but cannot compile it.
- [ ] **The devices.** Name the phone that will scan and the phone that will film. If nobody has a LiDAR iPhone, tell the builder to take the scan from photos and a hand correction step.
- [ ] **The repository.** Say where the code goes.
- [ ] **Who records real inputs, and when.** The builder works from fixtures. The first real scan and real run from the team are the first true test of levels 2 and 3.

Two things I left out on purpose. The brief names no libraries or architecture, as you asked. It also leaves out the pitch material: competitors, market numbers and the restaurant outreach stay in the team doc, because a builder does not need them.
