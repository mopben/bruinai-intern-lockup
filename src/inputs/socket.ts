/**
 * A small reconnecting WebSocket client speaking { channel, payload } envelopes.
 *
 * Everything that talks to other devices depends on the MessageLink interface,
 * not on WebSocket, so tests use an in-memory link instead.
 */
import { realClock, type Clock, type TimerId } from "./clock";
import { decodeEnvelope, encodeEnvelope, type Channel, type Envelope } from "./protocol";

export type LinkState = "connecting" | "open" | "closed";
export type Unsubscribe = () => void;

export interface MessageLink {
  /** Sends if open. Returns false (and drops the message) when not connected. */
  send(channel: Channel, payload: unknown): boolean;
  /** Listens to one channel. */
  subscribe(channel: Channel, listener: (payload: unknown) => void): Unsubscribe;
  onState(listener: (state: LinkState) => void): Unsubscribe;
  state(): LinkState;
  /** Closes for good; no more reconnects. */
  close(): void;
}

/** The subset of the browser WebSocket we use. Node's `ws` also fits. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface SocketOptions {
  /** Full ws:// URL. Default: same host as the page, path /ws?role=<role>. */
  readonly url?: string;
  readonly role: string;
  readonly createSocket?: WebSocketFactory;
  readonly clock?: Clock;
  /** Reconnect delays grow from min to max (ms). */
  readonly minDelayMs?: number;
  readonly maxDelayMs?: number;
}

const OPEN = 1;

export function defaultSocketUrl(role: string): string {
  const loc = globalThis.location;
  const protocol = loc?.protocol === "https:" ? "wss:" : "ws:";
  const host = loc?.host ?? "localhost:5179";
  return `${protocol}//${host}/ws?role=${encodeURIComponent(role)}`;
}

/** Creates a fan-out registry of listeners keyed by channel. */
export function createListeners() {
  let byChannel: ReadonlyMap<Channel, readonly ((p: unknown) => void)[]> = new Map();
  return {
    add(channel: Channel, fn: (p: unknown) => void): Unsubscribe {
      byChannel = new Map(byChannel).set(channel, [...(byChannel.get(channel) ?? []), fn]);
      return () => {
        byChannel = new Map(byChannel).set(channel, (byChannel.get(channel) ?? []).filter((f) => f !== fn));
      };
    },
    emit(envelope: Envelope) {
      for (const fn of byChannel.get(envelope.channel) ?? []) fn(envelope.payload);
    },
  };
}

export function createReconnectingSocket(options: SocketOptions): MessageLink {
  const clock = options.clock ?? realClock;
  const url = options.url ?? defaultSocketUrl(options.role);
  const create: WebSocketFactory =
    options.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
  const minDelay = options.minDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 5000;

  const listeners = createListeners();
  let stateListeners: readonly ((s: LinkState) => void)[] = [];
  let current: LinkState = "connecting";
  let socket: WebSocketLike | undefined;
  let retryTimer: TimerId | undefined;
  let attempts = 0;
  let closedForGood = false;

  const setState = (next: LinkState) => {
    if (next === current) return;
    current = next;
    for (const fn of stateListeners) fn(next);
  };

  const scheduleReconnect = () => {
    if (closedForGood || retryTimer !== undefined) return;
    const delay = Math.min(maxDelay, minDelay * 2 ** Math.min(attempts, 6));
    attempts += 1;
    retryTimer = clock.setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, delay);
  };

  function connect() {
    if (closedForGood) return;
    setState("connecting");
    let ws: WebSocketLike;
    try {
      ws = create(url);
    } catch {
      setState("closed");
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      attempts = 0;
      setState("open");
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const envelope = decodeEnvelope(ev.data);
      if (envelope !== undefined) listeners.emit(envelope);
    };
    ws.onerror = () => {
      /* onclose follows and handles it */
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      setState("closed");
      scheduleReconnect();
    };
  }

  connect();

  return {
    send(channel, payload) {
      if (socket === undefined || socket.readyState !== OPEN) return false;
      socket.send(encodeEnvelope({ channel, payload }));
      return true;
    },
    subscribe: (channel, fn) => listeners.add(channel, fn),
    onState(fn) {
      stateListeners = [...stateListeners, fn];
      return () => {
        stateListeners = stateListeners.filter((f) => f !== fn);
      };
    },
    state: () => current,
    close() {
      closedForGood = true;
      if (retryTimer !== undefined) clock.clearTimeout(retryTimer);
      retryTimer = undefined;
      const ws = socket;
      socket = undefined;
      ws?.close();
      setState("closed");
    },
  };
}
