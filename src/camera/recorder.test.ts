import { describe, expect, it } from "vitest";
import { parsePositions } from "../inputs/parse";
import { addSamples, recordingToJsonl, startRecording } from "./recorder";

describe("recorder", () => {
  it("writes a positions.jsonl the input layer accepts", () => {
    let rec = startRecording(new Date("2026-11-14T10:00:00.000Z"));
    rec = addSamples(rec, 0, [{ workerId: "red", x: 1.23456, z: 2 }]);
    rec = addSamples(rec, 0.1004, [{ workerId: "red", x: 1.3, z: 2 }, { workerId: "blue", x: 3, z: 1 }]);
    rec = addSamples(rec, 0.2, []);
    const parsed = parsePositions(recordingToJsonl(rec));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.header).toMatchObject({ format: "dryrun.positions", startedAt: "2026-11-14T10:00:00.000Z", hz: 10 });
    expect(parsed.value.samples).toEqual([
      { type: "pos", t: 0, workerId: "red", x: 1.235, z: 2 },
      { type: "pos", t: 0.1, workerId: "red", x: 1.3, z: 2 },
      { type: "pos", t: 0.1, workerId: "blue", x: 3, z: 1 },
    ]);
  });
  it("ignores negative times and does not mutate", () => {
    const rec = startRecording(new Date(0));
    const next = addSamples(rec, -1, [{ workerId: "red", x: 0, z: 0 }]);
    expect(next.samples).toHaveLength(0);
    addSamples(rec, 1, [{ workerId: "red", x: 0, z: 0 }]);
    expect(rec.samples).toHaveLength(0);
  });
});
