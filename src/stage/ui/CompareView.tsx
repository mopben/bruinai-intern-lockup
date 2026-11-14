/**
 * Two independent shift/setup scenarios, with synchronized playback clocks.
 */
import { computed, effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SEED, calibrate, reconstructRun, formatMetres, formatRange, simulateRun, type Layout, type RunTrace, type World } from "../../core";
import { runFitsKitchen, type Kitchen } from "../app/kitchen-edit";
import { ASSUMED_CALIBRATION, kitchenForShift } from "../app/scenarios";
import { explainError, layoutNumbers, tryWorld, type LayoutNumbers } from "../app/numbers";
import { indexMovements, ordersDoneBy, simulatedWorkers, ticketsAtTime } from "../app/playback";
import { busiestWorker, waitsMostAt } from "../app/words";
import { registerScene } from "../state/scene-ref";
import { compareCommand, params } from "../state/store";
import { resolvedChoice, savedSetups, savedShifts } from "../state/workspace";
import { createKitchenScene, type KitchenSceneHandle } from "../scene";
import { BigNum, Btn, clock } from "./bits";

const FAST = 4;
const TAIL_S = 1.5;
/** More frontal and higher than the main view, so each half is filled top to bottom. */
const SIDE_VIEW = { azimuth: 0.14, elevation: 1.06 };

interface Side {
  readonly label: "Before" | "After";
  readonly title: string;
  readonly kitchen: Kitchen;
  readonly assumption: string | null;
  readonly laborPerHour: number;
  readonly layout: Layout;
  readonly world: World | null;
  readonly trace: RunTrace | null;
  readonly numbers: LayoutNumbers;
  readonly problem: string | null;
}

function buildSide(index: number): Side | null {
  const choice = resolvedChoice(index);
  const saved = savedSetups.value.find((entry) => entry.id === choice.setupId);
  const shift = savedShifts.value.find((entry) => entry.id === choice.shiftId);
  if (!saved || !shift) return null;
  const label: Side["label"] = index === 0 ? "Before" : "After";
  let k = saved.kitchen;
  let bindingProblem: string | null = null;
  try { k = kitchenForShift(k, shift); }
  catch (error) { bindingProblem = (error as Error).message; }
  const layout = k.layout;
  let cal = ASSUMED_CALIBRATION;
  const measured = saved.measured;
  if (measured && runFitsKitchen(measured.kitchen, k)) {
    const world = tryWorld(measured.kitchen.scan, measured.kitchen.setup, measured.kitchen.layout);
    if (world.ok) {
      try { cal = calibrate(world.value, reconstructRun(measured.kitchen.setup, measured.taps), measured.positions); }
      catch { /* Explicit preparation times can still simulate with assumed walking pace. */ }
    }
  }
  const numbers: LayoutNumbers = bindingProblem ? {
    walking: { ok: false, message: bindingProblem }, time: { ok: false, message: bindingProblem }, world: null,
  } : layoutNumbers(k.scan, k.setup, layout, cal);
  const w = tryWorld(k.scan, k.setup, layout);
  const econ = saved.economics;
  const common = {
    label, title: `${shift.name} + ${saved.name}`, kitchen: k, layout, numbers,
    assumption: cal.walkSpeedAssumed ? "Walking pace assumed at 1.2 m/s." : null,
    laborPerHour: layout.workers.reduce((sum, worker) => sum + (econ?.workerWages?.[worker.id] ?? econ?.wagePerHour ?? 18), 0),
  };
  if (bindingProblem) return { ...common, world: null, trace: null, problem: bindingProblem };
  if (!w.ok) return { ...common, world: null, trace: null, problem: w.message };
  if (!shift.schedule.orders.length) return { ...common, world: w.value, trace: null, problem: "This shift has no orders. Set its quantities in Orders." };
  try {
    const trace = simulateRun(w.value, cal, { seed: DEFAULT_SEED, rep: 0 });
    return { ...common, world: w.value, trace, problem: null };
  } catch (error) {
    return { ...common, world: w.value, trace: null, problem: explainError(error) };
  }
}

const scenariosKey = computed(() => JSON.stringify([resolvedChoice(0), resolvedChoice(1), savedSetups.value, savedShifts.value]));

function Half(props: { readonly side: Side; readonly t: number; readonly onScene: (h: KitchenSceneHandle | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { side } = props;
  useEffect(() => {
    const el = ref.current;
    const k = side.kitchen;
    if (!el) return;
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
  const n = side.numbers;
  // No orders: the engine's extra numbers would be zeros, so show a dash.
  const p = n.time.ok && n.time.value.orderCount > 0 ? n.time.value : null;
  const stationName = (sid: string) => side.world?.itemsById.get(sid)?.name ?? sid;
  const workerName = (wid: string) => side.layout.workers.find((w) => w.id === wid)?.name ?? wid;
  const done = side.trace ? ordersDoneBy(side.trace, props.t) : 0;
  const lastFinish = side.trace ? Math.max(0, ...side.trace.orders.map((order) => order.finishedAt ?? 0)) : null;
  const id = side.label.toLowerCase();
  return (
    <div class={`st-half ${id}`} data-testid={`compare-${id}`}>
      <div class="scene" ref={ref}>
        <span class="label">{side.title}</span>
      </div>
      <div class="under st-compare-rail">
        {side.problem ? <p class="st-note st-scenario-problem" role="status">{side.problem}</p> : null}
        <BigNum mid what="Walking per order" value={n.walking.ok ? formatMetres(n.walking.value.perOrderM) : null} cannot={n.walking.ok ? null : n.walking.message} how="Exact" testId={`compare-${id}-walking`} />
        <BigNum mid what="Time per order" value={n.time.ok ? formatRange(n.time.value.meanOrderTime) : null} cannot={n.time.ok ? null : n.time.message} how="Simulated range" testId={`compare-${id}-time`} />
        <div class="st-num">
          <span class="what">This run</span>
          <span class="value mid" data-testid={`compare-${id}-done`}>
            {side.trace ? `${done} of ${side.trace.orders.length}` : "—"}
          </span>
          <span class="how">{side.problem ?? "orders done"}</span>
        </div>
        <div class="st-scenario-stats">
          <span>Workers <strong>{side.layout.workers.length}</strong></span>
          <span>Finish all orders <strong data-testid={`compare-${id}-duration`}>{lastFinish !== null ? clock(lastFinish) : "—"}</strong></span>
          <span>Labor / hour <strong>${side.laborPerHour.toFixed(2)}</strong></span>
          <span>Slow orders <strong data-testid={`compare-${id}-slow`}>{p ? formatRange(p.slowOrderTime) : "—"}</strong></span>
          <span>Waits most at <strong data-testid={`compare-${id}-bottleneck`}>{p ? waitsMostAt(p.bottleneckStationId, stationName) : "—"}</strong></span>
          <span>Busiest <strong data-testid={`compare-${id}-busiest`}>{p ? busiestWorker(p.workers, workerName) : "—"}</strong></span>
        </div>
        {side.assumption ? <p class="st-small">{side.assumption}</p> : null}
      </div>
    </div>
  );
}

export function CompareView() {
  const key = scenariosKey.value;
  const [sides, setSides] = useState<readonly Side[]>([]);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(params.value.speed);
  const scenes = useRef<(KitchenSceneHandle | null)[]>([null, null]);
  const clockRef = useRef({ t: 0, speed: params.value.speed, end: 0 });

  useEffect(() => {
    const list = [buildSide(0), buildSide(1)].filter((s): s is Side => s !== null);
    setSides(list);
    setT(0);
    clockRef.current = { ...clockRef.current, t: 0, end: Math.max(0, ...list.map((s) => s.trace?.endT ?? 0)) + TAIL_S };
    // Keyed on content, not object identity: the first run finishing again in the background (same
    // recording, new objects) must not rebuild both scenes mid-Compare.
  }, [key]);

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

  if (sides.length < 2) {
    return (
      <div class="st-center">
        <div class="st-center-card">
          <h2>Compare shifts and setups</h2>
          <p>Create a shift in Orders, then choose a shift and setup for each side.</p>
        </div>
      </div>
    );
  }
  return (
    <div class="st-compare">
      {sides.map((s, i) => (
        <Half key={s.label} side={s} t={t} onScene={(h) => (scenes.current[i] = h)} />
      ))}
      <div class="st-compare-bar" data-testid="compare-bar">
        <span class="st-say" data-testid="compare-clock">
          {clock(t)}
        </span>
        <span class="st-small">{resolvedChoice(0).shiftId === resolvedChoice(1).shiftId ? "Same shift, matched simulation seed." : "Different shifts: results reflect both order demand and setup."}</span>
        <Btn small label="Play again" k="P" onClick={() => (clockRef.current = { ...clockRef.current, t: 0 })} testId="btn-play" />
        <Btn small label="Skip to end" k="E" onClick={() => (clockRef.current = { ...clockRef.current, t: clockRef.current.end })} testId="btn-skip" />
        <Btn small label={speed > 1 ? "Normal speed" : "Faster"} k="F" kind={speed > 1 ? "on" : "plain"} onClick={() => compareCommand.value = { kind: "faster", n: (compareCommand.value?.n ?? 0) + 1 }} testId="btn-faster" />
      </div>
    </div>
  );
}
