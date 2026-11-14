/**
 * The stage app: the kitchen as the hero, the step strip on top, one paper
 * rail with the step's words and numbers, keys and inputs along the bottom.
 */
import { useEffect } from "preact/hooks";
import { acceptDroppedScan } from "../state/input-actions";
import { installKeys } from "../state/keys";
import { addNotice, bootError, loading, step } from "../state/store";
import { InputsChip, KeyHints, Notices, StepStrip } from "./Chrome";
import { CompareView } from "./CompareView";
import { InputsDrawer } from "./InputsDrawer";
import { PlayRail } from "./PlayRail";
import { RunRail } from "./RunRail";
import { ScanRail } from "./ScanRail";
import { SceneHost } from "./SceneHost";
import { TestRail } from "./TestRail";
import { TrustRail } from "./TrustRail";

function Rail() {
  switch (step.value) {
    case "scan":
      return <ScanRail />;
    case "run":
      return <RunRail />;
    case "trust":
      return <TrustRail />;
    case "play":
      return <PlayRail />;
    case "test":
      return <TestRail />;
    default:
      return null;
  }
}

function useDropScan(): void {
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      file.text().then(
        (text) => acceptDroppedScan(text, file.name),
        () => addNotice({ id: "drop", text: `Could not read ${file.name}.`, tone: "warn" }),
      );
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

export function App() {
  useEffect(() => installKeys(), []);
  useDropScan();
  const comparing = step.value === "compare";
  return (
    <div class={`st-root${comparing ? " compare" : ""}`}>
      <header class="st-top">
        <div class="st-mark">
          Dry Run
          <small>scan, change one thing, run again</small>
        </div>
        <StepStrip />
      </header>
      <main class="st-stage">
        <SceneHost hidden={comparing} />
        {comparing ? <CompareView /> : null}
        <Notices />
        {bootError.value ? (
          <div class="st-center">
            <div class="st-center-card">
              <h2>The run did not load</h2>
              <p>{bootError.value}</p>
              <p class="st-small">Check that the laptop server is running (npm start), then reload this page.</p>
            </div>
          </div>
        ) : loading.value ? (
          <div class="st-center">
            <p class="st-say">Loading the kitchen…</p>
          </div>
        ) : null}
      </main>
      <aside class="st-rail">
        <Rail />
      </aside>
      <footer class="st-bottom">
        <KeyHints />
        <InputsChip />
      </footer>
      <InputsDrawer />
    </div>
  );
}
