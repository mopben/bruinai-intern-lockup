import { LibraryDropdown } from "./LibraryDropdown";
import { activeSetupId, activeShiftId, loading, workspaceReady } from "../state/store";
import {
  chooseScenario, createSetup, createShift, renameSetup, renameShift, resolvedChoice,
  savedSetups, savedShifts, selectSetup, selectShift, workspaceProblem,
} from "../state/workspace";

function SetupOptions() {
  return <>{savedSetups.value.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</>;
}

export function SetupControls() {
  const active = savedSetups.value.find((entry) => entry.id === activeSetupId.value);
  return <div class="st-card st-library" data-testid="setup-library">
    <h1>Setups</h1>
    <LibraryDropdown kind="setup" entries={savedSetups.value} activeId={activeSetupId.value} disabled={!workspaceReady.value || loading.value} onSelect={selectSetup} onCreate={createSetup} onRename={(name) => renameSetup({ name })} />
    {!active ? <p>Create a setup to import a kitchen and configure its layout and workers.</p> : null}
    {workspaceProblem.value ? <p role="status" class="st-note">{workspaceProblem.value}</p> : null}
  </div>;
}

export function ShiftControls() {
  const active = savedShifts.value.find((entry) => entry.id === activeShiftId.value);
  return <div class="st-library" data-testid="shift-library">
    <h1>Shifts</h1>
    <LibraryDropdown kind="shift" entries={savedShifts.value} activeId={activeShiftId.value} disabled={!workspaceReady.value || loading.value || !activeSetupId.value} onSelect={selectShift} onCreate={() => createShift()} onRename={renameShift} />
    {!active ? <p>Create a shift to organize its orders and quantities.</p> : null}
  </div>;
}

export function ScenarioControls({ single = false }: { single?: boolean }) {
  return <div class="st-card st-library" data-testid="scenario-controls">
    <h1>{single ? "Run scenario" : "Compare scenario"}</h1>
    {(single ? [0] : [0, 1]).map((index) => {
      const choice = resolvedChoice(index);
      const name = single ? "Scenario" : index === 0 ? "Left" : "Right";
      return <fieldset class="st-scenario" key={index}>
        <legend>{single ? "Scenario" : index === 0 ? "Left scenario" : "Right scenario"}</legend>
        <label class="st-field"><span>Shift</span><select aria-label={`${name} shift`} value={choice.shiftId} onChange={(e) => chooseScenario(index, { shiftId: e.currentTarget.value })} data-testid={`scenario-${index}-shift`}>
          {!savedShifts.value.length ? <option value="">Create a shift in Orders</option> : null}
          {savedShifts.value.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <label class="st-field"><span>Setup</span><select aria-label={`${name} setup`} value={choice.setupId} onChange={(e) => chooseScenario(index, { setupId: e.currentTarget.value })} data-testid={`scenario-${index}-setup`}>
          <SetupOptions />
        </select></label>
      </fieldset>;
    })}
  </div>;
}
