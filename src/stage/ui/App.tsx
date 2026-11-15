/**
 * The stage app, VS Code style: an activity bar on the far left, a side
 * panel beside it, and the kitchen filling the rest.
 */
import { workersOpen } from "../state/economics";
import { WorkersSection } from "./WorkersSection";
import { useEffect } from "preact/hooks";
import { acceptDroppedScan } from "../state/input-actions";
import { installKeys } from "../state/keys";
import { activeSetupId, addNotice, bootError, currentStep, importOpen, loading, panel, view, workspaceReady } from "../state/store";
import { ScenarioControls, SetupControls } from "./LibraryControls";
import { STEPS, stepIndex } from "../app/steps";
import { ActivityBar, KeyHints, Notices, ResultsSwitch, Sash } from "./Chrome";
import { CompareView } from "./CompareView";
import { PlayRail } from "./PlayRail";
import { RunRail } from "./RunRail";
import { FilmedActions } from "./FilmedActions";
import { OrdersRail } from "./OrdersRail";
import { ImportMenu } from "./ImportMenu";
import { UploadIcon } from "./icons";
import { SceneHost } from "./SceneHost";

function BuildRail() {
  return <>
    <SetupControls />
    {activeSetupId.value ? <>
    <div class="st-row st-panel-actions st-build-import">
      <button type="button" class="st-btn" onClick={() => (importOpen.value = true)} data-testid="btn-import"><UploadIcon />Import</button>
    </div>
    <PlayRail />
    </> : null}
  </>;
}

function Rail() {
  if (!activeSetupId.value) return <SetupControls />;
  switch (view.value) {
    case "scan":
      return <BuildRail />;
    case "run":
      return <ScenarioControls single />;
    case "play":
      return <BuildRail />;
    case "orders":
      return <OrdersRail />;
    case "test":
      return <ScenarioControls single />;
    case "compare":
      return <ScenarioControls />;
    case "filmed":
      return <><RunRail /><FilmedActions /></>;
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
  const comparing = view.value === "compare" || view.value === "run";
  const p = panel.value;
  const step = STEPS[stepIndex(currentStep.value)]!;
  return (
    <div class={`st-root${comparing ? " compare" : ""}${p.open ? "" : " panel-closed"}`} style={{ "--st-panel": `${p.width}px` } as never}>
      <ActivityBar />
      {p.open ? (
        <aside class="st-panel" data-testid="side-panel">
          <div class="st-panel-head">
            <span class="st-mark">Dry Run</span>
            <span class="st-panel-title">
              {stepIndex(currentStep.value) + 1}. {step.name}
            </span>
          </div>
          {step.id === "results" ? <ResultsSwitch /> : null}
          <div class="st-panel-body st-rail">
            <Rail />
          </div>
          <div class="st-panel-foot">
            <KeyHints />
          </div>
          <Sash />
        </aside>
      ) : null}
      <main class="st-stage">
        {activeSetupId.value ? <>
          <SceneHost hidden={comparing} />
          {comparing ? <CompareView single={view.value === "run"} /> : null}
        </> : workspaceReady.value ? <div class="st-center"><div class="st-center-card"><h2>Create your first setup</h2><p>Start in Setup to configure your kitchen.</p></div></div> : null}
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
      {workersOpen.value ? <WorkersSection /> : null}
      {importOpen.value ? <ImportMenu /> : null}
    </div>
  );
}
