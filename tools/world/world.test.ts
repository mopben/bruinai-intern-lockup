import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HANDOFF_REACH_M, STAND_OFF_M, type Layout, type PositionSample, type Scan, type Setup, type TapEvent } from "../../src/core/types";
import { FILE_NAMES, generateRun, type GeneratedRun } from "./generate";
import { corners, dist, penetration, standPointOf, type Rect } from "./geometry";
import { boxByKey } from "./room";
import { RUNS } from "./runs";
import { summarize } from "./summary";
import { validateRunFiles } from "./validator";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runs: readonly GeneratedRun[] = RUNS.map(generateRun);
const [A, B, C] = runs as [GeneratedRun, GeneratedRun, GeneratedRun];

const lines = <T>(text: string): T[] =>
  text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(1)
    .map((l) => JSON.parse(l) as T);
const taps = (r: GeneratedRun) => lines<TapEvent>(r.files["taps.jsonl"]);
const positions = (r: GeneratedRun) => lines<PositionSample>(r.files["positions.jsonl"]);
const parse = <T>(r: GeneratedRun, name: "scan.json" | "setup.json" | "layout.json") => JSON.parse(r.files[name]) as T;

describe("world generator", () => {
  it("is deterministic: same seed, byte-identical files", () => {
    for (const cfg of RUNS) {
      const again = generateRun(cfg);
      for (const name of FILE_NAMES) expect(again.files[name]).toBe(runs.find((r) => r.config.id === cfg.id)?.files[name]);
    }
  });

  it("uses a different seed per run, so the logs differ", () => {
    expect(new Set(RUNS.map((r) => r.seed)).size).toBe(RUNS.length);
    expect(A.files["taps.jsonl"]).not.toBe(C.files["taps.jsonl"]);
  });

  it("writes files the validator accepts with no errors or warnings", () => {
    for (const r of runs) {
      const report = validateRunFiles(r.files, r.config.id);
      expect(report.errors, r.config.id).toEqual([]);
      expect(report.warnings, r.config.id).toEqual([]);
    }
  });

  it("matches the fixtures on disk (run `npm run fixtures` after changing the world)", () => {
    for (const r of runs) {
      const dir = join(ROOT, "fixtures", r.config.id);
      if (!existsSync(dir)) continue;
      for (const name of FILE_NAMES) expect(readFileSync(join(dir, name), "utf8"), `${r.config.id}/${name}`).toBe(r.files[name]);
    }
  });

  it("changed runs differ from the original only where they say", () => {
    for (const r of [B, C]) {
      expect(r.files["scan.json"]).toBe(A.files["scan.json"]);
      expect(r.files["setup.json"]).toBe(A.files["setup.json"]);
    }
    const la = parse<Layout>(A, "layout.json");
    const lb = parse<Layout>(B, "layout.json");
    const lc = parse<Layout>(C, "layout.json");
    const fridge = A.ids.fridge;
    const moved = Object.keys(la.placements).filter((id) => JSON.stringify(la.placements[id]) !== JSON.stringify(lb.placements[id]));
    expect(moved).toEqual([fridge]);
    expect(lc.placements).toEqual(la.placements);
    expect(lc.workers.map((w) => w.id)).toEqual(["red", "blue", "yellow", "green"]);
    expect(lc.workers[3]?.stationId).toBe(A.ids.make);
    expect(lb.workers).toEqual(la.workers);
  });
});

describe("taps follow the schedule and the protocol", () => {
  it("shows each order at its scheduled time, same schedule in every run", () => {
    const schedule = parse<Setup>(A, "setup.json").schedule.orders;
    expect(schedule.length).toBeGreaterThanOrEqual(8);
    for (const r of runs) {
      const shown = taps(r).filter((e) => e.type === "order");
      expect(shown.map((e) => [e.orderId, e.t])).toEqual(schedule.map((o) => [o.orderId, o.t]));
    }
    const gaps = schedule.slice(1).map((o, i) => o.t - (schedule[i]?.t ?? 0));
    for (const g of gaps) {
      expect(g).toBeGreaterThan(4.5);
      expect(g).toBeLessThan(7.5);
    }
  });

  it("taps every step of every order, in step order, with increasing t", () => {
    for (const r of runs) {
      const events = taps(r);
      const shown = new Map(events.filter((e) => e.type === "order").map((e) => [e.orderId, e.t]));
      for (const [orderId, t0] of shown) {
        const dones = events.filter((e): e is Extract<TapEvent, { type: "done" }> => e.type === "done" && e.orderId === orderId);
        expect(dones.map((d) => d.step), `${r.config.id} ${orderId}`).toEqual([0, 1, 2]);
        const ts = [t0, ...dones.map((d) => d.t)];
        ts.slice(1).forEach((t, i) => expect(t).toBeGreaterThan(ts[i] as number));
      }
      const last = events[events.length - 1];
      expect(last?.type).toBe("end");
      events.forEach((e, i) => i > 0 && expect(e.t).toBeGreaterThanOrEqual((events[i - 1] as TapEvent).t));
    }
  });

  it("finishes every order inside 90 s; each run lasts 60 to 90 s", () => {
    for (const r of runs) {
      const end = taps(r).find((e) => e.type === "end");
      expect(end?.t, r.config.id).toBeGreaterThanOrEqual(60);
      expect(end?.t, r.config.id).toBeLessThanOrEqual(90);
    }
  });

  it("has a clear bottleneck at Make in run A that both changes relieve", () => {
    const [sa, sb, sc] = [A, B, C].map(summarize) as [ReturnType<typeof summarize>, ReturnType<typeof summarize>, ReturnType<typeof summarize>];
    expect(sa.meanOrderTime).toBeGreaterThan(sb.meanOrderTime * 1.3);
    expect(sa.meanOrderTime).toBeGreaterThan(sc.meanOrderTime * 1.3);
    expect(sa.maxQueue.make).toBeGreaterThanOrEqual(3);
    expect(sa.maxQueue.make).toBeGreaterThan(sb.maxQueue.make);
    expect(sa.maxQueue.make).toBeGreaterThan(sc.maxQueue.make);
    expect(sa.maxQueue.make).toBeGreaterThan(Math.max(sa.maxQueue.order, sa.maxQueue.finish));
  });
});

describe("the staged room", () => {
  it("fridge is about 2 m from Make in A and well under 1 m in B", () => {
    const make = boxByKey(A.room, "make");
    const at = (r: GeneratedRun, key: "make" | "fridge") => {
      const b = boxByKey(r.room, key);
      return standPointOf(b.rect, b.standSide, STAND_OFF_M);
    };
    expect(make.locked).toBe(true);
    expect(dist(at(A, "make"), at(A, "fridge"))).toBeGreaterThan(1.9);
    expect(dist(at(A, "make"), at(A, "fridge"))).toBeLessThan(2.6);
    expect(dist(at(B, "make"), at(B, "fridge"))).toBeLessThan(0.8);
  });

  it("no two blocking boxes overlap", () => {
    for (const r of runs) {
      const boxes = r.room.boxes.filter((b) => b.blocks);
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const probe = (x: Rect, y: Rect) => [...corners(x), { x: x.cx, z: x.cz }].some((p) => penetration(y, p) > 0);
          expect(probe(a.rect, b.rect) || probe(b.rect, a.rect), `${a.key} vs ${b.key}`).toBe(false);
        }),
      );
    }
  });

  it("hand-off or carry is the same whether judged from the true room or from the scan", () => {
    const scan = parse<Scan>(A, "scan.json");
    const setup = parse<Setup>(A, "setup.json");
    const rectOf = (id: string): Rect => {
      const b = scan.boxes.find((x) => x.id === id);
      if (!b) throw new Error(id);
      return { cx: b.center.x, cz: b.center.z, hw: b.size.w / 2, hd: b.size.d / 2, yaw: b.yaw };
    };
    const scanned = (id: string) => standPointOf(rectOf(id), "front", STAND_OFF_M);
    const truth = (k: "order" | "make" | "finish" | "pickup") => {
      const b = boxByKey(A.room, k);
      return standPointOf(b.rect, b.standSide, STAND_OFF_M);
    };
    const chain = ["order", "make", "finish", "pickup"] as const;
    chain.slice(1).forEach((k, i) => {
      const prev = chain[i] as (typeof chain)[number];
      const t = dist(truth(prev), truth(k));
      const s = dist(scanned(A.ids[prev]), scanned(A.ids[k]));
      expect(Math.abs(t - HANDOFF_REACH_M), `${prev}->${k} is not borderline`).toBeGreaterThan(0.08);
      expect(s <= HANDOFF_REACH_M, `${prev}->${k}`).toBe(t <= HANDOFF_REACH_M);
    });
    expect(setup.items.find((i) => i.boxId === A.ids.stool)?.role).toBe("ignore");
  });
});

describe("positions look like a camera watching real people", () => {
  it("stay inside the room and never inside furniture (within noise)", () => {
    for (const r of runs) {
      const scan = parse<Scan>(r, "scan.json");
      const setup = parse<Setup>(r, "setup.json");
      const layout = parse<Layout>(r, "layout.json");
      const solid = scan.boxes
        .filter((b) => !["ignore", "queue"].includes(setup.items.find((i) => i.boxId === b.id)?.role ?? ""))
        .map((b): Rect => {
          const p = layout.placements[b.id] ?? { x: b.center.x, z: b.center.z, yaw: b.yaw };
          return { cx: p.x, cz: p.z, hw: b.size.w / 2, hd: b.size.d / 2, yaw: p.yaw };
        });
      for (const p of positions(r)) {
        expect(p.x).toBeGreaterThan(0.1);
        expect(p.x).toBeLessThan(4.5);
        expect(p.z).toBeGreaterThan(0.1);
        expect(p.z).toBeLessThan(3.5);
        for (const s of solid) expect(penetration(s, p), `${r.config.id} ${p.workerId} t=${p.t}`).toBeLessThan(0);
      }
    }
  });

  it("nobody teleports: speed between samples stays human", () => {
    for (const r of runs) {
      const ps = positions(r);
      for (const id of new Set(ps.map((p) => p.workerId))) {
        const track = ps.filter((p) => p.workerId === id);
        track.slice(1).forEach((p, i) => {
          const q = track[i] as PositionSample;
          const dt = p.t - q.t;
          expect(dt).toBeGreaterThan(0);
          expect(dist(p, q), `${r.config.id} ${id} t=${p.t}`).toBeLessThan(1.4 * dt + 0.2);
        });
      }
    }
  });

  it("samples each worker about 10 times a second with a few gaps", () => {
    for (const r of runs) {
      const ps = positions(r);
      const end = taps(r).find((e) => e.type === "end")?.t ?? 0;
      const ids = [...new Set(ps.map((p) => p.workerId))];
      for (const id of ids) {
        const n = ps.filter((p) => p.workerId === id).length;
        const ideal = Math.floor(end * 10) + 1;
        expect(n).toBeLessThanOrEqual(ideal);
        expect(n).toBeGreaterThan(ideal * 0.95);
      }
      expect(ps.length).toBeLessThan(ids.length * (Math.floor(end * 10) + 1));
    }
  });

  it("show the Make worker walking to the fridge in A, and staying put in B", () => {
    const far = (r: GeneratedRun) => {
      const make = boxByKey(r.room, "make");
      const home = standPointOf(make.rect, make.standSide, STAND_OFF_M);
      return Math.max(...positions(r).filter((p) => p.workerId === "blue").map((p) => dist(p, home)));
    };
    expect(far(A)).toBeGreaterThan(1.5);
    expect(far(B)).toBeLessThan(0.8);
  });
});
