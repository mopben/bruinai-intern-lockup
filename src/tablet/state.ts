/**
 * Tablet state: a pure reducer over what the stage says, plus the taps this
 * tablet has sent but the stage has not confirmed yet.
 *
 * The tablet never stamps time. It shows tickets in the order the stage
 * released them and reports taps; the stage stamps them.
 */
import type { Setup, TapEvent, WorkerDef } from "../core/types";
import type { RunStateMessage, RunStatusOnWire, StageTapMessage, TapRequest } from "../inputs/protocol";
import type { LinkState } from "../inputs/socket";

export interface RunInfo {
  readonly runId: string;
  readonly status: RunStatusOnWire;
  readonly setup: Setup;
  readonly workers: readonly WorkerDef[];
}

export interface TabletState {
  readonly connection: LinkState;
  readonly run?: RunInfo;
  /** Stage-confirmed events, in the order received. */
  readonly events: readonly TapEvent[];
  /** Sent, not yet confirmed. Shown as already moved on (optimistic). */
  readonly pending: readonly TapRequest[];
  readonly notice?: string;
}

export type TabletAction =
  | { readonly type: "connection"; readonly state: LinkState }
  | { readonly type: "run-state"; readonly message: RunStateMessage }
  | { readonly type: "stage-tap"; readonly message: StageTapMessage }
  | { readonly type: "local-tap"; readonly tap: TapRequest }
  | { readonly type: "clear-notice" };

export const initialTabletState: TabletState = { connection: "connecting", events: [], pending: [] };

const stepKey = (orderId: string, step: number) => `${orderId}#${step}`;

const isConfirmedBy = (tap: TapRequest, event: TapEvent & { tapId?: string }) =>
  event.type === "done" && (event.tapId === tap.tapId || (event.orderId === tap.orderId && event.step === tap.step));

export function tabletReducer(state: TabletState, action: TabletAction): TabletState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.state };
    case "run-state": {
      const m = action.message;
      const sameRun = state.run?.runId === m.runId;
      const events = m.events;
      const pending = sameRun ? state.pending.filter((p) => !events.some((e) => isConfirmedBy(p, e))) : [];
      return { ...state, run: { runId: m.runId, status: m.status, setup: m.setup, workers: m.workers }, events, pending };
    }
    case "stage-tap": {
      const m = action.message;
      if (m.type === "tap-rejected") {
        const tap = state.pending.find((p) => p.tapId === m.tapId);
        if (tap === undefined) return state;
        return { ...state, pending: state.pending.filter((p) => p !== tap), notice: `Not counted: ${m.reason}` };
      }
      const pending = state.pending.filter((p) => !isConfirmedBy(p, m));
      const known =
        m.type === "end"
          ? state.events.some((e) => e.type === "end")
          : state.events.some((e) =>
              m.type === "order"
                ? e.type === "order" && e.orderId === m.orderId
                : e.type === "done" && e.orderId === m.orderId && e.step === m.step,
            );
      const { tapId: _drop, ...event } = m as TapEvent & { tapId?: string };
      const events = known ? state.events : [...state.events, event as TapEvent];
      const run = m.type === "end" && state.run !== undefined ? { ...state.run, status: "ended" as const } : state.run;
      return { ...state, events, pending, run };
    }
    case "local-tap":
      return state.pending.some((p) => p.tapId === action.tap.tapId) ? state : { ...state, pending: [...state.pending, action.tap] };
    case "clear-notice":
      return { ...state, notice: undefined };
  }
}

// ---------------------------------------------------------------------------
// Derived view
// ---------------------------------------------------------------------------

export interface Ticket {
  readonly orderId: string;
  readonly itemName: string;
  /** "#3": position in the schedule, which is what people call out. */
  readonly label: string;
  readonly step: number;
  readonly stationId: string;
}

export interface StationView {
  readonly stationId: string;
  readonly name: string;
  readonly workers: readonly WorkerDef[];
  /** First ticket is the one to work on now. */
  readonly tickets: readonly Ticket[];
}

/** Stations in the order the menu first uses them. */
export function stationIds(setup: Setup): readonly string[] {
  return [...new Set(setup.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
}

export function stationName(setup: Setup, boxId: string): string {
  return setup.items.find((i) => i.boxId === boxId)?.name ?? boxId;
}

export interface BoardView {
  readonly stations: readonly StationView[];
  readonly completed: number;
  readonly total: number;
}

export function boardView(state: TabletState): BoardView | undefined {
  const run = state.run;
  if (run === undefined) return undefined;
  const { setup } = run;
  const done = new Set([
    ...state.events.flatMap((e) => (e.type === "done" ? [stepKey(e.orderId, e.step)] : [])),
    ...state.pending.map((p) => stepKey(p.orderId, p.step)),
  ]);
  // When each order arrived at its current step, in event order, so queues are first come, first served.
  const arrival = new Map<string, number>();
  state.events.forEach((e, i) => {
    if (e.type === "order") arrival.set(stepKey(e.orderId, 0), i);
    if (e.type === "done") arrival.set(stepKey(e.orderId, e.step + 1), i);
  });
  const scheduleIndex = new Map(setup.schedule.orders.map((o, i) => [o.orderId, i]));
  const items = new Map(setup.menu.map((m) => [m.id, m]));

  const tickets: (Ticket & { readonly arrivedAt: number })[] = [];
  let completed = 0;
  for (const e of state.events) {
    if (e.type !== "order") continue;
    const item = items.get(e.itemId);
    if (item === undefined) continue;
    const step = item.steps.findIndex((_, k) => !done.has(stepKey(e.orderId, k)));
    if (step === -1) {
      completed += 1;
      continue;
    }
    const n = scheduleIndex.get(e.orderId);
    tickets.push({
      orderId: e.orderId,
      itemName: item.name,
      label: n === undefined ? e.orderId : `#${n + 1}`,
      step,
      stationId: item.steps[step]?.stationId ?? "",
      arrivedAt: arrival.get(stepKey(e.orderId, step)) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  const sorted = [...tickets].sort((a, b) => a.arrivedAt - b.arrivedAt);
  const stations = stationIds(setup).map((stationId) => ({
    stationId,
    name: stationName(setup, stationId),
    workers: run.workers.filter((w) => w.stationId === stationId),
    tickets: sorted.filter((t) => t.stationId === stationId).map(({ arrivedAt: _a, ...t }) => t),
  }));
  return { stations, completed, total: setup.schedule.orders.length };
}

/** The tap a person makes on the first ticket of a station. */
export function tapFor(ticket: Ticket, tapId: string, workerId?: string): TapRequest {
  return {
    type: "tap",
    tapId,
    orderId: ticket.orderId,
    step: ticket.step,
    stationId: ticket.stationId,
    ...(workerId === undefined ? {} : { workerId }),
  };
}
