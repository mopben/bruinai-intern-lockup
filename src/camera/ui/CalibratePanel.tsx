/**
 * Calibration: the matched points with their error, what the operator
 * should do next, and export / import / start over.
 */
import { emptyCalibration, parseCalibration, rescaleCalibration, serialiseCalibration } from "../calib-file";
import { cameraPosition } from "../camera-model";
import { MIN_FLOOR_POINTS, MIN_TOP_POINTS } from "../calibration";
import { errorTone } from "./overlay";
import { download } from "./sources";
import type { CameraStore } from "./store";

function nextStep(floor: number, top: number, ok: boolean, error: string | undefined): string {
  if (floor < MIN_FLOOR_POINTS) return `Pick a floor point (circle) on the map, then click the same spot in the picture. ${MIN_FLOOR_POINTS - floor} more to go.`;
  if (!ok) return error ?? "Something is off. Delete the red point and try again.";
  if (top < MIN_TOP_POINTS) return `Good. Now add ${MIN_TOP_POINTS - top} box-top corner${MIN_TOP_POINTS - top === 1 ? "" : "s"} (squares): they make the hat height correction exact.`;
  return "Calibrated. The outlines should sit on the real boxes. Press Done.";
}

export function CalibratePanel({ store }: { readonly store: CameraStore }) {
  const c = store.calib.value;
  if (!c) return <p class="hint">Calibration needs a picture and a kitchen.</p>;
  const solved = store.solved.value;
  const floor = c.pairs.filter((p) => Math.abs(p.world.y) <= 0.01).length;
  const top = c.pairs.length - floor;
  const good = solved?.ok === true;
  const cam = solved?.ok ? cameraPosition(solved.value.model) : undefined;

  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !c) return;
    const parsed = parseCalibration(await file.text());
    if (!parsed.ok) {
      store.say(parsed.error, "warn");
      return;
    }
    const sameKitchen = parsed.value.kitchenKey === c.kitchenKey;
    store.setCalib(rescaleCalibration({ ...parsed.value, cameraKey: c.cameraKey, kitchenKey: c.kitchenKey }, c.imageSize));
    store.say(
      sameKitchen ? `Calibration loaded from ${file.name}.` : `Loaded ${file.name}, but it was made for a different scan. Check the outlines carefully.`,
      sameKitchen ? "ok" : "warn",
    );
  }

  return (
    <div class="calib">
      <p class={`next ${good && top >= MIN_TOP_POINTS ? "is-done" : ""}`}>{nextStep(floor, top, good, solved && !solved.ok ? solved.error : undefined)}</p>
      {solved?.ok && (
        <p class="small">
          Average error <strong>{solved.value.rmsCm.toFixed(1)} cm</strong> over {c.pairs.length} points.{" "}
          {solved.value.model.note}
          {cam && ` Camera about ${cam.y.toFixed(1)} m up.`}
        </p>
      )}
      {solved?.ok && solved.value.suspect !== undefined && (
        <p class="warn-line">Point {solved.value.suspect + 1} disagrees with the others. Delete it and click it again.</p>
      )}
      <ol class="pairs">
        {c.pairs.map((p, i) => {
          const err = solved?.ok ? solved.value.errorsCm[i] : undefined;
          return (
            <li key={`${p.refId ?? p.label}-${i}`}>
              <span class="pair-label">{p.label}</span>
              {err !== undefined && (
                <span class="err" style={{ color: errorTone(err) }}>
                  {err.toFixed(1)} cm
                </span>
              )}
              <button class="quiet" onClick={() => store.removePair(i)} aria-label={`Delete point ${i + 1}`}>
                Delete
              </button>
            </li>
          );
        })}
      </ol>
      <div class="row">
        <button onClick={() => download(`camera-calibration-${c.kitchenKey}.json`, serialiseCalibration(c))} disabled={c.pairs.length === 0}>
          Export
        </button>
        <label class="button">
          Import
          <input type="file" accept="application/json,.json" onChange={importFile} hidden />
        </label>
        <button
          class="quiet"
          disabled={c.pairs.length === 0}
          onClick={() => {
            if (globalThis.confirm("Delete all calibration points? Hat colours and heights are kept.")) {
              store.setCalib({ ...emptyCalibration(c.cameraKey, c.kitchenKey, c.imageSize), hatHeights: c.hatHeights, colours: c.colours });
            }
          }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}
