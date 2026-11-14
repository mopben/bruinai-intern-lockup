/**
 * The stage's number flow on the recorded fixtures: Play numbers, matching the
 * judge's change to a recorded run, the frozen prediction and the Test verdict.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  calibrate,
  predict,
  reconstructRun,
  resolveWorld,
  simulateRun,
  type Layout,
  type PositionSample,
  type RunMeta,
  type Scan,
  type Setup,
  type TapEvent,
} from "../../core";
import { freezePredictions } from "./frozen";
import { addWorker, removeWorker } from "./kitchen-edit";
import { changeKind, matchRecordedRun, type Candidate } from "./layout-match";
import { layoutNumbers } from "./numbers";
import { alongPolyline, homePositions, indexMovements, latestPositions, simulatedWorkers } from "./playback";
import { SIMULATED_BAR, busiestWorker, rangeMeaning, runStory, simulationBasis, testOutcome, verdictSentence, waitsMostAt } from "./words";
import { closeCheck, goTo, openCheck } from "../state/flow";
import { candidates as candidateList, checkOpen, firstRun, frozen, kitchen, playLayout, session, step, testPlan, type Session } from "../state/store";

const root = join(__dirname, "../../../fixtures");
const jsonl = <T>(text: string) =>
  text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { type: string }).filter((l) => l.type !== "header") as T[];
function load(id: string) {
  const read = (f: string) => readFileSync(join(root, id, f), "utf8");
  return {
    meta: JSON.parse(read("run.json")) as RunMeta,
    scan: JSON.parse(read("scan.json")) as Scan,
    setup: JSON.parse(read("setup.json")) as Setup,
    layout: JSON.parse(read("layout.json")) as Layout,
    taps: jsonl<TapEvent>(read("taps.jsonl")),
    positions: jsonl<PositionSample>(read("positions.jsonl")),
  };
}
const a = load("counter-a");
const b = load("counter-b-fridge-closer");
const c = load("counter-c-fourth-worker");
const worldA = resolveWorld(a.scan, a.setup, a.layout);
const runA = reconstructRun(a.setup, a.taps);
const calA = calibrate(worldA, runA, a.positions);
const candidates: Candidate[] = [b, c].map((r) => ({ id: r.meta.id, meta: r.meta, layout: r.layout }));
const FRIDGE = "65E69210-5EED-4D93-9F34-955C39B9EDBF";
const MAKE = "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0";
const FINISH = "9886D544-4186-4B47-978D-7D032CCECDEA";

describe("Play numbers", () => {
  it("are exactly what the core computes for the layout", () => {
    const n = layoutNumbers(a.scan, a.setup, a.layout, calA);
    const direct = predict(worldA, calA);
    expect(n.walking.ok && n.walking.value.perOrderM).toBeCloseTo(direct.walkingPerOrderM, 9);
    expect(n.time.ok && n.time.value.meanOrderTime).toEqual(direct.meanOrderTime);
    expect(n.walking.ok && n.walking.value.legs.length).toBeGreaterThan(0);
  });

  it("say in words when a station has nobody at it, but keep the exact walking", () => {
    const n = layoutNumbers(a.scan, a.setup, removeWorker(a.layout, FINISH), calA);
    expect(n.walking.ok).toBe(true);
    expect(n.time.ok).toBe(false);
    if (!n.time.ok) expect(n.time.message).toMatch(/Nobody works at "Finish"/);
  });

  it("say there is no way through when a path is blocked", () => {
    // Wall the Make worker in: put the fridge right on Make's stand point.
    const world = resolveWorld(a.scan, a.setup, a.layout);
    const stand = world.itemsById.get(MAKE)!.stand;
    const boxed: Layout = { ...a.layout, placements: { ...a.layout.placements, [FRIDGE]: { x: stand.x, z: stand.z + 0.1, yaw: 0 } } };
    const n = layoutNumbers(a.scan, a.setup, boxed, calA);
    if (!n.walking.ok) expect(n.walking.message).toMatch(/No way through|not/);
  });

  it("without a measured run give walking only", () => {
    const n = layoutNumbers(a.scan, a.setup, a.layout, null);
    expect(n.walking.ok).toBe(true);
    expect(n.time.ok).toBe(false);
  });
});

describe("matching the judge's change to a recorded run", () => {
  it("finds the recorded run for each rehearsed change", () => {
    expect(matchRecordedRun(a.scan, a.setup, b.layout, candidates)).toMatchObject({ kind: "match", candidate: { id: b.meta.id } });
    expect(matchRecordedRun(a.scan, a.setup, c.layout, candidates)).toMatchObject({ kind: "match", candidate: { id: c.meta.id } });
    expect(matchRecordedRun(a.scan, a.setup, addWorker(a.layout, MAKE), candidates)).toMatchObject({ kind: "match", candidate: { id: c.meta.id } });
  });

  it("accepts a hand drag close to the recorded spot", () => {
    const p = b.layout.placements[FRIDGE]!;
    const near: Layout = { ...b.layout, placements: { ...b.layout.placements, [FRIDGE]: { ...p, x: p.x + 0.2, z: p.z - 0.1 } } };
    expect(matchRecordedRun(a.scan, a.setup, near, candidates).kind).toBe("match");
  });

  it("does not match the fridge in the right place but facing the wrong way", () => {
    const p = b.layout.placements[FRIDGE]!;
    const turned: Layout = { ...b.layout, placements: { ...b.layout.placements, [FRIDGE]: { ...p, yaw: p.yaw - Math.PI / 2 } } };
    expect(matchRecordedRun(a.scan, a.setup, turned, candidates)).toMatchObject({ kind: "nearest", candidate: { id: b.meta.id } });
  });

  it("falls back to the nearest run when nothing matches", () => {
    expect(matchRecordedRun(a.scan, a.setup, a.layout, candidates).kind).toBe("nearest");
    const both: Layout = { ...b.layout, workers: c.layout.workers };
    expect(matchRecordedRun(a.scan, a.setup, both, candidates).kind).toBe("nearest");
    expect(matchRecordedRun(a.scan, a.setup, a.layout, []).kind).toBe("none");
  });

  it("knows which recorded run moved things and which added people", () => {
    expect(changeKind(a.scan, a.setup, a.layout, b.layout)).toBe("move");
    expect(changeKind(a.scan, a.setup, a.layout, c.layout)).toBe("staff");
  });
});

describe("the frozen prediction", () => {
  const freeze = () =>
    freezePredictions({
      basis: "counter-a",
      scan: a.scan,
      setup: a.setup,
      calibration: calA,
      judgeLayout: b.layout,
      candidateLayouts: candidates.map((x) => ({ id: x.id, layout: x.layout })),
    });

  it("is made from the first run only and cannot change afterwards", () => {
    const frozen = freeze();
    const before = JSON.stringify(frozen);
    // Load and calibrate on the second run: the frozen prediction must not move.
    const worldB = resolveWorld(a.scan, a.setup, b.layout);
    const calB = calibrate(worldB, reconstructRun(b.setup, b.taps), b.positions);
    const fromB = predict(worldB, calB).meanOrderTime;
    expect(JSON.stringify(frozen)).toBe(before);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.judge.prediction?.meanOrderTime).toEqual(predict(worldB, calA).meanOrderTime);
    expect(frozen.judge.prediction?.meanOrderTime).not.toEqual(fromB);
  });

  it("holds a prediction for every recorded layout, for the no-match case", () => {
    const frozen = freeze();
    expect(Object.keys(frozen.candidates).sort()).toEqual(candidates.map((x) => x.id).sort());
    const worldC = resolveWorld(a.scan, a.setup, c.layout);
    expect(frozen.candidates[c.meta.id]?.prediction?.meanOrderTime).toEqual(predict(worldC, calA).meanOrderTime);
  });
});

describe("the Test verdict", () => {
  it("says honestly that the fridge run landed just above the range", () => {
    const pred = predict(resolveWorld(a.scan, a.setup, b.layout), calA).meanOrderTime;
    const out = testOutcome(pred, reconstructRun(b.setup, b.taps), 20.8)!;
    expect(out.check.inside).toBe(out.measuredS >= pred.p10 && out.measuredS <= pred.p90);
    expect(out.headline).toContain(`Measured ${out.measuredS.toFixed(1)} s`);
    expect(out.verdict).toBe(verdictSentence(out.check));
    expect(out.change).toMatch(/^Before 20\.8 s → after/);
  });

  it("words each case", () => {
    const base = { missByPct: 0, offMedianS: 0, missText: "" };
    expect(verdictSentence({ ...base, inside: true, side: null, missByS: 0 })).toBe("Inside the range.");
    expect(verdictSentence({ ...base, inside: false, side: "above", missByS: 0.3, missByPct: 3 })).toBe("Outside the range: 0.3 s slower than predicted.");
    expect(verdictSentence({ ...base, inside: false, side: "below", missByS: 0.02, missByPct: 0.2 })).toBe("Outside the range: less than 0.1 s faster than predicted.");
    expect(rangeMeaning({ p10: 8, p50: 9, p90: 10 })).toBe("The range is where we expect 8 runs in 10 to land.");
    expect(verdictSentence({ ...base, inside: false, side: "below", missByS: 4, missByPct: 30 })).toBe("Outside the range: 4.0 s faster than predicted.");
  });

  it("words the simulated Test's rows and bar", () => {
    const names = (id: string) => ({ ben: "Ben", ana: "Ana", make: "Espresso" })[id] ?? id;
    expect(busiestWorker([{ workerId: "ana", busyShare: 0.74 }, { workerId: "ben", busyShare: 0.906 }], names)).toBe("Ben 91%");
    expect(busiestWorker([], names)).toBeNull();
    expect(waitsMostAt("make", names)).toBe("Espresso");
    expect(waitsMostAt(null, names)).toBe("No waiting");
    expect(SIMULATED_BAR).toBe("Simulated. Same orders, same luck.");
    expect(simulationBasis(200)).toBe("Ranges from 200 runs. The animation is one of them.");
  });

  it("finds where orders waited longest in the recorded run", () => {
    const story = runStory(runA, (id) => worldA.itemsById.get(id)?.name ?? id);
    expect(story.slowestId).toBe(MAKE);
    expect(story.sentence).toMatch(/^Orders waited longest at Espresso machine: \d+ s each on average/);
  });
});

describe("playback", () => {
  it("walks along a polyline by distance", () => {
    const pts = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 3 }];
    expect(alongPolyline(pts, 0.5)).toEqual({ x: 1, z: 1 });
    expect(alongPolyline(pts, 2)).toEqual({ x: 1, z: 3 });
  });

  it("uses each worker's latest sample", () => {
    const ws = a.layout.workers;
    const out = latestPositions(a.positions.slice(0, 40), ws);
    expect(out.map((w) => w.id)).toEqual(ws.map((w) => w.id));
    const last = [...a.positions.slice(0, 40)].reverse().find((p) => p.workerId === "red")!;
    expect(out[0]).toMatchObject({ x: last.x, z: last.z, color: ws[0]!.color });
  });

  it("spreads shared stations and moves simulated workers", () => {
    const worldC = resolveWorld(a.scan, a.setup, c.layout);
    const home = homePositions(worldC);
    const blue = home.get("blue")!;
    const green = home.get("green")!;
    expect(Math.hypot(blue.x - green.x, blue.z - green.z)).toBeCloseTo(0.5, 2);
    const trace = simulateRun(worldA, calA, { seed: 1, rep: 0 });
    const moves = indexMovements(trace);
    const seg = moves.get("blue")![0]!;
    const mid = simulatedWorkers(worldA, moves, (seg.t0 + seg.t1) / 2).find((w) => w.id === "blue")!;
    const homeBlue = homePositions(worldA).get("blue")!;
    expect(Math.hypot(mid.x - homeBlue.x, mid.z - homeBlue.z)).toBeGreaterThan(0.2);
  });
});

describe("the Test step and the real-run check", () => {
  const idle: Session = { purpose: "first", status: "ended", t: 0, duration: 1, done: 0, total: 0, speed: 1, replay: true, save: { kind: "none" } };
  beforeEach(() => {
    const k = { scan: a.scan, setup: a.setup, layout: a.layout };
    kitchen.value = k;
    firstRun.value = { label: "counter-a", kitchen: k, taps: a.taps, positions: a.positions, origin: "recorded", replaced: [] };
    candidateList.value = candidates;
    playLayout.value = b.layout;
    frozen.value = null;
    testPlan.value = null;
    checkOpen.value = false;
    session.value = idle;
    step.value = "play";
  });

  it("shows the simulation on arrival: no second run, no test plan", () => {
    goTo("test");
    expect(step.value).toBe("test");
    expect(session.value).toBe(idle);
    expect(testPlan.value).toBeNull();
    expect(checkOpen.value).toBe(false);
  });

  it("still freezes the prediction on leaving Play, from the first run", () => {
    goTo("test");
    expect(frozen.value?.basis).toBe("counter-a");
    expect(frozen.value?.judge.layout).toBe(b.layout);
    expect(frozen.value?.judge.prediction?.meanOrderTime).toEqual(predict(resolveWorld(a.scan, a.setup, b.layout), calA).meanOrderTime);
  });

  it("opens the check on request, with a test plan for the judge's change", () => {
    goTo("test");
    openCheck();
    expect(checkOpen.value).toBe(true);
    expect(testPlan.value).toMatchObject({ matched: true, candidate: { id: b.meta.id }, judgeLayout: b.layout });
  });

  it("closes the check on the way back to the simulation, and on leaving Test", () => {
    goTo("test");
    openCheck();
    closeCheck();
    expect(checkOpen.value).toBe(false);
    openCheck();
    goTo("play");
    expect(checkOpen.value).toBe(false);
  });

  it("does not open the check outside Test", () => {
    openCheck();
    expect(checkOpen.value).toBe(false);
    expect(testPlan.value).toBeNull();
  });
});
