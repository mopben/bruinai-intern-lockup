/**
 * Zod schemas for every file format in src/core/types.ts.
 *
 * The schemas mirror the TypeScript interfaces exactly. A compile-time check at
 * the bottom of this file fails the build if a schema and its interface drift.
 */
import { z } from "zod";
import {
  ACTIONS_FORMAT,
  BOXED_ACTION_KINDS,
  FORMAT_VERSION,
  LAYOUT_FORMAT,
  POSITIONS_FORMAT,
  RUN_FORMAT,
  SCAN_FORMAT,
  SETUP_FORMAT,
  TAPS_FORMAT,
  UNBOXED_ACTION_KINDS,
} from "../core/types";
import type {
  ActionSegment,
  ActionsHeader,
  DoneEvent,
  EndEvent,
  Layout,
  OrderEvent,
  PositionSample,
  PositionsHeader,
  RunActions,
  RunBundle,
  RunMeta,
  Scan,
  Setup,
  TapsHeader,
  TaskDef,
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
  capacity: z.number().int("must be a whole number").min(1, "must be 1 or more").optional(),
});

export const stepDefSchema = z.object({
  stationId: id(),
  fetchFrom: z.array(id()).optional(),
  workSeconds: nonNegative().optional(),
});

/** Graph checks (unknown ids, order, steps matching tasks) live in the world resolver and the folder validator. */
export const taskDefSchema = z.object({
  id: id(),
  stationId: id(),
  fetchFrom: z.array(id()).optional(),
  after: z.array(id()).optional(),
});

export const menuItemSchema = z.object({
  id: id(),
  name: z.string(),
  steps: z.array(stepDefSchema).min(1, "a menu item needs at least one step"),
  tasks: z.array(taskDefSchema).min(1, "must list at least one task").optional(),
});

export const workerDefSchema = z.object({
  id: id(),
  name: z.string(),
  color: hexColor(),
  stationId: id(),
  covers: z.array(id()).min(1, "must name at least one station").optional(),
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
// actions.jsonl (optional)
// ---------------------------------------------------------------------------

/** Lowest and highest allowed `confidence`. */
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 1;

export const actionsHeaderSchema = z.object({
  type: z.literal("header"),
  format: z.literal(ACTIONS_FORMAT),
  version: z.literal(FORMAT_VERSION),
  startedAt: isoTime(),
  source: z.enum(["zones", "zones+model"]),
  model: z.string().optional(),
});

const actionFields = {
  type: z.literal("action"),
  workerId: id(),
  t0: nonNegative(),
  t1: nonNegative(),
  label: z.string().optional(),
  confidence: finite()
    .refine((n) => n >= CONFIDENCE_MIN && n <= CONFIDENCE_MAX, `must be between ${CONFIDENCE_MIN} and ${CONFIDENCE_MAX}`)
    .optional(),
};

const laterEnd = (s: { readonly t0: number; readonly t1: number }) => s.t1 > s.t0;
const laterEndIssue = { message: "must be later than t0", path: ["t1"] };

export const boxedActionSchema = z
  .object({ ...actionFields, kind: z.enum(BOXED_ACTION_KINDS), boxId: id() })
  .refine(laterEnd, laterEndIssue);
export const unboxedActionSchema = z
  .object({ ...actionFields, kind: z.enum(UNBOXED_ACTION_KINDS) })
  .refine(laterEnd, laterEndIssue);
const KIND_LIST = '"work", "fetch", "carry", "walk" or "idle"';
export const actionSegmentSchema = z.discriminatedUnion("kind", [boxedActionSchema, unboxedActionSchema], {
  error: `must be ${KIND_LIST}`,
});

type Span = Pick<ActionSegment, "workerId" | "t0" | "t1">;

/**
 * The first pair of one worker's segments that overlap (touching is fine), or
 * undefined. Segments may come in any order.
 */
export function firstOverlap(segments: readonly Span[]): readonly [Span, Span] | undefined {
  const sorted = [...segments].sort((a, b) => a.t0 - b.t0);
  const lastEnd = new Map<string, Span>();
  for (const s of sorted) {
    const prev = lastEnd.get(s.workerId);
    if (prev && s.t0 < prev.t1) return [prev, s];
    if (!prev || s.t1 > prev.t1) lastEnd.set(s.workerId, s);
  }
  return undefined;
}

/** Plain-words text for an overlap found by firstOverlap. */
export function overlapText([a, b]: readonly [Span, Span]): string {
  return `worker "${a.workerId}" does two things at once (t0=${a.t0} to t1=${a.t1} and t0=${b.t0} to t1=${b.t1}). One worker's segments must not overlap.`;
}

export const runActionsSchema = z
  .object({ header: actionsHeaderSchema, segments: z.array(actionSegmentSchema) })
  .superRefine((value, ctx) => {
    const overlap = firstOverlap(value.segments);
    if (overlap) ctx.addIssue({ code: "custom", path: ["segments"], message: overlapText(overlap) });
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
  actions: runActionsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Drift check: each schema's output must be assignable to its interface.
// ---------------------------------------------------------------------------

type Assert<T extends true> = T;
type Fits<S, I> = S extends I ? true : false;
export type SchemaChecks = [
  Assert<Fits<z.infer<typeof scanSchema>, Scan>>,
  Assert<Fits<z.infer<typeof setupSchema>, Setup>>,
  Assert<Fits<z.infer<typeof taskDefSchema>, TaskDef>>,
  Assert<Fits<z.infer<typeof layoutSchema>, Layout>>,
  Assert<Fits<z.infer<typeof tapsHeaderSchema>, TapsHeader>>,
  Assert<Fits<z.infer<typeof orderEventSchema>, OrderEvent>>,
  Assert<Fits<z.infer<typeof doneEventSchema>, DoneEvent>>,
  Assert<Fits<z.infer<typeof endEventSchema>, EndEvent>>,
  Assert<Fits<z.infer<typeof positionsHeaderSchema>, PositionsHeader>>,
  Assert<Fits<z.infer<typeof positionSampleSchema>, PositionSample>>,
  Assert<Fits<z.infer<typeof actionsHeaderSchema>, ActionsHeader>>,
  Assert<Fits<z.infer<typeof actionSegmentSchema>, ActionSegment>>,
  Assert<Fits<z.infer<typeof runActionsSchema>, RunActions>>,
  Assert<Fits<z.infer<typeof runMetaSchema>, RunMeta>>,
  Assert<Fits<z.infer<typeof runBundleSchema>, RunBundle>>,
];
