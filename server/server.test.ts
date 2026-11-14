import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { parseRunFiles, serialiseRunBundle } from "../src/inputs/bundle";
import { unwrap } from "../src/inputs/parse";
import { testBundle, testScan } from "../src/inputs/test-data";
import { startServer, type RunningServer } from "./app";
import { createMemoryLogger } from "./logger";
import { lanAddresses, serverInfo } from "./net-info";
import { sanitiseId } from "./runs";
import { safeResolve } from "./static";

let dir: string;
let running: RunningServer;
let base: string;
const logger = createMemoryLogger();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dryrun-server-"));
  const dist = join(dir, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<html>stage</html>");
  await writeFile(join(dist, "tablet.html"), "<html>tablet</html>");
  await writeFile(join(dist, "assets", "app.js"), "export {}");
  await writeFile(join(dir, "secret.txt"), "do not serve");
  const fixtureDir = join(dir, "fixtures", "test-run");
  await mkdir(fixtureDir, { recursive: true });
  for (const [name, text] of Object.entries(serialiseRunBundle(testBundle))) await writeFile(join(fixtureDir, name), text);
  await mkdir(join(dir, "fixtures", "broken"), { recursive: true });
  await writeFile(join(dir, "fixtures", "broken", "run.json"), "{}");
  running = await startServer({
    port: 0,
    host: "127.0.0.1",
    distDir: dist,
    fixturesDir: join(dir, "fixtures"),
    recordingsDir: join(dir, "recordings"),
    logger,
    addresses: ["192.168.1.20"],
    scanLimitBytes: 64 * 1024,
  });
  base = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
  await rm(dir, { recursive: true, force: true });
});

/** Raw request, so paths like /../ are sent as typed (fetch would normalise them). */
function raw(method: string, path: string, body?: string): Promise<{ status: number; type: string; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, path }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const json = async (method: string, path: string, body?: unknown) => {
  const r = await raw(method, path, body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  return { status: r.status, body: JSON.parse(r.text) as { success: boolean; data?: any; error?: string } };
};

function connect(role: string): Promise<{ ws: WebSocket; messages: any[]; next: (pred: (m: any) => boolean) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}/ws?role=${role}`);
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; done: (m: any) => void }[] = [];
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      messages.push(m);
      for (const w of [...waiters]) if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.done(m);
      }
    });
    const next = (pred: (m: any) => boolean) =>
      new Promise<any>((done) => {
        const found = messages.find(pred);
        if (found !== undefined) return done(found);
        waiters.push({ pred, done });
      });
    ws.on("open", () => resolve({ ws, messages, next }));
    ws.on("error", reject);
  });
}

describe("static files", () => {
  it("maps the pages and assets with MIME types", async () => {
    expect(await raw("GET", "/")).toMatchObject({ status: 200, type: "text/html; charset=utf-8", text: "<html>stage</html>" });
    expect((await raw("GET", "/tablet")).text).toBe("<html>tablet</html>");
    expect((await raw("GET", "/assets/app.js")).type).toBe("text/javascript; charset=utf-8");
  });

  it("explains when the app is not built", async () => {
    const r = await raw("GET", "/camera");
    expect(r.status).toBe(503);
    expect(r.text).toMatch(/not built yet/);
  });

  it("refuses directory traversal", async () => {
    for (const path of ["/../secret.txt", "/assets/..%2f..%2fsecret.txt", "/fixtures/..%2F..%2Fsecret.txt", "/fixtures/%2e%2e/secret.txt", "/fixtures/a%00b", "/assets/%E0%A4%A"]) {
      const r = await raw("GET", path);
      expect([400, 404]).toContain(r.status);
      expect(r.text).not.toContain("do not serve");
    }
    expect(safeResolve("/srv/root", "/a/../../etc/passwd")).toBeUndefined();
    expect(safeResolve("/srv/root", "/a/b.json")).toBe("/srv/root/a/b.json");
    expect(safeResolve("/srv/root", "/x\\..\\y")).toBeUndefined();
  });

  it("serves fixture files, 404s missing ones", async () => {
    const r = await raw("GET", "/fixtures/test-run/taps.jsonl");
    expect(r.type).toBe("application/x-ndjson; charset=utf-8");
    expect(r.text.split("\n")[0]).toContain('"dryrun.taps"');
    expect(await json("GET", "/fixtures/test-run/nope.json")).toMatchObject({ status: 404, body: { success: false } });
    expect((await json("GET", "/fixtures/test-run")).status).toBe(404);
  });
});

describe("api", () => {
  it("GET /api/info gives LAN URLs", async () => {
    const { body } = await json("GET", "/api/info");
    expect(body.success).toBe(true);
    expect(body.data.urls).toEqual({
      stage: `http://192.168.1.20:${running.port}/`,
      tablet: `http://192.168.1.20:${running.port}/tablet`,
      camera: `http://192.168.1.20:${running.port}/camera`,
      scanUpload: `http://192.168.1.20:${running.port}/api/scan`,
    });
    expect(body.data.clients).toEqual({ stage: 0, tablet: 0, camera: 0, other: 0 });
  });

  it("falls back to localhost with no network", () => {
    expect(serverInfo(5179, {}, []).urls.tablet).toBe("http://localhost:5179/tablet");
    expect(lanAddresses({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never], en0: [{ address: "8.8.8.8", family: "IPv4", internal: false } as never, { address: "10.0.0.2", family: "IPv4", internal: false } as never] })).toEqual(["10.0.0.2", "8.8.8.8"]);
  });

  it("GET /api/fixtures lists runs with their meta, and broken ones with a reason", async () => {
    const { body } = await json("GET", "/api/fixtures");
    expect(body.data).toEqual([
      { id: "broken", origin: "fixtures", url: "/fixtures/broken/", error: expect.stringMatching(/^fixtures\/broken\/run\.json: field "format"/) },
      { id: "test-run", origin: "fixtures", url: "/fixtures/test-run/", meta: testBundle.meta },
    ]);
  });

  it("unknown endpoints and wrong methods get JSON errors", async () => {
    expect(await json("GET", "/api/nope")).toMatchObject({ status: 404, body: { success: false } });
    expect(await json("GET", "/api/scan")).toMatchObject({ status: 405 });
    expect((await json("POST", "/tablet", "{}")).status).toBe(405);
  });

  it("POST /api/scan rejects a bad scan with a useful message", async () => {
    const bad = { ...testScan, boxes: [{ ...testScan.boxes[0], center: { x: 0, y: 0 } }] };
    expect(await json("POST", "/api/scan", bad)).toEqual({
      status: 400,
      body: { success: false, error: 'scan: field "boxes[0].center.z" is missing (expected number)' },
    });
    expect((await json("POST", "/api/scan", "{oops")).body.error).toMatch(/not valid JSON/);
    expect((await json("POST", "/api/scan", "")).body.error).toMatch(/empty/);
    const big = await json("POST", "/api/scan", JSON.stringify({ pad: "x".repeat(70 * 1024) }));
    expect(big.status).toBe(413);
  });

  it("POST /api/scan broadcasts on channel scan and saves a copy", async () => {
    const stage = await connect("stage");
    const r = await json("POST", "/api/scan", testScan);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ boxes: 3, walls: 1, savedAs: expect.stringMatching(/^scans\/scan-.*\.json$/) });
    const msg = await stage.next((m) => m.channel === "scan");
    expect(msg.payload).toMatchObject({ type: "scan", scan: testScan, savedAs: r.body.data.savedAs });
    const saved = JSON.parse(await readFile(join(dir, "recordings", r.body.data.savedAs), "utf8"));
    expect(saved).toEqual(testScan);
    stage.ws.close();
  });

  it("POST /api/recordings writes the six files in fixture format, sanitising the id", async () => {
    const bundle = { ...testBundle, meta: { ...testBundle.meta, id: "../../Evil Run!", source: "recorded" as const } };
    const r = await json("POST", "/api/recordings", bundle);
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ id: "evil-run", url: "/recordings/evil-run/" });
    const folder = join(dir, "recordings", "evil-run");
    const names = await readdir(folder);
    expect(names.sort()).toEqual(["layout.json", "positions.jsonl", "run.json", "scan.json", "setup.json", "taps.jsonl"]);
    const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(join(folder, n), "utf8")])));
    expect(unwrap(parseRunFiles(files))).toEqual({ ...bundle, meta: { ...bundle.meta, id: "evil-run" } });

    const again = await json("POST", "/api/recordings", bundle);
    expect(again.body.data.id).toBe("evil-run-2");
    const listed = (await json("GET", "/api/fixtures")).body.data.map((l: any) => `${l.origin}/${l.id}`);
    expect(listed).toEqual(expect.arrayContaining(["recordings/evil-run", "recordings/evil-run-2"]));
    expect(listed).not.toContain("recordings/scans");

    const served = await raw("GET", "/recordings/evil-run/run.json");
    expect(JSON.parse(served.text).id).toBe("evil-run");
  });

  it("POST /api/recordings rejects an invalid bundle", async () => {
    const r = await json("POST", "/api/recordings", { ...testBundle, taps: [{ type: "done", t: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^recording: field "taps\[0\]\.orderId" is missing/);
  });

  it("sanitises ids", () => {
    expect(sanitiseId("Counter A / take 2")).toBe("counter-a-take-2");
    expect(sanitiseId("...")).toBe("");
    expect(sanitiseId("x".repeat(100))).toHaveLength(64);
  });
});

describe("websocket relay", () => {
  it("relays envelopes to every other client and announces presence", async () => {
    const stage = await connect("stage");
    const tablet = await connect("tablet");
    const presence = await stage.next((m) => m.channel === "control" && m.payload.roles?.tablet === 1);
    expect(presence.payload).toEqual({ type: "presence", roles: { stage: 1, tablet: 1, camera: 0, other: 0 } });

    tablet.ws.send(JSON.stringify({ channel: "taps", payload: { type: "tap", tapId: "1", orderId: "o1", step: 0, stationId: "s" } }));
    const got = await stage.next((m) => m.channel === "taps");
    expect(got.payload.tapId).toBe("1");
    expect(tablet.messages.some((m) => m.channel === "taps")).toBe(false);

    tablet.ws.send("not json");
    tablet.ws.send(JSON.stringify({ channel: "bogus", payload: 1 }));
    stage.ws.send(JSON.stringify({ channel: "control", payload: { type: "run-state" } }));
    await tablet.next((m) => m.channel === "control" && m.payload.type === "run-state");
    expect(stage.messages.filter((m) => m.channel !== "control")).toHaveLength(1);

    const info = await json("GET", "/api/info");
    expect(info.body.data.clients).toMatchObject({ stage: 1, tablet: 1 });

    tablet.ws.close();
    await stage.next((m) => m.channel === "control" && m.payload.type === "presence" && m.payload.roles.tablet === 0);
    stage.ws.close();
  });

  it("refuses upgrades on other paths", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}/other`);
    await new Promise<void>((done) => ws.on("error", () => done()));
  });

  it("logs without console", () => {
    expect(logger.lines.some((l) => l.includes("stage connected"))).toBe(true);
  });
});
