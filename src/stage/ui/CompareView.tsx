import { estimateShiftProfit, type ShiftProfit } from "../../core/shift-profit";
/**
 * Two independent shift/setup scenarios, with synchronized playback clocks.
 */
import { computed, effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SEED, calibrate, reconstructRun, simulateRun, type Layout, type RunTrace, type World } from "../../core";
import { runFitsKitchen, type Kitchen } from "../app/kitchen-edit";
import { ASSUMED_CALIBRATION, kitchenForShift } from "../app/scenarios";
import { explainError, tryWorld } from "../app/numbers";
import { indexMovements, simulatedWorkers, standingWorkers, ticketsAtTime } from "../app/playback";
import { registerScene } from "../state/scene-ref";
import { compareCommand, params } from "../state/store";
import { resolvedChoice, savedSetups, savedShifts } from "../state/workspace";
import { createKitchenScene, type KitchenSceneHandle } from "../scene";
import { Btn, clock } from "./bits";

const FAST = 4;
const TAIL_S = 1.5;
/** More frontal and higher than the main view, so each half is filled top to bottom. */
const SIDE_VIEW = { azimuth: 0.14, elevation: 1.06 };

interface Side {
  readonly label: "Before" | "After";
  readonly title: string;
  readonly kitchen: Kitchen;
  readonly financial: ShiftProfit | null;
  readonly layout: Layout;
  readonly world: World | null;
  readonly trace: RunTrace | null;
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
  const w = tryWorld(k.scan, k.setup, layout);
  const common = {
    label, title: `${shift.name} + ${saved.name}`, kitchen: k, layout, financial: null,

  };
  if (bindingProblem) return { ...common, world: null, trace: null, problem: bindingProblem };
  if (!w.ok) return { ...common, world: null, trace: null, problem: w.message };
  
  try {
    const trace = shift.schedule.orders.length ? simulateRun(w.value, cal, { seed: DEFAULT_SEED, rep: 0, releases: shift.schedule.orders.filter(order => order.t < (shift.durationSeconds ?? 3600)) }) : null;
    return { ...common, world: w.value, trace, financial: estimateShiftProfit(w.value, cal, saved.economics, { durationSeconds: shift.durationSeconds ?? 3600, prices: shift.prices ?? {} }), problem: null };
  } catch (error) {
    return { ...common, world: w.value, trace: null, problem: explainError(error) };
  }
}

const scenariosKey = computed(() => JSON.stringify([resolvedChoice(0), resolvedChoice(1), savedSetups.value, savedShifts.value]));

function Half(props: { readonly side: Side; readonly t: number; readonly example: boolean; readonly onScene: (h: KitchenSceneHandle | null) => void }) {
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
    if (side.world) h.setWorkers(standingWorkers(side.world));
    props.onScene(h);
    registerScene(`compare-${side.label.toLowerCase()}`, h);
    return () => {
      registerScene(`compare-${side.label.toLowerCase()}`, null);
      props.onScene(null);
      h.dispose();
    };
  }, [side, props.example]);
  const id = side.label.toLowerCase();
  return (
    <div class={`st-half ${id}`} data-testid={`compare-${id}`}>

      <div class="scene" ref={ref}>
        <span class="label">{side.title}</span>
      </div>
      {side.financial ? <FinancialCard financial={side.financial} id={id} /> : <p class="st-note" data-testid={`compare-${id}-profit-cannot`}>{side.problem ?? "Choose a shift with orders."}</p>}
    </div>
  );
}

export function CompareView({ single = false }: { single?: boolean }) {
  const key = scenariosKey.value;
  const [example, setExample] = useState(false);
  const [sides, setSides] = useState<readonly Side[]>([]);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(params.value.speed);
  const scenes = useRef<(KitchenSceneHandle | null)[]>([null, null]);
  const clockRef = useRef({ t: 0, speed: params.value.speed, end: 0 });

  useEffect(() => {
    const list = (single ? [buildSide(0)] : [buildSide(0), buildSide(1)]).filter((s): s is Side => s !== null);
    setSides(list);
    setExample(false);
    setT(0);
    clockRef.current = { ...clockRef.current, t: 0, end: Math.max(0, ...list.map((s) => Math.min(s.trace?.endT ?? 0, s.financial?.durationSeconds ?? Infinity))) + TAIL_S };
    // Keyed on content, not object identity: the first run finishing again in the background (same
    // recording, new objects) must not rebuild both scenes mid-Compare.
  }, [key, single]);

  useEffect(() => {
    if (!example) return;
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
        const exampleTime = Math.min(nextT, s.financial?.durationSeconds ?? Infinity);
        h.setWorkers(simulatedWorkers(s.world, m, exampleTime));
        h.setQueues(ticketsAtTime(s.trace, exampleTime));
      });
      if (now - lastUi > 100 || nextT >= c.end) {
        lastUi = now;
        setT(nextT);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sides, example]);

  useEffect(
    () =>
      effect(() => {
        const cmd = compareCommand.value;
        if (!cmd) return;
        const c = clockRef.current;
        if (cmd.kind === "replay") { setExample(true); clockRef.current = { ...c, t: 0 }; }
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

  if (sides.length < (single ? 1 : 2)) {
    return (
      <div class="st-center">
        <div class="st-center-card">
          <h2>{single ? "Run a scenario" : "Compare shifts and setups"}</h2>
          <p>{single ? "Create a shift in Orders, then choose a shift and setup to run." : "Create a shift in Orders, then choose a shift and setup for each side."}</p>
        </div>
      </div>
    );
  }
  return (
    <div class={`st-profit-results${single ? " single" : ""}`} data-testid={single ? "run-scenario" : "compare-scenarios"}>
      <div class="st-compare-bar" data-testid="compare-bar">
        {example ? <>
        <span class="st-say" data-testid="compare-clock">
          {clock(t)}
        </span>
        </> : null}
        <Btn small label={example ? "Restart example" : "Watch example"} k="P" onClick={() => { setExample(true); clockRef.current = { ...clockRef.current, t: 0 }; }} testId="btn-play" />
        {example ? <>
        <Btn small label="Skip to end" k="E" onClick={() => (clockRef.current = { ...clockRef.current, t: clockRef.current.end })} testId="btn-skip" />
        <Btn small label={speed > 1 ? "Normal speed" : "Faster"} k="F" kind={speed > 1 ? "on" : "plain"} onClick={() => compareCommand.value = { kind: "faster", n: (compareCommand.value?.n ?? 0) + 1 }} testId="btn-faster" />
        <Btn small label="Reset example" onClick={() => { setExample(false); setT(0); clockRef.current = { ...clockRef.current, t: 0 }; }} />
        </> : null}
      </div>
      <div class="st-profit-grid">
      {sides.map((s, i) => (
        <Half key={s.label} side={s} t={t} example={example} onScene={(h) => (scenes.current[i] = h)} />
      ))}
      </div>

    </div>
  );
}

function amount(v: number, currency: string) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v).replace(/^(-?)/, (_, sign) => sign + currency); }
function FinancialCard({ financial: f, id }: { financial: ShiftProfit; id: string }) {
  return <section class="st-financial" aria-label="Financial results">
    <dl>{([['Net profit', f.profit, 'profit'], ['Sales revenue', f.revenue, 'sales'], ['Labor costs', f.labor, 'labor'], ['Operating costs', f.operating, 'operating']] as const).map(([label, value, key]) => <div key={key}><dt>{label}</dt><dd data-testid={`compare-${id}-${key}`}>{amount(value, f.currency)}</dd></div>)}</dl>
  </section>;
}
