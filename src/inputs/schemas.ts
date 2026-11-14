/**
 * Zod schemas for every file format in src/core/types.ts.
 *
 * The schemas mirror the TypeScript interfaces exactly. A compile-time check at
 * the bottom of this file fails the build if a schema and its interface drift.
 */
import { z } from "zod";
import {
  FORMAT_VERSION,
  LAYOUT_FORMAT,
  POSITIONS_FORMAT,
  RUN_FORMAT,
  SCAN_FORMAT,
  SETUP_FORMAT,
  TAPS_FORMAT,
} from "../core/types";
import type {
  DoneEvent,
  EndEvent,
  Layout,
  OrderEvent,
  PositionSample,
  PositionsHeader,
  RunBundle,
  RunMeta,
  Scan,
  Setup,
  TapsHeader,
} from "../core/types";

const finite = () => z.number().refine(Number.isFinite, "must be a finite number");
const nonNegative = () => finite().refine((n) => n >= 0, "must be 0 or more");
const positive = () => finite().refine((n) => n > 0, "must be more than 0");
const id = () => z.string().min(1, "must not be empty");
const isoTime = () => z.string().min(1, "must be a date and time, e.g. 2026-11-13T10:00:00Z");
const hexColor = () => z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a colour like #e04a3a");

export const vec3Schema = z.object({ x: finite(), y: finite(), z: finite() });
export const boxSizeSchema = z.object({ w: positive(), h: positive(), d: positive() });

// ---------------------------------------------------------------------------
// scan.json
// ---------------------------------------------------------------------------

export const scanBoxSchema = z.object({
  id: id(),
  category: z.string(),
  center: vec3Schema,
  size: boxSizeSchema,
  yaw: finite(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const scanWallSchema = z.object({
  id: id(),
  center: vec3Schema,
  size: boxSizeSchema,
  yaw: finite(),
});

export const scanSchema = z.object({
  format: z.literal(SCAN_FORMAT),
  version: z.literal(FORMAT_VERSION),
  units: z.literal("m"),
  capturedAt: isoTime(),
  source: z.enum(["roomplan", "manual", "synthetic"]),
  device: z.string().optional(),
  walls: z.array(scanWallSchema),
  boxes: z.array(scanBoxSchema),
});

// ---------------------------------------------------------------------------
// setup.json
// ---------------------------------------------------------------------------

export const itemSetupSchema = z.object({
  boxId: id(),
  name: z.string(),
  role: z.enum(["station", "storage", "pickup", "queue", "fixture", "ignore"]),
  locked: z.boolean(),
  standSide: z.enum(["front", "back", "left", "right"]).optional(),
});

export const stepDefSchema = z.object({
  stationId: id(),
  fetchFrom: z.array(id()).optional(),
});

export const menuItemSchema = z.object({
  id: id(),
  name: z.string(),
  steps: z.array(stepDefSchema).min(1, "a menu item needs at least one step"),
});

export const workerDefSchema = z.object({
  id: id(),
  name: z.string(),
  color: hexColor(),
  stationId: id(),
});

export const scheduledOrderSchema = z.object({ orderId: id(), itemId: id(), t: nonNegative() });

export const orderScheduleSchema = z.object({ orders: z.array(scheduledOrderSchema) });

export const setupSchema = z.object({
  format: z.literal(SETUP_FORMAT),
  version: z.literal(FORMAT_VERSION),
  items: z.array(itemSetupSchema),
  menu: z.array(menuItemSchema),
  pickupId: id(),
  schedule: orderScheduleSchema,
});

// ---------------------------------------------------------------------------
// layout.json
// ---------------------------------------------------------------------------

export const placementSchema = z.object({ x: finite(), z: finite(), yaw: finite() });

export const layoutSchema = z.object({
  format: z.literal(LAYOUT_FORMAT),
  version: z.literal(FORMAT_VERSION),
  placements: z.record(z.string(), placementSchema),
  workers: z.array(workerDefSchema),
});

// ---------------------------------------------------------------------------
// taps.jsonl
// ---------------------------------------------------------------------------

export const tapsHeaderSchema = z.object({
  type: z.literal("header"),
  format: z.literal(TAPS_FORMAT),
  version: z.literal(FORMAT_VERSION),
  startedAt: isoTime(),
});

export const orderEventSchema = z.object({
  type: z.literal("order"),
  t: nonNegative(),
  orderId: id(),
  itemId: id(),
});

export const doneEventSchema = z.object({
  type: z.literal("done"),
  t: nonNegative(),
  orderId: id(),
  step: z.number().int("must be a whole number").min(0, "must be 0 or more"),
  stationId: id(),
  workerId: z.string().optional(),
});

export const endEventSchema = z.object({ type: z.literal("end"), t: nonNegative() });

export const tapEventSchema = z.discriminatedUnion("type", [orderEventSchema, doneEventSchema, endEventSchema]);

// ---------------------------------------------------------------------------
// positions.jsonl
// ---------------------------------------------------------------------------

export const positionsHeaderSchema = z.object({
  type: z.literal("header"),
  format: z.literal(POSITIONS_FORMAT),
  version: z.literal(FORMAT_VERSION),
  startedAt: isoTime(),
  hz: positive(),
});

export const positionSampleSchema = z.object({
  type: z.literal("pos"),
  t: nonNegative(),
  workerId: id(),
  x: finite(),
  z: finite(),
});

// ---------------------------------------------------------------------------
// run.json
// ---------------------------------------------------------------------------

export const runMetaSchema = z.object({
  format: z.literal(RUN_FORMAT),
  version: z.literal(FORMAT_VERSION),
  id: id(),
  title: z.string(),
  change: z.string().optional(),
  baseRunId: z.string().optional(),
  recordedAt: isoTime(),
  source: z.enum(["synthetic", "recorded"]),
});

/** A whole run in one JSON value, as POSTed to /api/recordings. */
export const runBundleSchema = z.object({
  meta: runMetaSchema,
  scan: scanSchema,
  setup: setupSchema,
  layout: layoutSchema,
  taps: z.array(tapEventSchema),
  positions: z.array(positionSampleSchema),
});

// ---------------------------------------------------------------------------
// Drift check: each schema's output must be assignable to its interface.
// ---------------------------------------------------------------------------

type Assert<T extends true> = T;
type Fits<S, I> = S extends I ? true : false;
export type SchemaChecks = [
  Assert<Fits<z.infer<typeof scanSchema>, Scan>>,
  Assert<Fits<z.infer<typeof setupSchema>, Setup>>,
  Assert<Fits<z.infer<typeof layoutSchema>, Layout>>,
  Assert<Fits<z.infer<typeof tapsHeaderSchema>, TapsHeader>>,
  Assert<Fits<z.infer<typeof orderEventSchema>, OrderEvent>>,
  Assert<Fits<z.infer<typeof doneEventSchema>, DoneEvent>>,
  Assert<Fits<z.infer<typeof endEventSchema>, EndEvent>>,
  Assert<Fits<z.infer<typeof positionsHeaderSchema>, PositionsHeader>>,
  Assert<Fits<z.infer<typeof positionSampleSchema>, PositionSample>>,
  Assert<Fits<z.infer<typeof runMetaSchema>, RunMeta>>,
  Assert<Fits<z.infer<typeof runBundleSchema>, RunBundle>>,
];
