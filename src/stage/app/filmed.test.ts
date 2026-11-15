import { describe, expect, it } from "vitest";
import type { ActionSegment } from "../../core";
import { actionAt, actionWords, handLabelNote, isVideoFile, matchVideoRun, type VideoRun } from "./filmed";

const segments: readonly ActionSegment[] = [
  { type: "action", workerId: "drink", t0: 0, t1: 3, kind: "work", boxId: "d", label: "pouring a drink", confidence: 1 },
  { type: "action", workerId: "drink", t0: 3, t1: 7.8, kind: "carry", boxId: "c" },
  { type: "action", workerId: "chips", t0: 1, t1: 13.8, kind: "walk" },
  { type: "action", workerId: "chips", t0: 15, t1: 20, kind: "idle" },
];
const name = (id: string) => (id === "d" ? "Drink station" : "Chips station");

describe("actions at a time", () => {
  it("shows nothing in a gap between two segments", () => {
    expect(actionAt(segments, "chips", 13.79)?.kind).toBe("walk");
    expect(actionAt(segments, "chips", 13.8)).toBeNull();
    expect(actionAt(segments, "chips", 14.9)).toBeNull();
    expect(actionAt(segments, "chips", 15)?.kind).toBe("idle");
    expect(actionAt(segments, "chips", 20)?.kind).toBe("idle");
  });
  it("gives each worker's current segment and holds the last one", () => {
    expect(actionAt(segments, "drink", 0)?.kind).toBe("work");
    expect(actionAt(segments, "drink", 2.99)?.kind).toBe("work");
    expect(actionAt(segments, "drink", 3)?.kind).toBe("carry");
    expect(actionAt(segments, "drink", 99)?.kind).toBe("carry");
    expect(actionAt(segments, "chips", 0.5)).toBeNull();
    expect(actionAt(segments, "nobody", 5)).toBeNull();
    expect(actionAt([], "drink", 5)).toBeNull();
  });
  it("says the action in words", () => {
    expect(actionWords(segments[0]!, name)).toBe("work at Drink station - pouring a drink");
    expect(actionWords(segments[1]!, name)).toBe("carry to Chips station");
    expect(actionWords(segments[2]!, name)).toBe("walk");
    expect(actionWords(null, name)).toBe("not seen");
  });
});

describe("the hand-labelling caption", () => {
  it("keeps the sentences of run.json that say what was done by hand", () => {
    const change = "DEMO COPY, HAND-LABELLED. Real phone scan. The taps were labelled by hand from the video. See README.md.";
    expect(handLabelNote({ title: "Our kitchen", change })).toBe("DEMO COPY, HAND-LABELLED. The taps were labelled by hand from the video.");
  });
  it("falls back to the title", () => {
    expect(handLabelNote({ title: "Original counter" })).toBe("Original counter");
    expect(handLabelNote({ title: "Original counter", change: "The fridge moved." })).toBe("Original counter");
  });
});

describe("a dropped video", () => {
  const run = (id: string, recordedAt: string, extra: Partial<VideoRun> = {}): VideoRun => ({ id, title: id, recordedAt, sourceFiles: [], ...extra });
  it("is recognised by type or extension", () => {
    expect(isVideoFile("IMG_1577.MOV", "")).toBe(true);
    expect(isVideoFile("IMG_1577_stable.mp4", "video/mp4")).toBe(true);
    expect(isVideoFile("clip", "video/quicktime")).toBe(true);
    expect(isVideoFile("scan.json", "application/json")).toBe(false);
  });
  it("matches the run whose video.json names the file, whatever the case", () => {
    const runs = [run("new", "2026-11-14T23:00:00.000Z"), run("ours", "2026-11-14T22:00:00.000Z", { sourceFiles: ["IMG_1577.MOV", "IMG_1577_stable.mp4"] })];
    expect(matchVideoRun("img_1577_stable.mp4", runs)?.id).toBe("ours");
    expect(matchVideoRun("IMG_1577.MOV", runs)?.id).toBe("ours");
  });
  it("matches the run whose title or change names the file", () => {
    const runs = [run("new", "2026-11-14T23:00:00.000Z"), run("ours", "2026-11-14T22:00:00.000Z", { change: "Made from IMG_1577.MOV by hand." })];
    expect(matchVideoRun("IMG_1577.mp4", runs)?.id).toBe("ours");
  });
  it("falls back to the newest run with a video, and to null with none", () => {
    const runs = [run("old", "2026-11-13T10:00:00.000Z"), run("new", "2026-11-14T23:00:00.000Z")];
    expect(matchVideoRun("holiday.mov", runs)?.id).toBe("new");
    expect(matchVideoRun("holiday.mov", [])).toBeNull();
  });
});
