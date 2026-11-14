/**
 * The stage's connection to the laptop server: who is connected, the LAN
 * addresses, live scans from the phone, and the kitchen message the camera
 * page calibrates from. Losing the server never stops the demo: replay needs
 * none of this.
 */
import { effect } from "@preact/signals";
import {
  controlMessageSchema,
  createLiveScanFeed,
  createReconnectingSocket,
  fetchServerInfo,
  watchPresence,
  type KitchenMessage,
  type MessageLink,
  type ScanFeed,
} from "../../inputs";
import { kitchen, linkState, playLayout, presence, serverInfo, step } from "./store";

const KITCHEN_DEBOUNCE_MS = 400;
const INFO_EVERY_MS = 15000;

let link: MessageLink | null = null;
let scanFeed: ScanFeed | null = null;

export function stageLink(): MessageLink | null {
  return link;
}

export function liveScanFeed(): ScanFeed | null {
  return scanFeed;
}

/** The kitchen as it is now on the stage (the judge's layout while in Play or later). */
export function currentKitchenMessage(): KitchenMessage | null {
  const k = kitchen.value;
  if (!k) return null;
  const judging = step.value === "play" || step.value === "test" || step.value === "compare";
  const layout = judging && playLayout.value ? playLayout.value : k.layout;
  return { type: "kitchen", scan: k.scan, setup: k.setup, layout };
}

function sendKitchen(): void {
  const message = currentKitchenMessage();
  if (message && link) link.send("control", message);
}

async function refreshInfo(): Promise<void> {
  try {
    serverInfo.value = await fetchServerInfo();
  } catch {
    // No server (static preview or the server stopped): the drawer says so; replay still works.
    serverInfo.value = null;
  }
}

export function connectStage(): void {
  if (link) return;
  const l = createReconnectingSocket({ role: "stage" });
  link = l;
  scanFeed = createLiveScanFeed(l);
  linkState.value = l.state();
  l.onState((s) => {
    linkState.value = s;
    if (s === "open") {
      sendKitchen();
      void refreshInfo();
    }
  });
  watchPresence(l, (roles) => {
    presence.value = roles;
  });
  l.subscribe("control", (payload) => {
    const parsed = controlMessageSchema.safeParse(payload);
    if (parsed.success && parsed.data.type === "sync-request") sendKitchen();
  });
  void refreshInfo();
  setInterval(() => void refreshInfo(), INFO_EVERY_MS);

  // Debounced: a drag sends once it settles, not on every frame.
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    void kitchen.value;
    void playLayout.value;
    void step.value;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(sendKitchen, KITCHEN_DEBOUNCE_MS);
  });
}
