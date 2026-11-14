/**
 * Start-up: read the URL, load the base run and the list of second runs,
 * connect to the laptop server. Every failure ends in a plain message on
 * screen, never a blank page.
 */
import { batch } from "@preact/signals";
import { listFixtures, loadRunBundle, parseLayout, type RunListing } from "../../inputs";
import type { Candidate } from "../app/layout-match";
import type { StageParams } from "../app/params";
import { useRecordedKitchen, waitForLiveScan } from "./kitchen-actions";
import { connectStage } from "./link";
import { preloadSecondRuns } from "./preload";
import { stopAllPlayback } from "./runs";
import { addNotice, base, bootError, candidates, catalog, firstRun, loading, params, secondChoice, sources, step } from "./store";

async function loadCandidate(listing: RunListing): Promise<Candidate | null> {
  if (!listing.meta) return null;
  try {
    const response = await fetch(`${listing.url}layout.json`);
    if (!response.ok) return null;
    const parsed = parseLayout(await response.text(), `${listing.id}/layout.json`);
    return parsed.ok ? { id: listing.id, meta: listing.meta, layout: parsed.value, url: listing.url } : null;
  } catch {
    return null;
  }
}

async function readCatalog(): Promise<readonly RunListing[]> {
  try {
    return await listFixtures();
  } catch {
    addNotice({ id: "catalog", text: "Could not list the recorded runs. Only the base run is available.", tone: "warn" });
    return [];
  }
}

/** Loads (or switches to) the base run. Keeps the current step. */
export async function loadBase(runId: string): Promise<void> {
  loading.value = true;
  stopAllPlayback();
  const list = await readCatalog();
  catalog.value = list;
  const listing = list.find((l) => l.id === runId);
  const url = listing?.url ?? `/fixtures/${encodeURIComponent(runId)}/`;
  try {
    const bundle = await loadRunBundle(url);
    // Second runs: recorded changes of this base run. Layouts only; their logs load in Test.
    const others = list.filter((l) => l.id !== runId && l.meta?.baseRunId === runId);
    const loaded = (await Promise.all(others.map(loadCandidate))).filter((c): c is Candidate => c !== null);
    batch(() => {
      bootError.value = null;
      base.value = bundle;
      candidates.value = loaded;
      secondChoice.value = "auto";
      firstRun.value = {
        label: bundle.meta.id,
        kitchen: { scan: bundle.scan, setup: bundle.setup, layout: bundle.layout },
        taps: bundle.taps,
        positions: bundle.positions,
        origin: "recorded",
        title: bundle.meta.title,
        replaced: [],
      };
      params.value = { ...params.value, runId };
    });
    if (sources.value.scan === "replay") useRecordedKitchen(step.value === "scan");
    else waitForLiveScan();
    // Whole second runs in memory now, so Test needs no server later.
    await preloadSecondRuns(loaded);
  } catch (error) {
    bootError.value = `Could not load the run "${runId}": ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    loading.value = false;
  }
}

export async function boot(p: StageParams): Promise<void> {
  const mode = p.mode === "live" ? "live" : "replay";
  batch(() => {
    params.value = p;
    step.value = p.step;
    sources.value = { scan: mode, taps: mode, positions: mode };
  });
  connectStage();
  await loadBase(p.runId);
}
