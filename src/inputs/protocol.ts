/**
 * The WebSocket protocol between the stage, the tablets, the camera page and
 * the server. Every message is an envelope { channel, payload }. The server
 * relays each envelope to every other client, and itself sends `presence` on
 * the control channel.
 *
 * Channel "scan" (server -> all, after POST /api/scan)
 *   { type: "scan", scan: Scan, receivedAt: ISO string, savedAs?: string }
 *
 * Channel "taps"
 *   tablet -> stage   { type: "tap", tapId, orderId, step, stationId, workerId? }
 *                     Unstamped: the tablet never sends a time.
 *   stage -> tablets  { type: "order", t, orderId, itemId }           (order released)
 *                     { type: "done", t, orderId, step, stationId, workerId?, tapId? }  (tap accepted, stamped)
 *                     { type: "end", t }
 *                     { type: "tap-rejected", tapId, reason }
 *
 * Channel "positions" (camera -> stage)
 *   { type: "report", samples: [{ workerId, x, z }], cameraT?: number }
 *   The stage stamps each sample with its own run time on receipt.
 *
 * Channel "control"
 *   server -> all     { type: "presence", roles: { stage, tablet, camera, other } }
 *   stage -> all      { type: "run-state", runId, status: "idle"|"running"|"ended", t,
 *                       setup, workers, events }
 *                     Sent at run start, at run end and in reply to sync-request.
 *                     `events` is every taps event delivered so far, so a tablet
 *                     that joins or reconnects mid-run rebuilds its view.
 *   stage -> all      { type: "kitchen", scan, setup, layout }
 *                     The kitchen now on the stage. Sent whenever it changes (not
 *                     on every drag frame) and in reply to sync-request. The camera
 *                     page uses it to calibrate pixels to the floor and to know
 *                     the hat colours.
 *   any -> stage      { type: "sync-request", role }
 */
import { z } from "zod";
import type { DoneEvent, Layout, PositionSample, Scan, Setup, TapEvent, WorkerDef } from "../core/types";
import { doneEventSchema, layoutSchema, scanSchema, setupSchema, tapEventSchema, workerDefSchema } from "./schemas";

export const CHANNELS = ["scan", "taps", "positions", "control"] as const;
export type Channel = (typeof CHANNELS)[number];

export const ROLES = ["stage", "tablet", "camera"] as const;
export type Role = (typeof ROLES)[number];
export type RoleCounts = Readonly<Record<Role | "other", number>>;

export interface Envelope<P = unknown> {
  readonly channel: Channel;
  readonly payload: P;
}

export const envelopeSchema = z.object({ channel: z.enum(CHANNELS), payload: z.unknown() });

// --- scan -------------------------------------------------------------------

export interface ScanMessage {
  readonly type: "scan";
  readonly scan: Scan;
  readonly receivedAt: string;
  readonly savedAs?: string;
}
export const scanMessageSchema = z.object({
  type: z.literal("scan"),
  scan: scanSchema,
  receivedAt: z.string(),
  savedAs: z.string().optional(),
});

// --- taps -------------------------------------------------------------------

export interface TapRequest {
  readonly type: "tap";
  /** Unique per tap, chosen by the tablet. Lets the stage ignore resends. */
  readonly tapId: string;
  readonly orderId: string;
  readonly step: number;
  readonly stationId: string;
  readonly workerId?: string;
}
export const tapRequestSchema = z.object({
  type: z.literal("tap"),
  tapId: z.string().min(1),
  orderId: z.string().min(1),
  step: z.number().int().min(0),
  stationId: z.string().min(1),
  workerId: z.string().optional(),
});

export type StampedDone = DoneEvent & { readonly tapId?: string };
export interface TapRejected {
  readonly type: "tap-rejected";
  readonly tapId: string;
  readonly reason: string;
}
export type StageTapMessage = TapEvent | StampedDone | TapRejected;

export const tapRejectedSchema = z.object({ type: z.literal("tap-rejected"), tapId: z.string(), reason: z.string() });
export const stageTapMessageSchema = z.union([
  doneEventSchema.extend({ tapId: z.string().optional() }),
  tapEventSchema,
  tapRejectedSchema,
]);

// --- positions --------------------------------------------------------------

export interface PositionReport {
  readonly type: "report";
  readonly samples: readonly Pick<PositionSample, "workerId" | "x" | "z">[];
  /** The camera page's own clock, informational only. */
  readonly cameraT?: number;
}
const finite = z.number().refine(Number.isFinite);
export const positionReportSchema = z.object({
  type: z.literal("report"),
  samples: z.array(z.object({ workerId: z.string().min(1), x: finite, z: finite })),
  cameraT: z.number().optional(),
});

// --- control ----------------------------------------------------------------

export interface PresenceMessage {
  readonly type: "presence";
  readonly roles: RoleCounts;
}

export type RunStatusOnWire = "idle" | "running" | "ended";

export interface RunStateMessage {
  readonly type: "run-state";
  readonly runId: string;
  readonly status: RunStatusOnWire;
  /** Stage run time when sent, seconds. */
  readonly t: number;
  readonly setup: Setup;
  readonly workers: readonly WorkerDef[];
  readonly events: readonly TapEvent[];
}

export interface SyncRequest {
  readonly type: "sync-request";
  readonly role: string;
}

export interface KitchenMessage {
  readonly type: "kitchen";
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
}

export type ControlMessage = PresenceMessage | RunStateMessage | SyncRequest | KitchenMessage;

const count = z.number().int().min(0);
export const presenceSchema = z.object({
  type: z.literal("presence"),
  roles: z.object({ stage: count, tablet: count, camera: count, other: count }),
});
export const runStateSchema = z.object({
  type: z.literal("run-state"),
  runId: z.string(),
  status: z.enum(["idle", "running", "ended"]),
  t: z.number(),
  setup: setupSchema,
  workers: z.array(workerDefSchema),
  events: z.array(tapEventSchema),
});
export const syncRequestSchema = z.object({ type: z.literal("sync-request"), role: z.string() });
export const kitchenMessageSchema = z.object({
  type: z.literal("kitchen"),
  scan: scanSchema,
  setup: setupSchema,
  layout: layoutSchema,
});
export const controlMessageSchema = z.discriminatedUnion("type", [
  presenceSchema,
  runStateSchema,
  syncRequestSchema,
  kitchenMessageSchema,
]);

/** Decodes a raw WebSocket frame into an envelope, or undefined if it is not one. */
export function decodeEnvelope(raw: string): Envelope | undefined {
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { channel: parsed.data.channel, payload: parsed.data.payload } : undefined;
  } catch {
    return undefined;
  }
}

export const encodeEnvelope = (envelope: Envelope): string => JSON.stringify(envelope);
