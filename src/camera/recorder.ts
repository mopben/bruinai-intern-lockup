/**
 * Recording position samples to a positions.jsonl (docs/FORMATS.md).
 * t is seconds since the recording started.
 */
import type { PositionSample } from "../core/types";
import { serialisePositions } from "../inputs/bundle";

export interface Recording {
  readonly startedAt: string;
  readonly samples: readonly PositionSample[];
}

export interface FloorSample {
  readonly workerId: string;
  readonly x: number;
  readonly z: number;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export const startRecording = (startedAt: Date): Recording => ({ startedAt: startedAt.toISOString(), samples: [] });

export function addSamples(rec: Recording, t: number, samples: readonly FloorSample[]): Recording {
  if (!(t >= 0) || samples.length === 0) return rec;
  const added = samples.map(
    (s): PositionSample => ({ type: "pos", t: round(t, 3), workerId: s.workerId, x: round(s.x, 3), z: round(s.z, 3) }),
  );
  return { ...rec, samples: [...rec.samples, ...added] };
}

export const recordingToJsonl = (rec: Recording, hz = 10): string => serialisePositions(rec.samples, rec.startedAt, hz);
