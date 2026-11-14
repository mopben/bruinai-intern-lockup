/**
 * Camera page state: the kitchen, the source, the calibration, the latest
 * tracking result and the recording. Signals, replaced never mutated.
 */
import { computed, signal } from "@preact/signals";
import { kitchenMessageSchema, presenceSchema } from "../../inputs/protocol";
import type { MessageLink, LinkState } from "../../inputs/socket";
import { emptyCalibration, rescaleCalibration, type CalibrationFile } from "../calib-file";
import { solveCalibration, type PointPair } from "../calibration";
import { targetFromHex, type Hsv } from "../color";
import { kitchenView, type Kitchen, type KitchenView } from "../kitchen";
import { DEFAULT_HAT_HEIGHT_M, type FrameResult, type WorkerSpec } from "../pipeline";
import type { Recording } from "../recorder";
import { loadStored, store } from "./storage";

export type Mode = "track" | "calibrate" | "sample" | "height";

export interface LoadedKitchen {
  readonly kitchen: Kitchen;
  readonly view: KitchenView;
  readonly from: string;
}

export type SourceInfo =
  | { readonly kind: "none" }
  | { readonly kind: "camera"; readonly key: string; readonly label: string; readonly deviceId: string }
  | { readonly kind: "file"; readonly key: string; readonly name: string };

export interface Notice {
  readonly text: string;
  readonly tone: "ok" | "warn";
}

export function createCameraStore(link: MessageLink) {
  const kitchen = signal<LoadedKitchen | undefined>(undefined);
  const linkState = signal<LinkState>(link.state());
  const stageConnected = signal(false);
  const source = signal<SourceInfo>({ kind: "none" });
  const size = signal<{ width: number; height: number } | undefined>(undefined);
  const calib = signal<CalibrationFile | undefined>(undefined);
  const mode = signal<Mode>("track");
  const selectedRef = signal<string | undefined>(undefined);
  const activeWorker = signal<string | undefined>(undefined);
  const result = signal<FrameResult | undefined>(undefined);
  const recording = signal<Recording | undefined>(undefined);
  const offline = signal<{ readonly done: number; readonly total: number } | undefined>(undefined);
  const notice = signal<Notice | undefined>(undefined);
  const reportsSent = signal(0);
  /** Per worker: share of recent frames with the hat found (rolling, about the last 2 s). */
  const lockRate = signal<ReadonlyMap<string, number>>(new Map());

  const solved = computed(() => {
    const c = calib.value;
    return c ? solveCalibration(c.pairs, c.imageSize) : undefined;
  });
  const model = computed(() => (solved.value?.ok ? solved.value.value.model : undefined));

  const specs = computed((): readonly (WorkerSpec & { name: string; color: string; sampled: boolean })[] => {
    const k = kitchen.value;
    if (!k) return [];
    const c = calib.value;
    return k.view.workers.map((w) => {
      const fromHex = targetFromHex(w.color);
      const sampled = c?.colours[w.id];
      const target: Hsv = sampled ?? (fromHex.ok ? fromHex.value : { h: 0, s: 1, v: 1 });
      return { id: w.id, name: w.name, color: w.color, target, sampled: sampled !== undefined, hatHeightM: c?.hatHeights[w.id] ?? DEFAULT_HAT_HEIGHT_M };
    });
  });

  const say = (text: string, tone: Notice["tone"] = "ok") => {
    notice.value = { text, tone };
  };

  function setCalib(next: CalibrationFile) {
    const stamped = { ...next, savedAt: new Date().toISOString() };
    calib.value = stamped;
    const problem = store(stamped);
    if (problem) say(problem, "warn");
  }

  /** Picks up the stored calibration for this camera and kitchen, if any. */
  function reloadCalibration() {
    const k = kitchen.value;
    const s = source.value;
    const sz = size.value;
    if (!k || s.kind === "none" || !sz) {
      calib.value = undefined;
      return;
    }
    const stored = loadStored(s.key, k.view.key);
    calib.value = stored ? rescaleCalibration(stored, sz) : emptyCalibration(s.key, k.view.key, sz);
  }

  function setKitchen(k: Kitchen, from: string) {
    const v = kitchenView(k);
    if (!v.ok) {
      say(`The kitchen from ${from} cannot be used: ${v.error}`, "warn");
      return;
    }
    const sameScan = kitchen.value?.view.key === v.value.key;
    kitchen.value = { kitchen: k, view: v.value, from };
    if (!sameScan) reloadCalibration();
  }

  function addPair(pair: PointPair) {
    const c = calib.value;
    if (!c) return;
    const rest = c.pairs.filter((p) => !(pair.refId && p.refId === pair.refId));
    setCalib({ ...c, pairs: [...rest, pair] });
  }

  function removePair(index: number) {
    const c = calib.value;
    if (c) setCalib({ ...c, pairs: c.pairs.filter((_, i) => i !== index) });
  }

  function setColour(workerId: string, hsv: Hsv | undefined) {
    const c = calib.value;
    if (!c) return;
    const { [workerId]: _old, ...rest } = c.colours;
    setCalib({ ...c, colours: hsv ? { ...rest, [workerId]: { h: hsv.h, s: hsv.s, v: hsv.v } } : rest });
  }

  function setHatHeight(workerId: string, metres: number) {
    const c = calib.value;
    if (!c || !(metres >= 0.5 && metres <= 2.5)) return;
    setCalib({ ...c, hatHeights: { ...c.hatHeights, [workerId]: Math.round(metres * 1000) / 1000 } });
  }

  const offs = [
    link.onState((s) => {
      linkState.value = s;
      if (s === "open") link.send("control", { type: "sync-request", role: "camera" });
    }),
    link.subscribe("control", (payload) => {
      const k = kitchenMessageSchema.safeParse(payload);
      if (k.success) {
        setKitchen({ scan: k.data.scan, setup: k.data.setup, layout: k.data.layout }, "the stage");
        return;
      }
      const p = presenceSchema.safeParse(payload);
      if (p.success) stageConnected.value = p.data.roles.stage > 0;
    }),
  ];
  if (link.state() === "open") link.send("control", { type: "sync-request", role: "camera" });

  return {
    link,
    kitchen,
    linkState,
    stageConnected,
    source,
    size,
    calib,
    solved,
    model,
    specs,
    mode,
    selectedRef,
    activeWorker,
    result,
    recording,
    offline,
    notice,
    reportsSent,
    lockRate,
    say,
    setCalib,
    reloadCalibration,
    setKitchen,
    addPair,
    removePair,
    setColour,
    setHatHeight,
    dispose: () => offs.forEach((off) => off()),
  };
}

export type CameraStore = ReturnType<typeof createCameraStore>;
