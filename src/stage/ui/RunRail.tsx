/**
 * Step 2. The run plays: dots from the camera log, tickets from the taps.
 * Also the run controls the Test step reuses.
 */
import { formatSeconds, reconstructRun, summariseRun } from "../../core";
import { beginFirstRun, beginTest } from "../state/flow";
import { firstRunProblem, usableFirstRun } from "../state/derive";
import { skipToEnd, startLive, toggleFaster } from "../state/runs";
import { base, kitchen, session, storyText, type Session } from "../state/store";
import { runFitsKitchen } from "../app/kitchen-edit";
import { formatMeasured } from "../app/words";
import { Btn, clock } from "./bits";

function SaveLine(props: { readonly s: Session }) {
  const save = props.s.save;
  if (save.kind === "none") return null;
  if (save.kind === "saving") return <p class="st-small">Saving the run{save.attempt > 1 ? ` (try ${save.attempt})` : ""}…</p>;
  if (save.kind === "saved")
    return (
      <p class="st-small" data-testid="saved-where">
        Saved on this laptop in {save.where}
      </p>
    );
  return <p class="st-warn">Could not save the run ({save.error}). Press S to try again.</p>;
}

export function RunControls(props: { readonly purpose: Session["purpose"]; readonly compact?: boolean }) {
  const s = session.value;
  const mine = s && s.purpose === props.purpose ? s : null;
  const again = props.purpose === "first" ? beginFirstRun : () => void beginTest();
  if (!mine) return null;
  const fast = mine.speed > 1;
  return (
    <>
      <div class="st-nums">
        <div class="st-num">
          <span class="what">Run time</span>
          <span class={`value${props.compact ? " mid" : ""}`}>
            <span data-testid="run-clock">{clock(mine.t)}</span>
            {mine.replay && fast ? <span class="dir">{mine.speed}× speed</span> : null}
          </span>
        </div>
        <p class="st-say" data-testid="orders-done">
          {mine.done} of {mine.total} orders done
        </p>
      </div>
      <div class="st-row">
        {mine.status === "idle" ? (
          <Btn label="Start run" k="P" kind="primary" onClick={startLive} testId="btn-play" />
        ) : mine.replay || mine.status === "ended" ? (
          <Btn label={mine.replay ? "Play again" : "Run again"} k="P" onClick={again} testId="btn-play" kind={mine.status === "ended" ? "primary" : "plain"} />
        ) : null}
        {mine.replay ? <Btn label={fast ? "Normal speed" : "Faster"} k="F" kind={fast ? "on" : "plain"} onClick={toggleFaster} disabled={mine.status === "ended"} testId="btn-faster" /> : null}
        <Btn label={mine.replay ? "Skip to end" : "End run"} k="E" onClick={skipToEnd} disabled={mine.status !== "running"} testId="btn-skip" />
      </div>
      {mine.status === "idle" ? <p class="st-small">Orders go to the tablet when the run starts. The stage keeps the time.</p> : null}
      <SaveLine s={mine} />
    </>
  );
}

export function RunRail() {
  const k = kitchen.value;
  const b = base.value;
  const s = session.value;
  if (!k) return <div class="st-card"><h1>The run</h1><p class="st-note">{firstRunProblem.value}</p></div>;
  const recordedElsewhere = b && !runFitsKitchen(b, k) && (!s || s.purpose !== "first");
  const ended = s?.purpose === "first" && s.status === "ended";
  const run = usableFirstRun.value;
  const measured = run && ended ? summariseRun(reconstructRun(k.setup, run.taps)) : null;
  return (
    <div class="st-card">
      <h1>The kitchen at work</h1>
      <p class="st-lede">Each dot is a person, from the camera. Each ticket is an order waiting at a station, from the tablet taps.</p>
      {recordedElsewhere ? (
        <p class="st-note">
          The recorded run was made in the recorded kitchen, not in this scan. Press I and switch taps and positions to live to run this kitchen, or switch the scan back to recorded.
        </p>
      ) : null}
      <RunControls purpose="first" />
      {ended && storyText.value ? (
        <>
          <hr class="st-sep" />
          <p class="st-say" data-testid="run-story">
            {storyText.value}
          </p>
          {measured && measured.meanOrderTimeS !== null ? (
            <p class="st-small">
              {measured.completed} of {measured.total} orders finished, {formatMeasured(measured.meanOrderTimeS)} each on average, the last at {formatSeconds(measured.lastFinishS ?? 0)}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
