/**
 * Shared contracts for Dry Run. Every part of the product imports from here.
 *
 * Conventions
 * - Units: metres, seconds, radians.
 * - Floor frame: x to the right, z toward the viewer, y up. Floor logic uses Vec2 {x, z}.
 * - `yaw` is a rotation about the y axis. yaw = 0 means the box's local +z ("front") faces world +z.
 * - Times `t` in logs are seconds since the start of the run.
 * - All values are immutable. Never mutate; return new objects.
 *
 * The three real-world inputs are Scan, TapEvent and PositionSample.
 * File forms are documented for humans in docs/FORMATS.md.
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** w runs along the box's local x axis, h is up, d runs along local z. */
export interface BoxSize {
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

// ---------------------------------------------------------------------------
// Input 1: the scan (scan.json)
// ---------------------------------------------------------------------------

export const SCAN_FORMAT = "dryrun.scan" as const;
export const FORMAT_VERSION = 1 as const;

export type ScanSource = "roomplan" | "manual" | "synthetic";

/** One detected object. `category` is what the scanner called it (RoomPlan has no café types). */
export interface ScanBox {
  readonly id: string;
  /** Scanner label, e.g. "table", "storage", "refrigerator", "sink", "unknown". */
  readonly category: string;
  /** Centre of the box. center.y is half the height for an object standing on the floor. */
  readonly center: Vec3;
  readonly size: BoxSize;
  readonly yaw: number;
  readonly confidence?: "low" | "medium" | "high";
}

export interface ScanWall {
  readonly id: string;
  readonly center: Vec3;
  /** w is the wall length, h its height, d its thickness. */
  readonly size: BoxSize;
  readonly yaw: number;
}

export interface Scan {
  readonly format: typeof SCAN_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly units: "m";
  readonly capturedAt: string;
  readonly source: ScanSource;
  readonly device?: string;
  readonly walls: readonly ScanWall[];
  readonly boxes: readonly ScanBox[];
}

// ---------------------------------------------------------------------------
// Setup: the owner's corrections and the process (setup.json)
// ---------------------------------------------------------------------------

export const SETUP_FORMAT = "dryrun.setup" as const;

/**
 * What a scanned box is in the kitchen.
 * - station: a worker stands here and does a step.
 * - storage: workers fetch from here (fridge, ingredient shelf).
 * - pickup: where finished orders are handed over.
 * - queue: where customers wait. Shown, not simulated.
 * - fixture: anything else that takes up floor (sink, hood). Blocks walking.
 * - ignore: scan noise. Hidden and does not block walking.
 */
export type ItemRole = "station" | "storage" | "pickup" | "queue" | "fixture" | "ignore";

export type BoxSide = "front" | "back" | "left" | "right";

export interface ItemSetup {
  readonly boxId: string;
  /** The owner's name for the box, e.g. "Espresso machine". */
  readonly name: string;
  readonly role: ItemRole;
  /** Locked items depend on plumbing or power and cannot be dragged. */
  readonly locked: boolean;
  /** Side of the box where a person stands to use it. Default "front" (local +z). */
  readonly standSide?: BoxSide;
  /** Stations only: how many people can work here at once, a whole number of at least 1. Default: no limit. */
  readonly capacity?: number;
}

/** One step of making a menu item. */
export interface StepDef {
  /** Explicit preparation time in seconds; otherwise use measured station times. */
  readonly workSeconds?: number;
  /** boxId of the station where the step happens. */
  readonly stationId: string;
  /** boxIds of storage the worker walks to and back from, once each, before working. */
  readonly fetchFrom?: readonly string[];
}

/**
 * One task of making a menu item, in an item's optional task graph.
 * A task is ready when every task in `after` is done and its output has arrived here.
 * A task may wait for several tasks (a join) but feeds at most one, so an output never splits.
 */
export interface TaskDef {
  /** Unique within the menu item. */
  readonly id: string;
  /** boxId of the station where the task happens. */
  readonly stationId: string;
  /** boxIds of storage the worker walks to and back from, once each, before working. */
  readonly fetchFrom?: readonly string[];
  /** ids of tasks that must be done first; each must come earlier in the list. Empty: starts on release. */
  readonly after?: readonly string[];
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  /** Steps in order. After the last step the item is carried to the pickup. */
  readonly steps: readonly StepDef[];
  /**
   * Optional task graph. Without it, `steps` is a chain. With it, `steps[k]` names the same
   * station and storage as `tasks[k]`, and a tap's `step` is the index in this list.
   */
  readonly tasks?: readonly TaskDef[];
}

export interface WorkerDef {
  readonly id: string;
  readonly name: string;
  /** Hat colour as #rrggbb. Also the dot colour on screen and the tracker's target. */
  readonly color: string;
  /** boxId of the station this worker stands at. Several workers may share a station. */
  readonly stationId: string;
  /** Stations this worker may work at. `stationId` (home) is always one of them. Default: only `stationId`. */
  readonly covers?: readonly string[];
}

/** When orders are released during a run. The product generates this; it is known in advance. */
export interface OrderSchedule {
  readonly orders: readonly { readonly orderId: string; readonly itemId: string; readonly t: number }[];
}

export interface Setup {
  readonly format: typeof SETUP_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly items: readonly ItemSetup[];
  readonly menu: readonly MenuItem[];
  /** boxId of the pickup point. */
  readonly pickupId: string;
  readonly schedule: OrderSchedule;
}

// ---------------------------------------------------------------------------
// Layout: the things a person can change (layout.json)
// ---------------------------------------------------------------------------

export const LAYOUT_FORMAT = "dryrun.layout" as const;

export interface Placement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * Where every box is and who works where. The scan gives the starting layout.
 * Dragging a station or adding a worker produces a new Layout; nothing else changes.
 */
export interface Layout {
  readonly format: typeof LAYOUT_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  /** Keyed by boxId. A box with no entry sits where the scan put it. */
  readonly placements: Readonly<Record<string, Placement>>;
  readonly workers: readonly WorkerDef[];
}

// ---------------------------------------------------------------------------
// Input 2: the taps (taps.jsonl, one JSON object per line)
// ---------------------------------------------------------------------------

export const TAPS_FORMAT = "dryrun.taps" as const;

export interface TapsHeader {
  readonly type: "header";
  readonly format: typeof TAPS_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly startedAt: string;
}

/** An order appeared on the tablet. */
export interface OrderEvent {
  readonly type: "order";
  readonly t: number;
  readonly orderId: string;
  readonly itemId: string;
}

/** A worker tapped "done" for one step of one order. */
export interface DoneEvent {
  readonly type: "done";
  readonly t: number;
  readonly orderId: string;
  /** Index into the menu item's steps. */
  readonly step: number;
  readonly stationId: string;
  readonly workerId?: string;
}

export interface EndEvent {
  readonly type: "end";
  readonly t: number;
}

export type TapEvent = OrderEvent | DoneEvent | EndEvent;
export type TapsLine = TapsHeader | TapEvent;

// ---------------------------------------------------------------------------
// Input 3: the positions (positions.jsonl, one JSON object per line)
// ---------------------------------------------------------------------------

export const POSITIONS_FORMAT = "dryrun.positions" as const;

export interface PositionsHeader {
  readonly type: "header";
  readonly format: typeof POSITIONS_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly startedAt: string;
  /** Nominal samples per second per worker. */
  readonly hz: number;
}

/** Where one worker stood at time t, in the scan's floor frame. */
export interface PositionSample {
  readonly type: "pos";
  readonly t: number;
  readonly workerId: string;
  readonly x: number;
  readonly z: number;
}

export type PositionsLine = PositionsHeader | PositionSample;

// ---------------------------------------------------------------------------
// Optional: what each worker was doing (actions.jsonl, one JSON object per line)
// Written by the video pipeline from the positions; a run folder may leave it out.
// ---------------------------------------------------------------------------

export const ACTIONS_FORMAT = "dryrun.actions" as const;

/** "zones": inferred from positions only. "zones+model": an ML model added labels. */
export type ActionsSource = "zones" | "zones+model";

export interface ActionsHeader {
  readonly type: "header";
  readonly format: typeof ACTIONS_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly startedAt: string;
  readonly source: ActionsSource;
  /** Names the labeller, if a model added labels. */
  readonly model?: string;
}

/** Kinds that name a box: work at a station, fetch from storage, carry to the pickup or a station. */
export const BOXED_ACTION_KINDS = ["work", "fetch", "carry"] as const;
/** Kinds with no box: moving on no known trip, or standing away from any stand point. */
export const UNBOXED_ACTION_KINDS = ["walk", "idle"] as const;

export type BoxedActionKind = (typeof BOXED_ACTION_KINDS)[number];
export type UnboxedActionKind = (typeof UNBOXED_ACTION_KINDS)[number];
export type ActionKind = BoxedActionKind | UnboxedActionKind;

/** Box roles each boxed kind may name. */
export const ACTION_BOX_ROLES: Readonly<Record<BoxedActionKind, readonly ItemRole[]>> = {
  work: ["station"],
  fetch: ["storage"],
  carry: ["pickup", "station"],
};

interface ActionBase {
  readonly type: "action";
  readonly workerId: string;
  /** Start, seconds since the run started. */
  readonly t0: number;
  /** End, seconds since the run started; later than t0. */
  readonly t1: number;
  /** Free text from the ML labeller. Written together with confidence. */
  readonly label?: string;
  /** 0 to 1, from the ML labeller. */
  readonly confidence?: number;
}

export interface BoxedAction extends ActionBase {
  readonly kind: BoxedActionKind;
  /** work: the station. fetch: the storage box. carry: the destination. */
  readonly boxId: string;
}

export interface UnboxedAction extends ActionBase {
  readonly kind: UnboxedActionKind;
}

/** One stretch of time in which one worker did one thing. */
export type ActionSegment = BoxedAction | UnboxedAction;
export type ActionsLine = ActionsHeader | ActionSegment;

/** actions.jsonl as loaded: the header (source, model) and the segments sorted by t0. */
export interface RunActions {
  readonly header: ActionsHeader;
  readonly segments: readonly ActionSegment[];
}

// ---------------------------------------------------------------------------
// A recorded run: one folder holding everything above
// ---------------------------------------------------------------------------

export const RUN_FORMAT = "dryrun.run" as const;

/**
 * run.json: describes a run folder. The folder also holds scan.json, setup.json, layout.json, taps.jsonl,
 * positions.jsonl and, optionally, actions.jsonl.
 */
export interface RunMeta {
  readonly format: typeof RUN_FORMAT;
  readonly version: typeof FORMAT_VERSION;
  readonly id: string;
  readonly title: string;
  /** Plain words: what is different from the base run, if anything. */
  readonly change?: string;
  /** id of the run this one changes, if any. */
  readonly baseRunId?: string;
  readonly recordedAt: string;
  readonly source: "synthetic" | "recorded";
}

export interface RunBundle {
  readonly meta: RunMeta;
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
  readonly taps: readonly TapEvent[];
  readonly positions: readonly PositionSample[];
  /** actions.jsonl, if the folder has one. Absent for most runs. */
  readonly actions?: RunActions;
}

// ---------------------------------------------------------------------------
// The staged-run protocol (shared by the real room, the fixtures and the model)
// ---------------------------------------------------------------------------

/**
 * How people move in a run. The runbook tells the room to work this way, the
 * fixture generator makes people work this way, and the model assumes it.
 *
 * For each step of an order, the worker at that station, when free and when the
 * item has arrived (first come, first served):
 *   1. walks to each `fetchFrom` storage and back, one round trip each;
 *   2. works at the station;
 *   3. taps "done";
 *   4. carries the item to the next step's station (or the pickup after the last
 *      step) and walks back. If the two stand points are within HANDOFF_REACH_M
 *      the item is passed by hand and nobody walks.
 *
 * Walking distance per order is the sum of those round trips along the shortest
 * walkable path. It depends on the layout alone.
 */
export const HANDOFF_REACH_M = 1.0;

/** A person stands this far out from the side of a box. */
export const STAND_OFF_M = 0.35;

/** Half the width a walking person needs. Obstacles are grown by this much for path finding. */
export const BODY_RADIUS_M = 0.25;
