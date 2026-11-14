/**
 * Top-down map of the kitchen (back wall at the top, as on the stage).
 * In calibrate mode its corner points are clickable; matched ones turn
 * green/amber/red by their error. Tracked workers show as dots.
 */
import type { RefPoint } from "../kitchen";
import { errorTone } from "./overlay";
import type { CameraStore } from "./store";

const PAD_M = 0.35;

export function MiniMap({ store }: { readonly store: CameraStore }) {
  const k = store.kitchen.value;
  if (!k) return <div class="map-empty">No kitchen yet.</div>;
  const { bounds: b, boxes, walls, refs } = k.view;
  const calibrating = store.mode.value === "calibrate";
  const pairs = store.calib.value?.pairs ?? [];
  const solved = store.solved.value;
  const errors = solved?.ok ? solved.value.errorsCm : undefined;
  const suspect = solved?.ok ? solved.value.suspect : undefined;
  const selected = store.selectedRef.value;
  const vb = `${b.minX - PAD_M} ${b.minZ - PAD_M} ${b.maxX - b.minX + 2 * PAD_M} ${b.maxZ - b.minZ + 2 * PAD_M}`;
  const pts = (fp: readonly { x: number; z: number }[]) => fp.map((p) => `${p.x},${p.z}`).join(" ");
  const inset = (r: RefPoint) => {
    const box = boxes.find((bx) => r.id.startsWith(`${bx.id}:`));
    if (!box) return { x: r.world.x, z: r.world.z };
    const cx = box.footprint.reduce((s, p) => s + p.x, 0) / 4;
    const cz = box.footprint.reduce((s, p) => s + p.z, 0) / 4;
    const d = Math.hypot(cx - r.world.x, cz - r.world.z) || 1;
    const step = Math.min(0.16, d / 2);
    return { x: r.world.x + ((cx - r.world.x) * step) / d, z: r.world.z + ((cz - r.world.z) * step) / d };
  };
  const pairIndex = (r: RefPoint) => pairs.findIndex((p) => p.refId === r.id);
  const samples = store.result.value?.samples ?? [];
  const holding = new Set(store.result.value?.workers.filter((w) => w.track.status === "holding").map((w) => w.id));

  return (
    <svg class="minimap" viewBox={vb} role="img" aria-label="Kitchen map">
      {walls.map((fp, i) => (
        <polygon key={`w${i}`} points={pts(fp)} class="map-wall" />
      ))}
      {boxes.map((box) => (
        <g key={box.id}>
          <polygon points={pts(box.footprint)} class={`map-box role-${box.role}`} />
          <text x={box.footprint.reduce((s, p) => s + p.x, 0) / 4} y={box.footprint.reduce((s, p) => s + p.z, 0) / 4} class="map-label">
            {box.name}
          </text>
        </g>
      ))}
      {calibrating &&
        refs.map((r) => {
          const i = pairIndex(r);
          const err = i >= 0 ? errors?.[i] : undefined;
          const fill = i >= 0 ? (err === undefined ? "#5b8fa8" : errorTone(err)) : "#fffaf0";
          const cls = `map-ref ${r.id === selected ? "is-selected" : ""} ${i >= 0 && i === suspect ? "is-suspect" : ""}`;
          const pick = () => {
            store.selectedRef.value = r.id;
            store.say(`Now click ${r.label} in the camera picture.`);
          };
          // Top corners are drawn just inside the box so they do not cover the floor corner.
          const at = r.kind === "top" ? inset(r) : { x: r.world.x, z: r.world.z };
          return r.kind === "top" ? (
            <rect key={r.id} x={at.x - 0.06} y={at.z - 0.06} width={0.12} height={0.12} rx={0.02} class={cls} fill={fill} onClick={pick}>
              <title>{r.label}</title>
            </rect>
          ) : (
            <circle key={r.id} cx={at.x} cy={at.z} r={0.075} class={cls} fill={fill} onClick={pick}>
              <title>{r.label}</title>
            </circle>
          );
        })}
      {samples.map((s) => {
        const spec = store.specs.value.find((w) => w.id === s.workerId);
        return (
          <circle key={s.workerId} cx={s.x} cy={s.z} r={0.13} class={`map-dot ${holding.has(s.workerId) ? "is-holding" : ""}`} fill={spec?.color ?? "#3b2f28"} />
        );
      })}
    </svg>
  );
}
