/**
 * Step 5, Test. The original and the changed kitchen side by side, simulated:
 * the same orders with the same luck (same seed and replication), clocks in
 * sync. The ranges come from many runs; each animation is one of them. The
 * real second run is the check behind "Check this with a real run".
 */
import { effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_REPS, DEFAULT_SEED, formatMetres, formatRange, simulateRun, type Layout, type RunTrace, type World } from "../../core";
import { explainError, layoutNumbers, tryWorld, type LayoutNumbers } from "../app/numbers";
import { indexMovements, ordersDoneBy, simulatedWorkers, ticketsAtTime } from "../app/playback";
import { SIMULATED_BAR, busiestWorker, simulationBasis, waitsMostAt } from "../app/words";
import { calibration, firstRunProblem, originalLayout, usableFirstRun } from "../state/derive";
import { openCheck } from "../state/flow";
import { registerScene } from "../state/scene-ref";
import { compareCommand, kitchen, params, playLayout } from "../state/store";
import { createKitchenScene, type KitchenSceneHandle } from "../scene";
import { Btn, clock } from "./bits";

const FAST = 4;
const TAIL_S = 1.5;
/** More frontal and higher than the main view, so each half is filled top to bottom. */
const SIDE_VIEW = { azimuth: 0.14, elevation: 1.06 };

interface Side {
  readonly label: "Before" | "After";
  readonly layout: Layout;
  readonly world: World | null;
  readonly trace: RunTrace | null;
  readonly numbers: LayoutNumbers;
  readonly problem: string | null;
}

function buildSide(label: Side["label"], layout: Layout): Side | null {
  const k = kitchen.value;
  const cal = calibration.value;
  if (!k) return null;
  const numbers = layoutNumbers(k.scan, k.setup, layout, cal && cal.ok ? cal.value : null);
  const w = tryWorld(k.scan, k.setup, layout);
  if (!w.ok) return { label, layout, world: null, trace: null, numbers, problem: w.message };
  if (!cal || !cal.ok) return { label, layout, world: w.value, trace: null, numbers, problem: cal?.ok === false ? cal.message : firstRunProblem.value };
  try {
    const trace = simulateRun(w.value, cal.value, { seed: DEFAULT_SEED, rep: 0 });
    return { label, layout, world: w.value, trace, numbers, problem: null };
  } catch (error) {
    return { label, layout, world: w.value, trace: null, numbers, problem: explainError(error) };
  }
}

function sidesKey(before: Layout | null, after: Layout | null): string {
  const run = usableFirstRun.value;
  const k = kitchen.value;
  const cal = calibration.value;
  return JSON.stringify([before, after, k?.scan.capturedAt, k?.setup, run?.label, run?.origin, run?.taps.length, run?.positions.length, cal?.ok]);
}

/** One row under a kitchen: what it is, the value, and how it was worked out. */
function Row(props: { readonly what: string; readonly value: string | null; readonly cannot?: string | null; readonly how?: string; readonly testId: string }) {
  return (
    <div class="st-sim-row">
      <span class="what">{props.what}</span>
      {props.cannot ? (
        <span class="cannot" data-testid={`${props.testId}-cannot`}>
          {props.cannot}
        </span>
      ) : (
        <span class="value" data-testid={props.testId}>
          {props.value ?? "—"}
        </span>
      )}
      <span class="how">{props.how ?? ""}</span>
    </div>
  );
}

function Numbers(props: { readonly side: Side; readonly done: number }) {
  const { side } = props;
  const n = side.numbers;
  const id = side.label.toLowerCase();
  const p = n.time.ok ? n.time.value : null;
  const average = p?.walkingIsAverage ?? false;
  const walking = n.walking.ok ? formatMetres(average && p ? p.walkingPerOrderM : n.walking.value.perOrderM) : null;
  const stationName = (sid: string) => side.world?.itemsById.get(sid)?.name ?? sid;
  const workerName = (wid: string) => side.layout.workers.find((w) => w.id === wid)?.name ?? wid;
  return (
    <div class="under st-compare-rail">
      <Row what="Time per order" value={p ? formatRange(p.meanOrderTime) : null} cannot={n.time.ok ? null : n.time.message} how="Simulated range" testId={`compare-${id}-time`} />
      <Row what="Slow orders" value={p ? formatRange(p.slowOrderTime) : null} how="1 in 10 is slower" testId={`compare-${id}-slow`} />
      <Row what="Walking per order" value={walking} cannot={n.walking.ok ? null : n.walking.message} how={average ? "Average" : "Exact"} testId={`compare-${id}-walking`} />
      <Row what="Waits most at" value={p ? waitsMostAt(p.bottleneckStationId, stationName) : null} testId={`compare-${id}-bottleneck`} />
      <Row what="Busiest" value={p ? busiestWorker(p.workers, workerName) : null} testId={`compare-${id}-busiest`} />
      <Row what="This run" value={side.trace ? `${props.done} of ${side.trace.orders.length}` : null} how={side.problem ?? "orders done"} testId={`compare-${id}-done`} />
    </div>
  );
}

function Half(props: { readonly side: Side; readonly t: number; readonly onScene: (h: KitchenSceneHandle | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { side } = props;
  useEffect(() => {
    const el = ref.current;
    const k = kitchen.value;
    if (!el || !k) return;
    const label = el.querySelector<HTMLElement>(".label");
    const keepOut = () => {
      if (!label) return [];
      const c = el.getBoundingClientRect();
      const r = label.getBoundingClientRect();
      return [{ l: r.left - c.left, r: r.right - c.left, t: r.top - c.top, b: r.bottom - c.top }];
    };
    const h = createKitchenScene(el, { view: SIDE_VIEW, labelKeepOut: keepOut, alignV: "bottom" });
    h.setKitchen({ scan: k.scan, setup: k.setup, layout: side.layout });
    props.onScene(h);
    registerScene(`compare-${side.label.toLowerCase()}`, h);
    return () => {
      registerScene(`compare-${side.label.toLowerCase()}`, null);
      props.onScene(null);
      h.dispose();
    };
  }, [side]);
  const done = side.trace ? ordersDoneBy(side.trace, props.t) : 0;
  const id = side.label.toLowerCase();
  return (
    <div class={`st-half ${id}`} data-testid={`compare-${id}`}>
      <div class="scene" ref={ref}>
        <span class="label">{side.label}</span>
      </div>
      <Numbers side={side} done={done} />
    </div>
  );
}

/** The bar under both kitchens. It always says that this is a simulation. */
function Bar(props: { readonly t: number; readonly speed: number; readonly reps: number; readonly onReplay: () => void }) {
  return (
    <div class="st-compare-bar" data-testid="compare-bar">
      <span class="st-say" data-testid="compare-clock">
        {clock(props.t)}
      </span>
      <span class="st-sim">{SIMULATED_BAR}</span>
      <span class="st-small">{simulationBasis(props.reps)}</span>
      <Btn small label="Play again" k="P" onClick={props.onReplay} testId="btn-play" />
      <Btn small label={props.speed > 1 ? "Normal speed" : "Faster"} k="F" kind={props.speed > 1 ? "on" : "plain"} onClick={() => sendFaster()} testId="btn-faster" />
      <Btn small label="Check this with a real run" k="C" onClick={openCheck} testId="btn-check-real" />
    </div>
  );
}

function sendFaster(): void {
  compareCommand.value = { kind: "faster", n: (compareCommand.value?.n ?? 0) + 1 };
}

/** The after kitchen is the judge's change, the layout in Play now. */
export function TestView() {
  const before = originalLayout.value;
  const after = playLayout.value;
  const [sides, setSides] = useState<readonly Side[]>([]);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(params.value.speed);
  const scenes = useRef<(KitchenSceneHandle | null)[]>([null, null]);
  const clockRef = useRef({ t: 0, speed: params.value.speed, end: 0 });

  useEffect(() => {
    if (!before || !after) return;
    const list = [buildSide("Before", before), buildSide("After", after)].filter((s): s is Side => s !== null);
    setSides(list);
    clockRef.current = { ...clockRef.current, t: 0, end: Math.max(0, ...list.map((s) => s.trace?.endT ?? 0)) + TAIL_S };
    // Keyed on content, not object identity: the first run finishing again in the background (same
    // recording, new objects) must not rebuild both scenes mid-Test.
  }, [sidesKey(before, after)]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const moves = sides.map((s) => (s.trace ? indexMovements(s.trace) : null));
    const frame = (now: number) => {
      const c = clockRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const nextT = Math.min(c.end, c.t + dt * c.speed);
      clockRef.current = { ...c, t: nextT };
      sides.forEach((s, i) => {
        const h = scenes.current[i];
        const m = moves[i];
        if (!h || !s.world || !s.trace || !m) return;
        h.setWorkers(simulatedWorkers(s.world, m, nextT));
        h.setQueues(ticketsAtTime(s.trace, nextT));
      });
      if (now - lastUi > 100 || nextT >= c.end) {
        lastUi = now;
        setT(nextT);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sides]);

  useEffect(
    () =>
      effect(() => {
        const cmd = compareCommand.value;
        if (!cmd) return;
        const c = clockRef.current;
        if (cmd.kind === "replay") clockRef.current = { ...c, t: 0 };
        if (cmd.kind === "skip") clockRef.current = { ...c, t: c.end };
        if (cmd.kind === "faster") {
          const slow = params.value.speed >= FAST ? 1 : params.value.speed;
          const next = c.speed >= Math.max(FAST, params.value.speed) ? slow : Math.max(FAST, params.value.speed);
          clockRef.current = { ...c, speed: next };
          setSpeed(next);
        }
      }),
    [],
  );

  if (!before || !after || sides.length < 2) {
    return (
      <div class="st-center">
        <div class="st-center-card">
          <h2>Before and after</h2>
          <p>{firstRunProblem.value ?? "Make a change in Play first."}</p>
        </div>
      </div>
    );
  }
  const reps = sides.map((s) => (s.numbers.time.ok ? s.numbers.time.value.reps : null)).find((r) => r !== null) ?? DEFAULT_REPS;
  return (
    <div class="st-compare">
      {sides.map((s, i) => (
        <Half key={s.label} side={s} t={t} onScene={(h) => (scenes.current[i] = h)} />
      ))}
      <Bar t={t} speed={speed} reps={reps} onReplay={() => (clockRef.current = { ...clockRef.current, t: 0 })} />
    </div>
  );
}
