/**
 * The Dry Run laptop server: static app, fixtures, recordings, the phone scan
 * upload and the WebSocket relay. Never calls out to the internet.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { RecordingReceipt, ScanReceipt } from "../src/inputs/api";
import { validate } from "../src/inputs/parse";
import { runBundleSchema, scanSchema } from "../src/inputs/schemas";
import { HttpError, readJsonBody, sendData, sendError } from "./http-util";
import type { Logger } from "./logger";
import { serverInfo } from "./net-info";
import { createRelay, type Relay } from "./relay";
import { listRuns, saveScan, writeRecording } from "./runs";
import { safeResolve, serveFile } from "./static";

export interface ServerOptions {
  readonly distDir: string;
  readonly fixturesDir: string;
  readonly recordingsDir: string;
  readonly logger: Logger;
  /** 0 picks a free port (tests). */
  readonly port: number;
  readonly host?: string;
  readonly scanLimitBytes?: number;
  readonly recordingLimitBytes?: number;
  /** For tests; default: this machine's LAN addresses. */
  readonly addresses?: readonly string[];
}

export interface RunningServer {
  readonly port: number;
  readonly server: Server;
  readonly relay: Relay;
  close(): Promise<void>;
}

const PAGES: Readonly<Record<string, string>> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/tablet": "tablet.html",
  "/tablet/": "tablet.html",
  "/tablet.html": "tablet.html",
  "/camera": "camera.html",
  "/camera/": "camera.html",
  "/camera.html": "camera.html",
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Dry Run</title>
<body style="font-family:sans-serif;padding:2rem;background:#fbf4e6">
<h1>Dry Run is not built yet</h1><p>Run <code>npm start</code> (or <code>npm run build</code>) and reload this page.</p>`;

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const { logger } = options;
  const relay = createRelay({ logger });
  const scanLimit = options.scanLimitBytes ?? 5 * 1024 * 1024;
  const recordingLimit = options.recordingLimitBytes ?? 32 * 1024 * 1024;
  let port = options.port;

  async function postScan(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, scanLimit);
    const scan = validate(scanSchema, body, "scan");
    if (!scan.ok) throw new HttpError(400, scan.error);
    const receivedAt = new Date();
    const savedAs = await saveScan(options.recordingsDir, scan.value, receivedAt).catch((error: unknown) => {
      logger.error("Could not save a copy of the scan", { error: String(error) });
      return undefined;
    });
    relay.broadcast({
      channel: "scan",
      payload: { type: "scan", scan: scan.value, receivedAt: receivedAt.toISOString(), ...(savedAs ? { savedAs } : {}) },
    });
    logger.info("Scan received", { boxes: scan.value.boxes.length, walls: scan.value.walls.length, savedAs });
    const receipt: ScanReceipt = {
      savedAs: savedAs ?? "",
      boxes: scan.value.boxes.length,
      walls: scan.value.walls.length,
      receivedAt: receivedAt.toISOString(),
    };
    sendData(res, receipt);
  }

  async function postRecording(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, recordingLimit);
    const bundle = validate(runBundleSchema, body, "recording");
    if (!bundle.ok) throw new HttpError(400, bundle.error);
    const id = await writeRecording(options.recordingsDir, bundle.value);
    logger.info("Recording saved", { id, taps: bundle.value.taps.length, positions: bundle.value.positions.length });
    const receipt: RecordingReceipt = { id, url: `/recordings/${id}/` };
    sendData(res, receipt, 201);
  }

  async function serveFrom(root: string, prefix: string, path: string, res: ServerResponse) {
    const file = safeResolve(root, path.slice(prefix.length));
    if (file === undefined) throw new HttpError(400, "Bad path");
    if (!(await serveFile(res, file))) throw new HttpError(404, `Not found: ${path}`);
  }

  async function serveApp(path: string, res: ServerResponse) {
    const page = PAGES[path];
    const file = page !== undefined ? join(options.distDir, page) : safeResolve(options.distDir, path);
    if (file === undefined) throw new HttpError(400, "Bad path");
    const cache = path.startsWith("/assets/") ? "immutable" : "short";
    if (await serveFile(res, file, { cache })) return;
    if (page !== undefined) {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
      res.end(NOT_BUILT);
      return;
    }
    throw new HttpError(404, `Not found: ${path}`);
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const isRead = method === "GET" || method === "HEAD";

    if (path === "/api/info" && isRead) return sendData(res, serverInfo(port, relay.counts(), options.addresses));
    if (path === "/api/fixtures" && isRead) return sendData(res, await listRuns(options.fixturesDir, options.recordingsDir));
    if (path === "/api/scan" && method === "POST") return postScan(req, res);
    if (path === "/api/recordings" && method === "POST") return postRecording(req, res);
    if (path.startsWith("/api/")) throw new HttpError(path.match(/^\/api\/(info|fixtures|scan|recordings)$/) ? 405 : 404, `No such endpoint: ${method} ${path}`);
    if (!isRead) throw new HttpError(405, `Method ${method} not allowed`);
    if (path.startsWith("/fixtures/")) return serveFrom(options.fixturesDir, "/fixtures/", path, res);
    if (path.startsWith("/recordings/")) return serveFrom(options.recordingsDir, "/recordings/", path, res);
    return serveApp(path, res);
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) logger.error("Request failed", { method: req.method, url: req.url, error: message });
      else logger.debug("Request refused", { method: req.method, url: req.url, status, error: message });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, status, status >= 500 ? "Something went wrong on the laptop server; see its log" : message);
    });
  });
  server.on("upgrade", (req, socket, head) => relay.handleUpgrade(req, socket, head));

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      server.off("error", rejectStart);
      port = (server.address() as AddressInfo).port;
      resolveStart({
        port,
        server,
        relay,
        close: async () => {
          await relay.close();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
