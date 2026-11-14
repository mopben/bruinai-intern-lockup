/**
 * The tablet page. One column per station; the next ticket is a big button.
 * `?station=<boxId>` shows one station full-screen; `&worker=<id>` tags taps.
 */
import { useEffect, useState } from "preact/hooks";
import type { WorkerDef } from "../core/types";
import { boardView, tapFor, type StationView, type TabletState, type Ticket } from "./state";
import { newTapId, type TabletStore } from "./store";

/** After a tap, a column ignores taps for this long, so a double tap never finishes the next ticket. */
export const TAP_COOLDOWN_MS = 900;
const QUEUE_SHOWN = 3;

function useNarrow(): boolean {
  const query = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (mq === undefined) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function Hats({ workers }: { readonly workers: readonly WorkerDef[] }) {
  return (
    <span class="hats" aria-label={workers.map((w) => w.name).join(", ")}>
      {workers.map((w) => (
        <span key={w.id} class="hat" style={{ background: w.color }} title={w.name} />
      ))}
    </span>
  );
}

function ConnectionPill({ state }: { readonly state: TabletState }) {
  const label = state.connection === "open" ? "Connected" : state.connection === "connecting" ? "Connecting…" : "Offline, retrying…";
  return (
    <span class={`pill pill-${state.connection}`} role="status">
      <span class="dot" />
      {label}
    </span>
  );
}

interface ColumnProps {
  readonly station: StationView;
  readonly onDone: (ticket: Ticket) => void;
  readonly cooling?: string;
  readonly active: boolean;
}

function StationColumn({ station, onDone, cooling, active }: ColumnProps) {
  const [next, ...queue] = station.tickets;
  const piling = station.tickets.length >= 3;
  return (
    <section class={`column${piling ? " piling" : ""}`} aria-label={station.name}>
      <header class="column-head">
        <h2>{station.name}</h2>
        <Hats workers={station.workers} />
        <span class="count" aria-label={`${station.tickets.length} waiting`}>
          {station.tickets.length}
        </span>
      </header>
      {cooling !== undefined ? (
        <div class="done-flash" role="status">
          <span class="tick">✓</span>
          <span>{cooling} done</span>
        </div>
      ) : next === undefined ? (
        <div class="empty">{active ? "Nothing waiting" : "Waiting for the run"}</div>
      ) : (
        <button class="ticket-button" type="button" disabled={!active} onClick={() => onDone(next)}>
          <span class="ticket-label">{next.label}</span>
          <span class="ticket-item">{next.itemName}</span>
          <span class="ticket-cta">Tap when done</span>
        </button>
      )}
      <ol class="queue">
        {queue.slice(0, QUEUE_SHOWN).map((t) => (
          <li key={t.orderId} class="mini-ticket">
            <b>{t.label}</b> {t.itemName}
          </li>
        ))}
        {queue.length > QUEUE_SHOWN && <li class="more">+{queue.length - QUEUE_SHOWN} more</li>}
      </ol>
    </section>
  );
}

function Waiting({ state }: { readonly state: TabletState }) {
  return (
    <main class="screen-message">
      <h1>Dry Run</h1>
      <p>{state.connection === "open" ? "Waiting for the stage to start a run…" : "Looking for the laptop…"}</p>
      <ConnectionPill state={state} />
    </main>
  );
}

function StationPicker({ stations }: { readonly stations: readonly StationView[] }) {
  return (
    <main class="screen-message">
      <h1>Which station is this?</h1>
      <div class="picker">
        {stations.map((s) => (
          <a key={s.stationId} class="pick" href={`?station=${encodeURIComponent(s.stationId)}`}>
            {s.name} <Hats workers={s.workers} />
          </a>
        ))}
        <a class="pick pick-all" href="?">
          All stations
        </a>
      </div>
    </main>
  );
}

export interface AppProps {
  readonly store: TabletStore;
  readonly stationParam?: string;
  readonly workerParam?: string;
}

export function App({ store, stationParam, workerParam }: AppProps) {
  const state = store.state.value;
  const narrow = useNarrow();
  const [cooling, setCooling] = useState<Readonly<Record<string, string>>>({});
  const [picked, setPicked] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (state.notice === undefined) return;
    const id = setTimeout(() => store.clearNotice(), 4000);
    return () => clearTimeout(id);
  }, [state.notice, store]);

  const board = boardView(state);
  if (board === undefined) return <Waiting state={state} />;
  const running = state.run?.status === "running";
  const ended = state.run?.status === "ended";

  if (stationParam !== undefined && !board.stations.some((s) => s.stationId === stationParam)) {
    return <StationPicker stations={board.stations} />;
  }

  const onDone = (ticket: Ticket) => {
    if (!running || cooling[ticket.stationId] !== undefined) return;
    store.sendTap(tapFor(ticket, newTapId(), workerParam));
    setCooling((c) => ({ ...c, [ticket.stationId]: ticket.label }));
    setTimeout(() => setCooling(({ [ticket.stationId]: _done, ...rest }) => rest), TAP_COOLDOWN_MS);
  };

  const single = stationParam ?? (narrow ? (picked ?? board.stations[0]?.stationId) : undefined);
  const shown = single === undefined ? board.stations : board.stations.filter((s) => s.stationId === single);

  return (
    <div class={`tablet${single !== undefined ? " single" : ""}`}>
      <header class="topbar">
        <span class="brand">Dry Run</span>
        <span class="run-status">
          {running ? `${board.completed} of ${board.total} orders out` : ended ? "Run over" : "Get ready: the run starts soon"}
        </span>
        <ConnectionPill state={state} />
      </header>
      {narrow && stationParam === undefined && (
        <nav class="tabs">
          {board.stations.map((s) => (
            <button
              key={s.stationId}
              type="button"
              class={`tab${s.stationId === single ? " on" : ""}`}
              onClick={() => setPicked(s.stationId)}
            >
              {s.name} <span class="tab-count">{s.tickets.length}</span>
            </button>
          ))}
        </nav>
      )}
      <main class="board" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((s) => (
          <StationColumn key={s.stationId} station={s} onDone={onDone} cooling={cooling[s.stationId]} active={running} />
        ))}
      </main>
      {state.notice !== undefined && (
        <div class="notice" role="alert">
          {state.notice}
        </div>
      )}
      {ended && (
        <div class="overlay" role="status">
          <div class="overlay-card">
            <h1>Run over</h1>
            <p>
              {board.completed} of {board.total} orders out. Thank you!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
