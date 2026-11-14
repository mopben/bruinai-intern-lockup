/**
 * Run folders on disk: listing fixtures and recordings, writing recordings and
 * saving received scans. Directories are injected so tests use temp folders.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunBundle, Scan } from "../src/core/types";
import type { RunListing } from "../src/inputs/api";
import { serialiseRunBundle } from "../src/inputs/bundle";
import { parseRunMeta } from "../src/inputs/parse";

export const SCANS_FOLDER = "scans";

/** Lowercase letters, digits, - and _; at most 64 characters. Empty if nothing usable remains. */
export function sanitiseId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
}

async function subfolders(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function listing(dir: string, id: string, origin: RunListing["origin"]): Promise<RunListing> {
  const url = `/${origin}/${encodeURIComponent(id)}/`;
  let text: string;
  try {
    text = await readFile(join(dir, id, "run.json"), "utf8");
  } catch {
    return { id, origin, url, error: `${origin}/${id}/run.json is missing` };
  }
  const meta = parseRunMeta(text, `${origin}/${id}/run.json`);
  return meta.ok ? { id, origin, url, meta: meta.value } : { id, origin, url, error: meta.error };
}

/** Fixtures (by name) then recordings (newest first). */
export async function listRuns(fixturesDir: string, recordingsDir: string): Promise<readonly RunListing[]> {
  const fixtures = await Promise.all((await subfolders(fixturesDir)).map((id) => listing(fixturesDir, id, "fixtures")));
  const recordingIds = (await subfolders(recordingsDir)).filter((id) => id !== SCANS_FOLDER);
  const recordings = await Promise.all(recordingIds.map((id) => listing(recordingsDir, id, "recordings")));
  const newest = [...recordings].sort((a, b) => (b.meta?.recordedAt ?? "").localeCompare(a.meta?.recordedAt ?? ""));
  return [...fixtures, ...newest];
}

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

/** A free folder id: `id`, then `id-2`, `id-3`, ... */
async function freeId(dir: string, id: string): Promise<string> {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? id : `${id}-${n}`;
    if (!(await exists(join(dir, candidate)))) return candidate;
  }
  throw new Error(`Too many recordings named ${id}`);
}

/**
 * Writes a bundle as recordings/<id>/ in fixture format. The id comes from
 * meta.id, sanitised; if that folder exists a suffix is added. Writes to a
 * temporary folder first, then renames, so a half-written run never appears.
 * The written run.json carries the final id.
 */
export async function writeRecording(recordingsDir: string, bundle: RunBundle): Promise<string> {
  const wanted = sanitiseId(bundle.meta.id);
  const base = wanted === "" || wanted === SCANS_FOLDER ? "recording" : wanted;
  await mkdir(recordingsDir, { recursive: true });
  const id = await freeId(recordingsDir, base);
  const files = serialiseRunBundle({ ...bundle, meta: { ...bundle.meta, id } });
  const temp = join(recordingsDir, `.tmp-${id}-${process.pid}-${Date.now()}`);
  await mkdir(temp, { recursive: true });
  try {
    await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(temp, name), text, "utf8")));
    await rename(temp, join(recordingsDir, id));
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return id;
}

/** Saves a received scan under recordings/scans/. Returns the path relative to recordingsDir. */
export async function saveScan(recordingsDir: string, scan: Scan, receivedAt: Date): Promise<string> {
  const dir = join(recordingsDir, SCANS_FOLDER);
  await mkdir(dir, { recursive: true });
  const stamp = receivedAt.toISOString().replace(/[:.]/g, "-");
  const name = `scan-${stamp}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(scan, null, 2)}\n`, "utf8");
  return `${SCANS_FOLDER}/${name}`;
}
