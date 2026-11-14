/**
 * Record what the tracker reports to positions.jsonl, or turn a whole video
 * file into one as fast as the browser can decode it.
 */
import type { Engine } from "./engine";
import type { CameraStore } from "./store";

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

export function RecordPanel({ store, engine }: { readonly store: CameraStore; readonly engine: Engine | undefined }) {
  const rec = store.recording.value;
  const off = store.offline.value;
  const src = store.source.value;
  const seconds = rec && rec.samples.length > 0 ? rec.samples[rec.samples.length - 1]!.t : 0;
  return (
    <div class="record">
      <button
        class={rec ? "rec on" : "rec"}
        disabled={!engine || src.kind === "none" || off !== undefined}
        onClick={() => (rec ? engine?.stopRecordingAndSave(`positions-${stamp()}.jsonl`) : engine?.startRecording())}
      >
        {rec ? `Stop and save (${seconds.toFixed(0)} s, ${rec.samples.length} samples)` : "Record"}
      </button>
      {src.kind === "file" && (
        <button
          disabled={!engine || off !== undefined || rec !== undefined || !store.model.value}
          onClick={() => void engine?.processWholeFile(`positions-${src.name.replace(/\.[^.]+$/, "")}.jsonl`)}
          title="Steps through the whole video at 10 frames per second of video time"
        >
          {off ? `Processing… ${Math.round((off.done / off.total) * 100)}%` : "Turn whole video into positions.jsonl"}
        </button>
      )}
      {off && <progress max={off.total} value={off.done} />}
    </div>
  );
}
