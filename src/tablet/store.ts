/**
 * Wires the tablet state to the WebSocket: applies stage messages, sends taps,
 * asks for a sync on every (re)connect and resends unconfirmed taps.
 */
import { signal, type Signal } from "@preact/signals";
import { runStateSchema, stageTapMessageSchema, type TapRequest } from "../inputs/protocol";
import type { MessageLink } from "../inputs/socket";
import { initialTabletState, tabletReducer, type TabletAction, type TabletState } from "./state";

export interface TabletStore {
  readonly state: Signal<TabletState>;
  sendTap(tap: TapRequest): void;
  clearNotice(): void;
  dispose(): void;
}

let tapCounter = 0;
/** Unique enough across tablets and reloads; the stage only needs it to spot resends. */
export function newTapId(): string {
  tapCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${tapCounter}`;
}

export function createTabletStore(link: MessageLink): TabletStore {
  const state = signal<TabletState>({ ...initialTabletState, connection: link.state() });
  const dispatch = (action: TabletAction) => {
    state.value = tabletReducer(state.value, action);
  };

  const sync = () => {
    link.send("control", { type: "sync-request", role: "tablet" });
    for (const tap of state.value.pending) link.send("taps", tap);
  };

  const offs = [
    link.onState((s) => {
      dispatch({ type: "connection", state: s });
      if (s === "open") sync();
    }),
    link.subscribe("control", (payload) => {
      const parsed = runStateSchema.safeParse(payload);
      if (parsed.success) dispatch({ type: "run-state", message: parsed.data });
    }),
    link.subscribe("taps", (payload) => {
      const parsed = stageTapMessageSchema.safeParse(payload);
      // Other tablets' raw taps are relayed here too; only stage messages parse.
      if (parsed.success) dispatch({ type: "stage-tap", message: parsed.data });
    }),
  ];
  if (link.state() === "open") sync();

  return {
    state,
    sendTap(tap) {
      dispatch({ type: "local-tap", tap });
      link.send("taps", tap); // if offline, it is resent on reconnect
    },
    clearNotice: () => dispatch({ type: "clear-notice" }),
    dispose: () => offs.forEach((off) => off()),
  };
}
