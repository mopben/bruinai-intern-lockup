/**
 * Zod schemas for the run-folder files, mirroring src/core/types.ts.
 *
 * Built twice: `strict` rejects unknown fields (we report those as warnings,
 * since a typo in an optional field is otherwise silently lost), `loose`
 * drops them and gives the data we check further.
 * A compile-time check at the bottom fails if a schema drifts from its type.
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
  type ActionSegment,
  type ActionsHeader,
  type DoneEvent,
  type EndEvent,
  type Layout,
  type OrderEvent,
  type PositionSample,
  type PositionsHeader,
  type RunMeta,
  type Scan,
  type Setup,
  type TapsHeader,
  type TaskDef,
} from "../../src/core/types";

/** Error text, or "is missing" when the field is absent. */
const e = (msg: string) => (iss: { input?: unknown }) => (iss.input === undefined ? "is missing" : msg);
const num = () => z.number({ error: e("must be a number") }).refine(Number.isFinite, "must be a finite number");
const time = () => num().refine((n) => n >= 0, "must be 0 or more (seconds since the run started)");
const positive = () => num().refine((n) => n > 0, "must be more than 0 (metres)");
const whole = () => z.number({ error: e("must be a number") }).int("must be a whole number");
const text = () => z.string({ error: e("must be text in quotes") });
const id = () => text().min(1, "must not be empty");
const iso = () =>
  text().refine((s) => !Number.isNaN(Date.parse(s)), "must be a date and time like 2026-11-13T10:00:00Z");
const literal = <T extends string | number>(v: T) => z.literal(v, { error: e(`must be ${JSON.stringify(v)}`) });
const oneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: e(`must be one of ${values.map((v) => `"${v}"`).join(", ")}`) });
const CONFIDENCE_MAX = 1;
const confidence = () => num().refine((n) => n >= 0 && n <= CONFIDENCE_MAX, `must be between 0 and ${CONFIDENCE_MAX}`);
const hex = () => text().regex(/^#[0-9a-fA-F]{6}$/, "must be a colour like #e8312f");

export function buildSchemas(strict: boolean) {
  const obj = <S extends z.ZodRawShape>(shape: S) => (strict ? z.strictObject(shape) : z.object(shape));
  const vec3 = obj({ x: num(), y: num(), z: num() });
  const size = obj({ w: positive(), h: positive(), d: positive() });
  const scan = obj({
    format: literal(SCAN_FORMAT),
    version: literal(FORMAT_VERSION),
    units: literal("m"),
    capturedAt: iso(),
    source: oneOf(["roomplan", "manual", "synthetic"]),
    device: text().optional(),
    walls: z.array(obj({ id: id(), center: vec3, size, yaw: num() })),
    boxes: z.array(
      obj({
        id: id(),
        category: text(),
        center: vec3,
        size,
        yaw: num(),
        confidence: oneOf(["low", "medium", "high"]).optional(),
      }),
    ),
  });
  const task = obj({ id: id(), stationId: id(), fetchFrom: z.array(id()).optional(), after: z.array(id()).optional() });
  const setup = obj({
    format: literal(SETUP_FORMAT),
    version: literal(FORMAT_VERSION),
    items: z.array(
      obj({
        boxId: id(),
        name: text(),
        role: oneOf(["station", "storage", "pickup", "queue", "fixture", "ignore"]),
        locked: z.boolean({ error: e("must be true or false") }),
        standSide: oneOf(["front", "back", "left", "right"]).optional(),
        capacity: whole().min(1, "must be 1 or more (people who can work here at once)").optional(),
      }),
    ),
    menu: z.array(
      obj({
        id: id(),
        name: text(),
        steps: z.array(obj({ stationId: id(), fetchFrom: z.array(id()).optional() })).min(1, "needs at least one step"),
        // The graph itself (ids, order, steps matching tasks) is checked in check-tasks.ts.
        tasks: z.array(task).min(1, "must list at least one task").optional(),
      }),
    ),
    pickupId: id(),
    schedule: obj({ orders: z.array(obj({ orderId: id(), itemId: id(), t: time() })) }),
  });
  const layout = obj({
    format: literal(LAYOUT_FORMAT),
    version: literal(FORMAT_VERSION),
    placements: z.record(z.string(), obj({ x: num(), z: num(), yaw: num() })),
    workers: z.array(
      obj({ id: id(), name: text(), color: hex(), stationId: id(), covers: z.array(id()).min(1, "must name at least one station").optional() }),
    ),
  });
  const run = obj({
    format: literal(RUN_FORMAT),
    version: literal(FORMAT_VERSION),
    id: id(),
    title: text(),
    change: text().optional(),
    baseRunId: text().optional(),
    recordedAt: iso(),
    source: oneOf(["synthetic", "recorded"]),
  });
  const tapsHeader = obj({ type: literal("header"), format: literal(TAPS_FORMAT), version: literal(FORMAT_VERSION), startedAt: iso() });
  const order = obj({ type: literal("order"), t: time(), orderId: id(), itemId: id() });
  const done = obj({
    type: literal("done"),
    t: time(),
    orderId: id(),
    step: z.number({ error: e("must be a number") }).int("must be a whole number (0 for the first step)").min(0, "must be 0 or more"),
    stationId: id(),
    workerId: text().optional(),
  });
  const end = obj({ type: literal("end"), t: time() });
  const tapEvent = z.discriminatedUnion("type", [order, done, end], {
    error: e('must be "order", "done" or "end"'),
  });
  const positionsHeader = obj({
    type: literal("header"),
    format: literal(POSITIONS_FORMAT),
    version: literal(FORMAT_VERSION),
    startedAt: iso(),
    hz: num().refine((n) => n > 0, "must be more than 0 (samples per second)"),
  });
  const pos = obj({ type: literal("pos"), t: time(), workerId: id(), x: num(), z: num() });
  const actionsHeader = obj({
    type: literal("header"),
    format: literal(ACTIONS_FORMAT),
    version: literal(FORMAT_VERSION),
    startedAt: iso(),
    source: oneOf(["zones", "zones+model"]),
    model: text().optional(),
  });
  // t1 > t0 and overlaps are checked in check-actions.ts, where the message can name both times.
  const actionFields = { type: literal("action"), workerId: id(), t0: time(), t1: time(), label: text().optional(), confidence: confidence().optional() };
  const action = z.discriminatedUnion(
    "kind",
    [obj({ ...actionFields, kind: z.enum(BOXED_ACTION_KINDS), boxId: id() }), obj({ ...actionFields, kind: z.enum(UNBOXED_ACTION_KINDS) })],
    { error: e('must be "work", "fetch", "carry", "walk" or "idle"') },
  );
  return { scan, task, setup, layout, run, tapsHeader, order, done, end, tapEvent, positionsHeader, pos, actionsHeader, action };
}

export const STRICT = buildSchemas(true);
export const LOOSE = buildSchemas(false);

type Assert<T extends true> = T;
type Fits<S, I> = S extends I ? true : false;
type L = typeof LOOSE;
export type SchemaDriftChecks = [
  Assert<Fits<z.infer<L["scan"]>, Scan>>,
  Assert<Fits<z.infer<L["setup"]>, Setup>>,
  Assert<Fits<z.infer<L["task"]>, TaskDef>>,
  Assert<Fits<z.infer<L["layout"]>, Layout>>,
  Assert<Fits<z.infer<L["run"]>, RunMeta>>,
  Assert<Fits<z.infer<L["tapsHeader"]>, TapsHeader>>,
  Assert<Fits<z.infer<L["order"]>, OrderEvent>>,
  Assert<Fits<z.infer<L["done"]>, DoneEvent>>,
  Assert<Fits<z.infer<L["end"]>, EndEvent>>,
  Assert<Fits<z.infer<L["positionsHeader"]>, PositionsHeader>>,
  Assert<Fits<z.infer<L["pos"]>, PositionSample>>,
  Assert<Fits<z.infer<L["actionsHeader"]>, ActionsHeader>>,
  Assert<Fits<z.infer<L["action"]>, ActionSegment>>,
];
