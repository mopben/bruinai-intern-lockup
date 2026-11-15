# Dry Run file formats

This page is for anyone who records a real run (a scan, the taps and the camera positions) and wants Dry Run to load it. You do not need to read any code.

The examples come from the bundled run `fixtures/counter-a`. Open those files next to this page. They are the best working example.

## The run folder

One run is one folder with six files, and sometimes a seventh:

```
fixtures/counter-a/
  run.json          what this run is
  scan.json         the room: walls and boxes, with sizes and positions
  setup.json        the owner's corrections: names, roles, the menu, the order schedule
  layout.json       where each box stands and who works where
  taps.jsonl        orders shown on the tablet and "done" taps
  positions.jsonl   where each worker was, about 10 times a second
  actions.jsonl     optional: what each worker was doing, and when
```

The first six files must be there. `actions.jsonl` is optional: a folder without it loads exactly the same. The folder name should match the `id` in `run.json`.

**Where to put it.** Runs bundled with the product live in `fixtures/<id>/`. When the product records a live run, the server saves it to `recordings/<id>/` in exactly this format. You can copy a folder from `recordings/` to `fixtures/` to bundle it.

**Two kinds of file.**

- `.json` files hold one JSON object. Line breaks and indentation do not matter.
- `.jsonl` files hold one JSON object **per line**. The first line is a header. Do not spread one object over several lines. Blank lines are ignored.

## Coordinates, units and time

- **Units.** Metres, seconds and radians. Never centimetres, milliseconds or degrees.
- **Floor frame.** The scan decides it. `x` runs to the right, `z` runs toward the viewer, `y` is up. A point on the floor is `x` and `z`. Positions from the camera must use the same frame as the scan.
- **Box size.** `w` runs along the box's own x axis, `d` along its own z axis, `h` is the height.
- **Box centre.** `center.y` is half the height for a box standing on the floor.
- **Time.** Every `t` is seconds since the run started. The header's `startedAt` says when that was, as a date and time like `2026-11-12T15:10:05.000Z`.

**Yaw.** Yaw turns a box about the vertical axis. A box's **front** is its own +z side. At `yaw = 0` the front faces world +z (toward the viewer). Seen from above, a positive yaw turns the box counter-clockwise.

```
  Seen from above (back wall at the top)

        back wall (z = 0)
   +---------------------------------> x
   |
   |    yaw = 0          yaw = +1.5708 (+90 degrees)
   |    +------+         +---+
   |    |      |         |   |
   |    +------+         |   |-> front faces +x
   |       |             +---+
   |       v front faces +z
   v
   z (toward the viewer)
```

Common yaws: `0` front faces +z, `1.5708` faces +x, `3.1416` faces -z, `-1.5708` faces -x.

**Sides.** `front` is the box's +z side, `back` its -z side, `right` its +x side, `left` its -x side. A person using a box stands 0.35 m out from the middle of one side.

## run.json

```json
{
  "format": "dryrun.run",
  "version": 1,
  "id": "counter-b-fridge-closer",
  "title": "Fridge next to the espresso machine",
  "change": "The milk fridge moved from the left wall to just behind the espresso machine worker.",
  "baseRunId": "counter-a",
  "recordedAt": "2026-11-12T15:17:40.000Z",
  "source": "synthetic"
}
```

| Field | Meaning |
| --- | --- |
| `format`, `version` | Always `"dryrun.run"` and `1`. |
| `id` | Short name, same as the folder name. |
| `title` | What a person sees in the list of runs. |
| `change` | Optional. In plain words, what differs from the base run. |
| `baseRunId` | Optional. The `id` of the run this one changes. |
| `recordedAt` | When the run was recorded. |
| `source` | `"recorded"` for a real run. `"synthetic"` for a generated one, like the bundled fixtures. |

## scan.json

The room as boxes. The iPhone scan app writes this file. You can also write it by hand.

```json
{
  "format": "dryrun.scan",
  "version": 1,
  "units": "m",
  "capturedAt": "2026-11-12T15:02:41Z",
  "source": "synthetic",
  "walls": [
    { "id": "0ECE41AB-1A9F-4ED5-B64B-40AB0E3FFBD4",
      "center": { "x": 2.2572, "y": 1.2348, "z": -0.0457 },
      "size": { "w": 4.5274, "h": 2.4388, "d": 0.093 },
      "yaw": 0.004 }
  ],
  "boxes": [
    { "id": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
      "category": "storage",
      "center": { "x": 2.0565, "y": 0.4679, "z": 0.3188 },
      "size": { "w": 0.7135, "h": 0.9273, "d": 0.614 },
      "yaw": 0.0104,
      "confidence": "high" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `units` | Always `"m"`. |
| `source` | `"roomplan"` from the scan app, `"manual"` if you wrote it by hand, `"synthetic"` if generated. |
| `device` | Optional. The device that scanned, e.g. `"iPhone 15 Pro"`. |
| `walls` | Walls. `size.w` is the length, `size.h` the height, `size.d` the thickness (more than 0). |
| `boxes[].id` | Any unique text. The scan app writes `box-1`, `box-2`, ... and walls `wall-1`, ...; the bundled runs use UUIDs. Other files refer to boxes by this id. |
| `boxes[].category` | What the scanner called it: `table`, `storage`, `refrigerator`, `sink`, `chair`, `unknown` and so on. The scanner knows no café equipment, so an espresso machine on a counter may come out as `storage`. You fix that in `setup.json`, not here. |
| `boxes[].confidence` | Optional. `"low"`, `"medium"` or `"high"`. |

Every size must be more than 0. A floor mark, such as the queue line taped on the floor, is a box with a tiny height (the bundled runs use 2 cm).

## setup.json

The owner's corrections and the process: what each box really is, the menu, the pickup, and the order schedule.

```json
{
  "format": "dryrun.setup",
  "version": 1,
  "items": [
    { "boxId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0", "name": "Espresso machine",
      "role": "station", "locked": true, "standSide": "front" },
    { "boxId": "65E69210-5EED-4D93-9F34-955C39B9EDBF", "name": "Milk fridge",
      "role": "storage", "locked": false, "standSide": "front" }
  ],
  "menu": [
    { "id": "latte", "name": "Latte",
      "steps": [
        { "stationId": "61A93A22-761D-47DF-BC5F-5EB3A7D8334A" },
        { "stationId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
          "fetchFrom": ["65E69210-5EED-4D93-9F34-955C39B9EDBF"] },
        { "stationId": "9886D544-4186-4B47-978D-7D032CCECDEA" }
      ] }
  ],
  "pickupId": "81C9EBC2-31C1-4C98-879A-0EAB5851BF60",
  "schedule": { "orders": [
    { "orderId": "o1", "itemId": "latte", "t": 1.37 },
    { "orderId": "o2", "itemId": "latte", "t": 6.78 }
  ] }
}
```

**`items`**: one entry per scanned box.

| Field | Meaning |
| --- | --- |
| `boxId` | The box's `id` from `scan.json`. Copy it exactly. |
| `name` | The owner's name for it. |
| `role` | `station` (a worker stands here and does a step), `storage` (workers fetch from it, e.g. a fridge), `pickup` (finished orders go here), `queue` (where customers wait; shown, not simulated), `fixture` (takes up floor, e.g. a sink), `ignore` (scan noise; hidden, does not block walking). |
| `locked` | `true` if it depends on plumbing or power and cannot be dragged. |
| `standSide` | Optional, default `"front"`. Which side a person stands at to use it. |
| `capacity` | Optional, stations only. How many people can work here at once: a whole number, 1 or more. Default: no limit. |

A scanned box with no entry in `items` is treated as a fixture.

**`capacity`**: a station with one espresso machine fits one person, however many stand near it:

```json
{ "boxId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0", "name": "Espresso machine",
  "role": "station", "locked": true, "capacity": 1 }
```

**`menu`**: the items you can order. Each step happens at a station. `fetchFrom` is optional: storage boxes the worker walks to and back from, once each, before working. Steps are numbered from 0. After the last step the item is carried to the pickup. `workSeconds` is optional: a work time in seconds that the owner typed for this step. The simulator then uses that time as it is for this step, not the measured times, and the station needs no measured times for it.

**`tasks`** (optional, per menu item): which steps must be done before which. Without it, `steps` is a chain: step k comes after step k−1. With it, `tasks[k]` describes `steps[k]`, and a tap's `step` is still the index in the list.

```json
{ "id": "latte", "name": "Latte",
  "steps": [
    { "stationId": "61A93A22-761D-47DF-BC5F-5EB3A7D8334A" },
    { "stationId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
      "fetchFrom": ["65E69210-5EED-4D93-9F34-955C39B9EDBF"] },
    { "stationId": "9886D544-4186-4B47-978D-7D032CCECDEA" }
  ],
  "tasks": [
    { "id": "take", "stationId": "61A93A22-761D-47DF-BC5F-5EB3A7D8334A" },
    { "id": "brew", "stationId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
      "fetchFrom": ["65E69210-5EED-4D93-9F34-955C39B9EDBF"] },
    { "id": "finish", "stationId": "9886D544-4186-4B47-978D-7D032CCECDEA", "after": ["take", "brew"] }
  ] }
```

These are the boxes of the latte example above: the till, the espresso machine (with milk from the fridge) and the finish counter. Here taking the order and brewing both start when the order appears, and finishing waits for both. Taps for `take` and `brew` may come in either order; a tap for `finish` must come after both.

| Field | Meaning |
| --- | --- |
| `tasks[].id` | Short text, unique in the menu item. |
| `tasks[].stationId` | Must be the same as `steps[k].stationId`. |
| `tasks[].fetchFrom` | Must be the same list as `steps[k].fetchFrom`. |
| `tasks[].after` | Optional. Ids of tasks that must be done first. Each must come earlier in the list. Empty or missing: the task starts when the order appears. |

A task may wait for several tasks, but at most one task may name it in `after`. A task that no other task names carries its output to the pickup. `tasks` and `steps` must have the same length.

**`schedule`**: when each order appears on the tablet, in seconds from the start. Keep it in time order. The stage releases orders from this list, so `taps.jsonl` should show the same orders at the same times.

## layout.json

Where every box stands and who works where. A changed run (a box dragged, a worker added) differs from its base run only here.

```json
{
  "format": "dryrun.layout",
  "version": 1,
  "placements": {
    "65E69210-5EED-4D93-9F34-955C39B9EDBF": { "x": 1.8062, "z": 1.9745, "yaw": 3.1395 }
  },
  "workers": [
    { "id": "red", "name": "Ana", "color": "#e8312f", "stationId": "61A93A22-761D-47DF-BC5F-5EB3A7D8334A" },
    { "id": "blue", "name": "Ben", "color": "#1f6fe0", "stationId": "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `placements` | Keyed by box id. The box's floor centre `x`, `z` and its `yaw`. A box with no entry sits where the scan put it. |
| `workers[].id` | Short unique text. `taps.jsonl` and `positions.jsonl` use the same id. |
| `workers[].color` | The hat colour as `#rrggbb`. It is also the dot colour and what the camera looks for. Pick colours far apart in hue: the bundled runs use red `#e8312f`, blue `#1f6fe0`, yellow `#f5c400` and green `#1fa84f`. |
| `workers[].stationId` | The station this person works at. Two people may share a station. |
| `workers[].covers` | Optional. The stations this person may work at, at least one id. `stationId` is always one of them: it is the home station, where the person waits with nothing to do. Default: only `stationId`. |

Every station used by the menu needs at least one worker whose `stationId` or `covers` names it.

**`covers`**: a person who takes orders and also pulls shots when the till is quiet:

```json
{ "id": "red", "name": "Ana", "color": "#e8312f", "stationId": "61A93A22-761D-47DF-BC5F-5EB3A7D8334A",
  "covers": ["98EA7E27-B557-42A2-9AE3-1C7A609FDAC0"] }
```

## taps.jsonl

Line 1 is the header. Then one line per event, in time order. The last line is `end`.

```
{"type":"header","format":"dryrun.taps","version":1,"startedAt":"2026-11-12T15:10:05.000Z"}
{"type":"order","t":1.37,"orderId":"o1","itemId":"latte"}
{"type":"done","t":2.829,"orderId":"o1","step":0,"stationId":"61A93A22-761D-47DF-BC5F-5EB3A7D8334A","workerId":"red"}
{"type":"order","t":6.78,"orderId":"o2","itemId":"latte"}
{"type":"done","t":11.261,"orderId":"o1","step":1,"stationId":"98EA7E27-B557-42A2-9AE3-1C7A609FDAC0","workerId":"blue"}
{"type":"end","t":88.584}
```

| Line | Meaning |
| --- | --- |
| `order` | An order appeared on the tablet at `t`. `orderId` and `itemId` match the schedule and the menu. |
| `done` | A worker tapped "done" for step `step` (from 0) of order `orderId`. `stationId` is the station of that step. `workerId` is optional. |
| `end` | The run ended at `t`. At most one, and nothing may come after it. If it is missing, the run ends at the last tap. |

Each order's steps are tapped in order: step 0, then 1, then 2. For an item with `tasks`, a step is tapped after the steps in its `after` list, and steps that do not wait for each other may come in any order. Each step is tapped once.

## positions.jsonl

Line 1 is the header, with `hz`, the nominal samples per second per worker. Then one line per worker per camera frame.

```
{"type":"header","format":"dryrun.positions","version":1,"startedAt":"2026-11-12T15:10:05.000Z","hz":10}
{"type":"pos","t":0,"workerId":"red","x":1.161,"z":1.016}
{"type":"pos","t":0,"workerId":"blue","x":2.068,"z":1.016}
{"type":"pos","t":0.104,"workerId":"red","x":1.152,"z":1.027}
```

`x` and `z` are where the worker stood, in metres, in the scan's floor frame. Missing frames are fine: leave the line out. A few centimetres of noise is normal.

## actions.jsonl (optional)

What each worker was doing, and when: working at a station, fetching from a fridge, carrying an order, walking or standing. The video pipeline writes this file from a filmed run, next to the `positions.jsonl` it makes from the same video. You do not need it: leave it out and the folder loads as before. The bundled runs do not have one.

Line 1 is the header. Then one line per segment: one worker doing one thing from `t0` to `t1`.

```
{"type":"header","format":"dryrun.actions","version":1,"startedAt":"2026-11-12T15:10:05.000Z","source":"zones"}
{"type":"action","workerId":"red","t0":1.4,"t1":2.8,"kind":"work","boxId":"61A93A22-761D-47DF-BC5F-5EB3A7D8334A"}
{"type":"action","workerId":"blue","t0":2.9,"t1":7.1,"kind":"fetch","boxId":"65E69210-5EED-4D93-9F34-955C39B9EDBF"}
{"type":"action","workerId":"blue","t0":7.1,"t1":11.2,"kind":"work","boxId":"98EA7E27-B557-42A2-9AE3-1C7A609FDAC0","label":"steaming milk","confidence":0.71}
```

**Header.**

| Field | Meaning |
| --- | --- |
| `startedAt` | When the run started. The same as in `taps.jsonl` and `positions.jsonl`. |
| `source` | `"zones"` if the actions come from the positions alone. `"zones+model"` if a model also added labels. |
| `model` | Optional. The name of the model that added labels. |

**Segments.**

| Field | Meaning |
| --- | --- |
| `workerId` | A worker `id` from `layout.json`. |
| `t0`, `t1` | When the segment starts and ends, in seconds since the run started (the same clock as taps and positions). `t1` must be more than `t0`. |
| `kind` | What the worker was doing. See below. |
| `boxId` | The box it was done at, from `scan.json`. Needed for `work`, `fetch` and `carry`. Left out for `walk` and `idle`. |
| `label` | Optional. A model's words for it, e.g. `"steaming milk"`. |
| `confidence` | Optional. How sure the model was, from `0` to `1`. Written together with `label`. |

| `kind` | Meaning | `boxId` |
| --- | --- | --- |
| `work` | Standing still at a station's stand point. | That station. |
| `fetch` | A round trip from a station to a storage box and back. | The storage box. |
| `carry` | A trip to the pickup or to another station. | Where it went: the pickup or a station. |
| `walk` | Moving, but not on a trip the product knows. | None. |
| `idle` | Standing still away from any stand point. | None. |

One worker's segments must not overlap. One may start exactly when the last one ends. Gaps are fine: nobody knew what the worker was doing then. Keep the file in order of `t0`.

## Checking a folder

Run the validator from the repository folder:

```
npx tsx tools/world/validate.ts fixtures/my-run
```

You can name several folders at once. It checks `actions.jsonl` too when the folder has one. It prints `OK` or a list of problems, each with the file, the line and what to do:

```
NOT OK: fixtures/my-run has 2 problems to fix.

Errors (must fix):
  taps.jsonl line 3: field "type" must be "order", "done" or "end"
  taps.jsonl line 5: field "orderId" is missing

Warnings (worth a look):
  taps.jsonl line 5: has unknown field "orderid"; it is ignored (check the spelling)
```

**Errors** mean the product cannot load the folder. **Warnings** mean it can, but something looks wrong. Examples are a missing tap, a typo in a field name, a hat colour close to another, or a track that jumps. The exit code is 1 if any folder has errors.

Run it after every hand edit.

## Fixing a file by hand

Use a plain text editor. Keep each `.jsonl` object on one line.

- **A tap on the wrong step or station.** Change `step` and `stationId` to match the menu. The validator tells you which station each step needs.
- **A double tap.** Delete the second `done` line for that order and step.
- **A missed tap.** Add a `done` line with your best estimate of `t`. Put it between the lines before and after that time.
- **The run ran on after the last order.** Change the `end` line's `t`. Delete any tap lines after it.
- **A wrong hat colour or worker name.** Change it in `layout.json`. Keep the worker `id` the same in all files.
- **A scanned box is noise.** Give it `"role": "ignore"` in `setup.json`. Do not delete it from `scan.json`.
- **A box is in the wrong place.** Change its entry in `placements` in `layout.json`, not `scan.json`.

**Trimming the start.** Say the recording started 4.2 s before anything happened. Subtract 4.2 from every `t` in both `.jsonl` files and from every `t` in the `setup.json` schedule. Add 4.2 s to both `startedAt` values. If the folder has an `actions.jsonl`, subtract 4.2 from every `t0` and `t1` and add 4.2 s to its `startedAt` too; the command below does not do that file. Only trim time before the first order. This command does the `.jsonl` part and drops lines that would fall before 0:

```
cd fixtures/my-run
for f in taps.jsonl positions.jsonl; do
  node -e 'const fs=require("fs");const [file,cut]=process.argv.slice(1);const out=fs.readFileSync(file,"utf8").split("\n").filter(l=>l.trim()).map(l=>{const o=JSON.parse(l);if(o.type==="header")return l;o.t=Math.round((o.t-Number(cut))*1000)/1000;return o.t<0?null:JSON.stringify(o)}).filter(Boolean);fs.writeFileSync(file,out.join("\n")+"\n")' $f 4.2
done
```

Then fix the schedule in `setup.json` by hand and run the validator.

## Common mistakes

- **Degrees instead of radians.** A yaw of `90` is wrong. Write `1.5708`.
- **Centimetres instead of metres.** A table `"w": 120` is wrong. Write `1.2`.
- **Milliseconds or clock times for `t`.** `t` is seconds since the start: `12.5`, not `12500` or `"15:10:17"`.
- **Ids that do not match.** Box ids in `setup.json` and `layout.json`, `stationId` in taps and `boxId` in actions, must be copied exactly from `scan.json`. Worker ids must match between `layout.json`, `taps.jsonl`, `positions.jsonl` and `actions.jsonl`.
- **Steps counted from 1.** The first step is `0`.
- **No header line**, or a header that is not the first line of a `.jsonl` file.
- **Pretty-printed `.jsonl`.** One object per line, always.
- **A trailing comma** after the last field or item. JSON does not allow it.
- **Positions in the camera's frame**, not the scan's. If the dots are mirrored, swapped or offset, redo the camera's four-point calibration against the scan.
- **Hat colours too close**, such as orange and red. The camera can mix them up.
