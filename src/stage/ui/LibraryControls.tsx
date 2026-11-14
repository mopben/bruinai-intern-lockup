import { activeSetupId, activeShiftId, loading, workspaceReady } from "../state/store";
import {
  chooseScenario, createSetup, createShift, renameSetup, renameShift, resolvedChoice,
  savedSetups, savedShifts, selectSetup, selectShift, workspaceProblem,
} from "../state/workspace";

function SetupOptions() {
  const groups = [...new Set(savedSetups.value.map((entry) => entry.type.trim() || "Uncategorized"))];
  return <>{groups.map((type) => <optgroup label={type} key={type}>
    {savedSetups.value.filter((entry) => (entry.type.trim() || "Uncategorized") === type).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
  </optgroup>)}</>;
}

export function SetupControls() {
  const active = savedSetups.value.find((entry) => entry.id === activeSetupId.value);
  return <div class="st-card st-library" data-testid="setup-library">
    <h1>Setups</h1>
    <label class="st-field"><span>Active setup</span>
      <select value={active?.id ?? ""} disabled={!workspaceReady.value || loading.value} onChange={(e) => {
        const selection = e.currentTarget.value;
        if (selection === "__create_setup__") createSetup();
        else selectSetup(selection);
        e.currentTarget.value = activeSetupId.value ?? "";
      }} data-testid="active-setup">
        {!active ? <option value="">Choose a setup</option> : null}
        <SetupOptions />
        <option value="__create_setup__">+ Create new setup</option>
      </select>
    </label>
    {active ? <>
      <label class="st-field"><span>Setup name</span><input value={active.name} maxLength={80} onInput={(e) => renameSetup({ name: e.currentTarget.value })} data-testid="setup-name" /></label>
      <label class="st-field"><span>Setup type</span><input value={active.type} list="setup-types" maxLength={80} onInput={(e) => renameSetup({ type: e.currentTarget.value })} /></label>
      <datalist id="setup-types"><option value="Baseline" /><option value="Extra staff" /><option value="Alternate layout" /></datalist>
    </> : <p>Create a setup to import a kitchen and configure its layout and workers.</p>}
    {workspaceProblem.value ? <p role="status" class="st-note">{workspaceProblem.value}</p> : null}
  </div>;
}

export function ShiftControls() {
  const active = savedShifts.value.find((entry) => entry.id === activeShiftId.value);
  return <div class="st-library" data-testid="shift-library">
    <h1>Shifts</h1>
    {savedShifts.value.length ? <label class="st-field"><span>Active shift</span>
      <select value={active?.id ?? ""} onChange={(e) => selectShift(e.currentTarget.value)} data-testid="active-shift">
        {!active ? <option value="">Choose a shift</option> : null}
        {savedShifts.value.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
    </label> : null}
    <div class="st-row">
      <button type="button" class="st-btn" onClick={() => createShift()} data-testid="create-shift">Create new shift</button>
      {active ? <button type="button" class="st-btn" onClick={() => createShift(true)}>Duplicate shift</button> : null}
    </div>
    {active ? <label class="st-field"><span>Shift name</span><input value={active.name} maxLength={80} onInput={(e) => renameShift(e.currentTarget.value)} data-testid="shift-name" /></label> : <p>Create a shift to organize its orders and quantities.</p>}
  </div>;
}

export function ScenarioControls() {
  return <div class="st-card st-library" data-testid="scenario-controls">
    <h1>Compare scenarios</h1>
    {[0, 1].map((index) => {
      const choice = resolvedChoice(index);
      return <fieldset class="st-scenario" key={index}>
        <legend>{index === 0 ? "Left scenario" : "Right scenario"}</legend>
        <label class="st-field"><span>Shift</span><select aria-label={`${index === 0 ? "Left" : "Right"} shift`} value={choice.shiftId} onChange={(e) => chooseScenario(index, { shiftId: e.currentTarget.value })} data-testid={`scenario-${index}-shift`}>
          {!savedShifts.value.length ? <option value="">Create a shift in Orders</option> : null}
          {savedShifts.value.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <label class="st-field"><span>Setup</span><select aria-label={`${index === 0 ? "Left" : "Right"} setup`} value={choice.setupId} onChange={(e) => chooseScenario(index, { setupId: e.currentTarget.value })} data-testid={`scenario-${index}-setup`}>
          <SetupOptions />
        </select></label>
      </fieldset>;
    })}
  </div>;
}
