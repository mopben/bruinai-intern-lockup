/**
 * Step 3, Before vs after. The original and changed kitchens run the same
 * orders with the same luck (same seed and replication), clocks in sync.
 */
import { effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SEED, formatMetres, formatRange, simulateRun, type Layout, type RunTrace, type World } from "../../core";
import { explainError, layoutNumbers, tryWorld, type LayoutNumbers } from "../app/numbers";
import { indexMovements, ordersDoneBy, simulatedWorkers, ticketsAtTime } from "../app/playback";
import { calibration, firstRunProblem, originalLayout, simReleases, usableFirstRun } from "../state/derive";
import { registerScene } from "../state/scene-ref";
import { compareCommand, kitchen, params, playLayout, testPlan } from "../state/store";
import { createKitchenScene, type KitchenSceneHandle } from "../scene";
import { BigNum, Btn, clock } from "./bits";

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
  const releases = simReleases.value;
  const numbers = layoutNumbers(k.scan, k.setup, layout, cal && cal.ok ? cal.value : null, releases);
  const w = tryWorld(k.scan, k.setup, layout);
  if (!w.ok) return { label, layout, world: null, trace: null, numbers, problem: w.message };
  if (!cal || !cal.ok) return { label, layout, world: w.value, trace: null, numbers, problem: cal?.ok === false ? cal.message : firstRunProblem.value };
  try {
    const trace = simulateRun(w.value, cal.value, { seed: DEFAULT_SEED, rep: 0, releases });
    return { label, layout, world: w.value, trace, numbers, problem: null };
  } catch (error) {
    return { label, layout, world: w.value, trace: null, numbers, problem: explainError(error) };
  }
}

/**
 * The "after" kitchen: the layout in Play now. The Test step's layout is used
 * only when that Test was made for this same Play layout (it may be the
 * nearest recorded run's layout when nothing matched).
 */
function sidesKey(before: Layout | null, after: Layout | null): string {
  const run = usableFirstRun.value;
  const k = kitchen.value;
  const cal = calibration.value;
  return JSON.stringify([before, after, k?.scan.capturedAt, k?.setup, simReleases.value, run?.label, run?.origin, run?.taps.length, run?.positions.length, cal?.ok]);
}

export function currentAfterLayout(): Layout | null {
  const plan = testPlan.value;
  const judge = playLayout.value;
  return plan && plan.judgeLayout === judge ? plan.layout : judge;
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
  const n = side.numbers;
  const done = side.trace ? ordersDoneBy(side.trace, props.t) : 0;
  const id = side.label.toLowerCase();
  return (
    <div class={`st-half ${id}`} data-testid={`compare-${id}`}>
      <div class="scene" ref={ref}>
        <span class="label">{side.label}</span>
      </div>
      <div class="under st-compare-rail">
        <BigNum mid what="Walking per order" value={n.walking.ok ? formatMetres(n.walking.value.perOrderM) : null} cannot={n.walking.ok ? null : n.walking.message} how="Exact" testId={`compare-${id}-walking`} />
        <BigNum mid what="Time per order" value={n.time.ok ? formatRange(n.time.value.meanOrderTime) : null} cannot={n.time.ok ? null : n.time.message} how="Simulated range" testId={`compare-${id}-time`} />
        <div class="st-num">
          <span class="what">This run</span>
          <span class="value mid" data-testid={`compare-${id}-done`}>
            {side.trace ? `${done} of ${side.trace.orders.length}` : "—"}
          </span>
          <span class="how">{side.problem ?? "orders done"}</span>
        </div>
      </div>
    </div>
  );
}

export function CompareView() {
  const before = originalLayout.value;
  const after = currentAfterLayout();
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
    // recording, new objects) must not rebuild both scenes mid-Compare.
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
          <p>{firstRunProblem.value ?? "Make a change in Edit (step 2) first."}</p>
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
        <span class="st-small">The same orders in both kitchens, one simulated run each, same luck.</span>
        <Btn small label="Play again" k="P" onClick={() => (clockRef.current = { ...clockRef.current, t: 0 })} testId="btn-play" />
        <Btn small label={speed > 1 ? "Normal speed" : "Faster"} k="F" kind={speed > 1 ? "on" : "plain"} onClick={() => compareCommand.value = { kind: "faster", n: (compareCommand.value?.n ?? 0) + 1 }} testId="btn-faster" />
      </div>
    </div>
  );
}
