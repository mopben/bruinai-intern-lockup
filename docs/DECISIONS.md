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
