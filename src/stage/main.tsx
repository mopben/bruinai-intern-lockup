/**
 * TEMPORARY dev harness for the kitchen scene. The real six-step stage app
 * replaces this file; everything of value lives in ./scene and ./theme.
 */
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./theme";
import { STAND_OFF_M, type Layout, type Vec2 } from "../core/types";
import { createKitchenScene, sampleKitchen, SAMPLE_IDS, type KitchenSceneHandle, type WorkerInput } from "./scene";
import { resolveItems } from "./scene/model";

type Kitchen = typeof sampleKitchen & { layout: Layout };

function standPoint(k: Kitchen, id: string): Vec2 {
  const it = resolveItems(k).find((i) => i.id === id);
  if (!it) return { x: 0, z: 0 };
  const side = k.setup.items.find((s) => s.boxId === id)?.standSide ?? "front";
  const local = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] }[side];
  const reach = (side === "front" || side === "back" ? it.size.d : it.size.w) / 2 + STAND_OFF_M;
  const lx = local[0]! * reach;
  const lz = local[1]! * reach;
  const c = Math.cos(it.yaw);
  const s = Math.sin(it.yaw);
  return { x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c };
}

/** Fake 10 Hz noisy worker trace walking between stand points. */
function fakeWorkers(k: Kitchen, t: number, extra: boolean): WorkerInput[] {
  const loop = (a: Vec2, b: Vec2, period: number, phase: number): { p: Vec2; carrying: boolean } => {
    const u = ((t + phase) % period) / period;
    const tri = u < 0.5 ? u * 2 : 2 - u * 2;
    const e = Math.min(1, Math.max(0, (tri - 0.2) / 0.6));
    return { p: { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e }, carrying: u >= 0.5 };
  };
  const q = Math.floor(t * 10) / 10; // 10 Hz
  const n = (s: number) => Math.sin(q * 37.1 + s) * 0.04;
  const make = standPoint(k, SAMPLE_IDS.make);
  const fridge = standPoint(k, SAMPLE_IDS.fridge);
  const finish = standPoint(k, SAMPLE_IDS.finish);
  const pickup = standPoint(k, SAMPLE_IDS.pickup);
  const order = standPoint(k, SAMPLE_IDS.order);
  const blue = loop(make, fridge, 7, 0);
  const yellow = loop(finish, pickup, 6, 2);
  const out: WorkerInput[] = [
    { id: "w-red", color: "#e0413a", x: order.x + n(1), z: order.z + n(2) },
    { id: "w-blue", color: "#2f6fd6", x: blue.p.x + n(3), z: blue.p.z + n(4), carrying: blue.carrying },
    { id: "w-yellow", color: "#f4c322", x: yellow.p.x + n(5), z: yellow.p.z + n(6), carrying: yellow.carrying },
  ];
  if (extra) out.push({ id: "w-green", color: "#3fae4f", x: make.x + 0.6 + n(7), z: make.z + 0.15 + n(8) });
  return out;
}

function SceneBox(props: { kitchen: Kitchen; onChange?: (l: Layout) => void; onReady: (h: KitchenSceneHandle) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const h = createKitchenScene(ref.current, { onLayoutChange: props.onChange, onSelect: (id) => h.setSelected(id) });
    h.setKitchen(props.kitchen);
    props.onReady(h);
    return () => h.dispose();
  }, []);
  return <div ref={ref} style={{ flex: 1, height: "100%", minWidth: 0 }} />;
}

function App() {
  const [twin, setTwin] = useState(false);
  const [editable, setEditable] = useState(false);
  const [walking, setWalking] = useState(false);
  const [extra, setExtra] = useState(false);
  const [paths, setPaths] = useState(false);
  const pathsOn = useRef(false);
  pathsOn.current = paths;
  const handles = useRef<KitchenSceneHandle[]>([]);
  const kitchen = useRef<Kitchen>({ ...sampleKitchen, layout: sampleKitchen.layout });
  const queues = useRef<Record<string, number>>({ [SAMPLE_IDS.make]: 0, [SAMPLE_IDS.finish]: 0, [SAMPLE_IDS.pickup]: 0, [SAMPLE_IDS.order]: 0 });

  const each = (f: (h: KitchenSceneHandle) => void) => handles.current.forEach(f);
  const pathFor = (k: Kitchen) => {
    const pts = [SAMPLE_IDS.order, SAMPLE_IDS.make, SAMPLE_IDS.fridge, SAMPLE_IDS.make, SAMPLE_IDS.finish, SAMPLE_IDS.pickup].map((id) => standPoint(k, id));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    return [{ points: pts, kind: "walk", label: `${len.toFixed(1)} m` }];
  };
  const onChange = (l: Layout) => {
    kitchen.current = { ...kitchen.current, layout: l };
    each((h) => h.setKitchen(kitchen.current));
    if (pathsOn.current) each((h) => h.setPaths(pathFor(kitchen.current)));
  };

  useEffect(() => {
    if (!walking) { each((h) => h.setWorkers([])); return; }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const ws = fakeWorkers(kitchen.current, (performance.now() - t0) / 1000, extra);
      each((h) => h.setWorkers(ws));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [walking, extra, twin]);

  useEffect(() => { each((h) => h.setPaths(paths ? pathFor(kitchen.current) : [])); }, [paths, twin]);

  const bump = (id: string, d: number) => {
    queues.current = { ...queues.current, [id]: Math.max(0, (queues.current[id] ?? 0) + d) };
    each((h) => h.setQueues(queues.current));
  };

  const btn = (label: string, onClick: () => void, on?: boolean) => (
    <button onClick={onClick} style={{ font: "inherit", fontSize: "16px", padding: "6px 12px", borderRadius: "10px", border: "2px solid var(--dr-ink)", background: on ? "var(--dr-select)" : "var(--dr-paper)", color: "var(--dr-ink)", cursor: "pointer" }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", gap: twin ? "12px" : "0px", minHeight: 0 }} key={twin ? "two" : "one"}>
        {(twin ? [0, 1] : [0]).map((i) => (
          <SceneBox key={i} kitchen={kitchen.current} onChange={onChange} onReady={(h) => {
            handles.current = [...handles.current.filter((x) => x !== h), h].slice(-(twin ? 2 : 1));
            h.setEditable(editable);
            h.setQueues(queues.current);
          }} />
        ))}
      </div>
      <div data-harness style={{ position: "absolute", left: "16px", bottom: "16px", display: "flex", gap: "8px", flexWrap: "wrap", fontFamily: "var(--dr-font-body)" }}>
        {btn("Reveal", async () => { each((h) => void h.playReveal()); await new Promise((r) => setTimeout(r, 2600)); each((h) => void h.showNames()); })}
        {btn("Scan labels", () => each((h) => h.showScanLabels()))}
        {btn("Names", () => each((h) => void h.showNames()))}
        {btn("Editable", () => { const v = !editable; setEditable(v); each((h) => h.setEditable(v)); }, editable)}
        {btn("Walk", () => setWalking(!walking), walking)}
        {btn("4th worker", () => setExtra(!extra), extra)}
        {btn("Make +1", () => bump(SAMPLE_IDS.make, 1))}
        {btn("Make -1", () => bump(SAMPLE_IDS.make, -1))}
        {btn("Finish +1", () => bump(SAMPLE_IDS.finish, 1))}
        {btn("Pickup +1", () => bump(SAMPLE_IDS.pickup, 1))}
        {btn("Paths", () => setPaths(!paths), paths)}
        {btn("Ghost", () => each((h) => h.setGhost(sampleKitchen.layout)))}
        {btn("Side by side", () => { handles.current = []; setTwin(!twin); }, twin)}
      </div>
    </div>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
