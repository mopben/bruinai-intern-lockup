/**
 * The camera tracker screen: picture on the left, everything else on the right.
 * Modes: Track (normal), Calibrate (match map points to the picture),
 * Sample / Measure (one worker's hat).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { CalibratePanel } from "./CalibratePanel";
import { CameraView } from "./CameraView";
import { createEngine, type Engine } from "./engine";
import { KitchenPicker } from "./KitchenPicker";
import { MiniMap } from "./MiniMap";
import { RecordPanel } from "./RecordPanel";
import { openVideoFile, SourceBar } from "./SourceBar";
import type { CameraStore } from "./store";
import { WorkerCards } from "./WorkerCards";

const LINK_WORDS = { open: "Connected to the laptop", connecting: "Connecting…", closed: "Not connected" } as const;

function Chips({ store }: { readonly store: CameraStore }) {
  const link = store.linkState.value;
  return (
    <div class="chips">
      <span class={`chip ${link === "open" ? "ok" : "bad"}`}>{LINK_WORDS[link]}</span>
      {link === "open" && <span class={`chip ${store.stageConnected.value ? "ok" : "warn"}`}>{store.stageConnected.value ? "Stage is listening" : "No stage open"}</span>}
      {store.reportsSent.value > 0 && <span class="chip quiet">{store.reportsSent.value} reports sent</span>}
    </div>
  );
}

export function App({ store }: { readonly store: CameraStore }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [engine, setEngine] = useState<Engine | undefined>(undefined);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideo(v);
    const e = createEngine(store, v);
    setEngine(e);
    return () => e.dispose();
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden && store.source.value.kind === "camera") {
        store.say("Keep this page visible: browsers slow down hidden pages and tracking would stutter.", "warn");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const mode = store.mode.value;
  const notice = store.notice.value;
  const setMode = (m: "track" | "calibrate") => {
    store.mode.value = m;
    store.activeWorker.value = undefined;
    store.selectedRef.value = undefined;
    store.say(m === "calibrate" ? "Pick a point on the map, then click the same spot in the picture." : "Tracking.");
  };

  return (
    <div
      class="camera-app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files[0];
        if (f && video) void openVideoFile(store, video, f);
      }}
    >
      <header>
        <h1>
          Dry Run <span>camera</span>
        </h1>
        <Chips store={store} />
        <KitchenPicker store={store} />
      </header>
      <main>
        <section class="left">
          <SourceBar store={store} video={video} />
          <CameraView store={store} engine={engine} videoRef={videoRef} />
          {notice && <p class={`notice tone-${notice.tone}`}>{notice.text}</p>}
        </section>
        <aside>
          <div class="modes">
            <button class={mode !== "calibrate" ? "on" : ""} onClick={() => setMode("track")}>
              Track
            </button>
            <button class={mode === "calibrate" ? "on" : ""} onClick={() => setMode("calibrate")} disabled={!store.calib.value}>
              Calibrate
            </button>
            {mode === "calibrate" && (
              <button class="done" onClick={() => setMode("track")}>
                Done
              </button>
            )}
          </div>
          <MiniMap store={store} />
          {mode === "calibrate" ? <CalibratePanel store={store} /> : <WorkerCards store={store} />}
          <RecordPanel store={store} engine={engine} />
        </aside>
      </main>
    </div>
  );
}
