/**
 * The Inputs section of the Build panel: each input live or recorded, its
 * health, the addresses the devices use, and which runs to use.
 */
import { loadBase } from "../state/boot";
import { setSource } from "../state/input-actions";
import { liveSwitchable } from "../state/runs";
import {
  base,
  candidates,
  catalog,
  health,
  latestLiveScan,
  linkState,
  presence,
  secondChoice,
  serverInfo,
  sources,
  type InputKind,
  type Source,
} from "../state/store";

function healthText(input: InputKind): string {
  const src = sources.value[input];
  const roles = presence.value;
  const link = linkState.value;
  const h = health.value.find((x) => x.input === input);
  if (h && h.state !== "ok") return h.state === "replaced" ? `Switched to the recording: ${h.reason ?? "no signal"}` : `Trouble: ${h.reason ?? "no signal"}`;
  if (src === "replay") {
    if (input === "scan") return `Recorded scan from ${base.value?.meta.id ?? "the base run"}`;
    return `From the recorded run ${base.value?.meta.id ?? ""}`;
  }
  if (link !== "open") return "Not connected to the laptop server";
  if (input === "scan") return latestLiveScan.value ? `Phone scan received ${latestLiveScan.value.capturedAt.slice(11, 16)}` : "Waiting for the phone";
  if (input === "taps") return roles.tablet > 0 ? `${roles.tablet} tablet${roles.tablet === 1 ? "" : "s"} connected` : "No tablet connected";
  return roles.camera > 0 ? `${roles.camera} camera page${roles.camera === 1 ? "" : "s"} connected` : "No camera connected";
}

function Row(props: { readonly input: InputKind; readonly name: string }) {
  const sw = liveSwitchable();
  const current: Source = props.input !== "scan" && sw && sw.status() === "running" ? sw.sources()[props.input] : sources.value[props.input];
  return (
    <div class="st-input-row" data-testid={`input-${props.input}`} data-source={current}>
      <span class="name">{props.name}</span>
      <span class="st-seg" role="group" aria-label={`${props.name} source`}>
        {(["replay", "live"] as const).map((s) => (
          <button key={s} type="button" class={current === s ? "on" : ""} data-testid={`source-${props.input}-${s}`} onClick={() => setSource(props.input, s)}>
            {s === "replay" ? "Recorded" : "Live"}
          </button>
        ))}
      </span>
      <span class="st-small" data-testid={`health-${props.input}`}>
        {healthText(props.input)}
      </span>
    </div>
  );
}

export function InputsSection() {
  const info = serverInfo.value;
  const runs = catalog.value.filter((r) => r.meta);
  return (
    <section class="st-inputs" data-testid="inputs-section" aria-label="Inputs">
      <h2>Inputs</h2>
      <Row input="scan" name="Scan" />
      <Row input="taps" name="Taps" />
      <Row input="positions" name="Positions" />
      <h3>Addresses on this network</h3>
      {info ? (
        <div class="st-urls" data-testid="lan-urls">
          <span>Tablet</span>
          <code>{info.urls.tablet}</code>
          <span>Camera</span>
          <code>{info.urls.camera}</code>
          <span>Scan upload</span>
          <code>{info.urls.scanUpload}</code>
        </div>
      ) : (
        <p class="st-small">No laptop server reachable.</p>
      )}
      <h3>Runs</h3>
      <div class="st-field">
        <label class="st-field">
          <span>First run (base)</span>
          <select class="st-select" data-testid="select-base" value={base.value?.meta.id ?? ""} onChange={(e) => void loadBase((e.target as HTMLSelectElement).value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.meta?.title} ({r.origin === "fixtures" ? r.id : `saved ${r.meta?.recordedAt.slice(0, 16).replace("T", " ")}`})
              </option>
            ))}
          </select>
        </label>
        <label class="st-field">
          <span>Second run (Test)</span>
          <select class="st-select" data-testid="select-second" value={secondChoice.value} onChange={(e) => (secondChoice.value = (e.target as HTMLSelectElement).value)}>
            <option value="auto">The one that matches the change</option>
            {candidates.value.map((c) => (
              <option key={c.id} value={c.id}>
                {c.meta.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
