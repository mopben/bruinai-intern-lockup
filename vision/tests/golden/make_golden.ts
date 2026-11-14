/**
 * Golden data for the Python port, made with the repo's own TypeScript.
 *
 *   npx tsx vision/tests/golden/make_golden.ts > vision/tests/golden/golden.json
 *
 * For each bundled fixture it dumps:
 * - the resolved kitchen (footprints, stand points, bounds, worker stands),
 * - the walking legs the menu implies (planItems),
 * - shortest walkable paths between every pair of stand points (shortestPath),
 * - the trips found in positions.jsonl (detectTrips),
 * - synthetic calibrations (box-tops, lens, and box-tops with one bad click),
 *   each with the solved model, per-point errors and projection queries.
 *
 * Read-only: it imports src/ and tools/ and writes only to stdout.
 */
import { resolve } from "node:path";
import { imageToFloorAt, projectAt } from "../../../src/camera/camera-model";
import { solveCalibration } from "../../../src/camera/calibration";
import type { CalibrationFile } from "../../../src/camera/calib-file";
import { kitchenView } from "../../../src/camera/kitchen";
import { shortestPath } from "../../../src/core/path";
import { planItems } from "../../../src/core/plan";
import { detectTrips } from "../../../src/core/trips";
import { resolveWorld } from "../../../src/core/world";
import { loadFixture } from "../../../tools/camera/fixture";
import { buildStaticScene, TRUE_HAT_Y, TRUE_POSE } from "../../../tools/camera/scene";
import { synthCalibration } from "../../../tools/camera/synth-calibration";

const FIXTURES = ["counter-a", "counter-b-fridge-closer", "counter-c-fourth-worker"] as const;
const HEIGHTS = [0, 0.9, 1.63, 1.7, 2.1] as const;
const FIXED_SAVED_AT = "2026-11-14T00:00:00.000Z";
const BAD_CLICK_PX = 40;

function calibrationCase(cal: CalibrationFile) {
  const solved = solveCalibration(cal.pairs, cal.imageSize);
  if (!solved.ok) throw new Error(solved.error);
  const m = solved.value.model;
  const floorQueries = [];
  for (let x = 0.5; x <= 4.0; x += 0.7)
    for (let z = 0.6; z <= 3.4; z += 0.7)
      for (const h of HEIGHTS) floorQueries.push({ floor: { x, z }, h, image: projectAt(m, { x, z }, h) ?? null });
  const imageQueries = [];
  for (let u = 100; u < cal.imageSize.width; u += 270)
    for (let v = 80; v < cal.imageSize.height; v += 160)
      for (const h of HEIGHTS) imageQueries.push({ image: { x: u, y: v }, h, floor: imageToFloorAt(m, { x: u, y: v }, h) ?? null });
  return {
    calibration: { ...cal, savedAt: FIXED_SAVED_AT },
    model: { floorToImage: m.floorToImage, up: m.up, method: m.method, note: m.note },
    errorsCm: solved.value.errorsCm,
    rmsCm: solved.value.rmsCm,
    suspect: solved.value.suspect ?? null,
    floorQueries,
    imageQueries,
  };
}

function withBadClick(cal: CalibrationFile): CalibrationFile {
  const pairs = cal.pairs.map((p, i) => (i === 2 ? { ...p, image: { x: p.image.x + BAD_CLICK_PX, y: p.image.y - BAD_CLICK_PX } } : p));
  return { ...cal, pairs };
}

function fixtureCase(name: string) {
  const run = loadFixture(resolve("fixtures", name));
  const { scan, setup, layout } = run.kitchen;
  const world = resolveWorld(scan, setup, layout);
  const view = kitchenView(run.kitchen);
  if (!view.ok) throw new Error(view.error);
  const plans = [...planItems(world).values()].map((p) => ({
    itemId: p.itemId,
    steps: p.steps.map((s) => ({
      step: s.step,
      stationId: s.stationId,
      legs: [...s.fetchLegs, s.carry].map((l) => ({
        kind: l.kind, fromId: l.fromId, toId: l.toId, oneWayM: l.oneWayM, roundTripM: l.roundTripM, handoff: l.handoff, blocked: l.blocked,
      })),
    })),
  }));
  const scene = buildStaticScene(run.kitchen);
  const base = { clickSigmaPx: 1.5, seed: 11, cameraKey: "file:camera.webm", hatHeights: TRUE_HAT_Y };
  const boxTops = synthCalibration(scene, TRUE_POSE, { ...base, floorPoints: 6, topPoints: 3 });
  const lens = synthCalibration(scene, TRUE_POSE, { ...base, floorPoints: 6, topPoints: 0 });
  return {
    fixture: name,
    kitchen: {
      items: world.items.map((it) => ({ id: it.id, role: it.role, standSide: it.standSide, footprint: it.footprint, stand: it.stand })),
      walls: world.walls.map((w) => ({ id: w.id, footprint: w.footprint })),
      bounds: view.value.bounds,
      stands: view.value.stands,
    },
    plans,
    paths: world.items.flatMap((a) =>
      world.items.filter((b) => b.id !== a.id).map((b) => {
        const p = shortestPath(world.obstacles, a.stand, b.stand);
        return { fromId: a.id, toId: b.id, length: p.length, blocked: p.blocked, points: p.points };
      }),
    ),
    trips: detectTrips(world, run.samples),
    calibrations: {
      boxTops: calibrationCase(boxTops),
      lens: calibrationCase(lens),
      boxTopsBadClick: calibrationCase(withBadClick(boxTops)),
    },
  };
}

process.stdout.write(`${JSON.stringify({ generatedBy: "vision/tests/golden/make_golden.ts", fixtures: FIXTURES.map(fixtureCase) })}\n`);
