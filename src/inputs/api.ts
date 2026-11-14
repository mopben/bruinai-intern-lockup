/**
 * HTTP side of the inputs: response shapes shared with the server, and the
 * browser helpers that load runs, list them and save recordings.
 */
import type { RunBundle, RunMeta } from "../core/types";
import { OPTIONAL_RUN_FILES, parseRunFiles, RUN_FILES, type RunFiles } from "./bundle";
import { InputFormatError, unwrap } from "./parse";

/** Every JSON response from the server. */
export type ApiResponse<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/** One entry of GET /api/fixtures. */
export interface RunListing {
  readonly id: string;
  /** "fixtures" for shipped runs, "recordings" for runs saved on this laptop. */
  readonly origin: "fixtures" | "recordings";
  /** Folder URL to pass to loadRunBundle, ending in "/". */
  readonly url: string;
  /** run.json, if it parsed. */
  readonly meta?: RunMeta;
  /** Why run.json could not be read, if it could not. */
  readonly error?: string;
}

/** GET /api/info. */
export interface ServerInfo {
  readonly port: number;
  /** LAN IPv4 addresses of this laptop (may be empty with no network). */
  readonly addresses: readonly string[];
  readonly urls: {
    readonly stage: string;
    readonly tablet: string;
    readonly camera: string;
    /** Where the phone app POSTs its scan. */
    readonly scanUpload: string;
  };
  /** The same URLs for every address, the first being `urls`. */
  readonly allUrls: readonly ServerInfo["urls"][];
  /** Number of WebSocket clients connected, per role. */
  readonly clients: Readonly<Record<string, number>>;
}

/** POST /api/scan response data. */
export interface ScanReceipt {
  readonly savedAs: string;
  readonly boxes: number;
  readonly walls: number;
  readonly receivedAt: string;
}

/** POST /api/recordings response data. */
export interface RecordingReceipt {
  readonly id: string;
  /** Folder URL, loadable with loadRunBundle. */
  readonly url: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

async function readEnvelope<T>(response: Response, what: string): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${what}: the server sent something that is not JSON (HTTP ${response.status})`);
  }
  const envelope = body as Partial<ApiResponse<T>> | null;
  if (envelope === null || typeof envelope !== "object" || typeof envelope.success !== "boolean") {
    throw new Error(`${what}: unexpected reply from the server (HTTP ${response.status})`);
  }
  if (!envelope.success) throw new Error(`${what}: ${(envelope as { error?: string }).error ?? "failed"}`);
  return (envelope as { data: T }).data;
}

function joinUrl(base: string, file: string): string {
  return base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
}

const HTTP_NOT_FOUND = 404;

/** A file's text, or undefined if it is optional and the server says 404. Throws InputFormatError otherwise. */
async function fetchRunFile(url: string, fetchImpl: FetchLike, optional: boolean): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new InputFormatError(`Could not reach ${url} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (optional && response.status === HTTP_NOT_FOUND) return undefined;
  if (!response.ok) throw new InputFormatError(`Could not load ${url} (HTTP ${response.status})`);
  return response.text();
}

/**
 * Loads a run folder, e.g. loadRunBundle("/fixtures/counter-a/").
 * Optional files (actions.jsonl) that are not there are left out of the bundle.
 * Throws InputFormatError naming the file, line and field on bad data.
 */
export async function loadRunBundle(baseUrl: string, fetchImpl: FetchLike = defaultFetch): Promise<RunBundle> {
  const wanted = [
    ...Object.values(RUN_FILES).map((file) => ({ file, optional: false })),
    ...Object.values(OPTIONAL_RUN_FILES).map((file) => ({ file, optional: true })),
  ];
  const texts = await Promise.all(
    wanted.map(async ({ file, optional }) => [file, await fetchRunFile(joinUrl(baseUrl, file), fetchImpl, optional)] as const),
  );
  const files = Object.fromEntries(texts.filter(([, text]) => text !== undefined)) as unknown as RunFiles;
  return unwrap(parseRunFiles(files, baseUrl));
}

/** Lists fixtures and recordings on the server. */
export async function listFixtures(fetchImpl: FetchLike = defaultFetch): Promise<readonly RunListing[]> {
  return readEnvelope<readonly RunListing[]>(await fetchImpl("/api/fixtures"), "Listing runs");
}

export async function fetchServerInfo(fetchImpl: FetchLike = defaultFetch): Promise<ServerInfo> {
  return readEnvelope<ServerInfo>(await fetchImpl("/api/info"), "Reading server info");
}

/** Saves a run bundle to recordings/<id>/ on the laptop, in fixture format. */
export async function postRecording(bundle: RunBundle, fetchImpl: FetchLike = defaultFetch): Promise<RecordingReceipt> {
  const response = await fetchImpl("/api/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return readEnvelope<RecordingReceipt>(response, "Saving the recording");
}
