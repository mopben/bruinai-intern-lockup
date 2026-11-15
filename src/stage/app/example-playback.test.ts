import { describe, expect, it } from 'vitest';
import type { MovementSegment, RunTrace } from '../../core';
import { exampleTimeline, skipEmptyTime } from './example-playback';
const work: MovementSegment = { workerId: 'w', orderId: 'o', step: 0, kind: 'work', t0: 120, t1: 135, path: [{ x: 0, z: 0 }] };
const walk: MovementSegment = { ...work, kind: 'fetch-out', t0: 135, t1: 140, path: [{ x: 0, z: 0 }, { x: 1, z: 0 }] };
const trace: RunTrace = { movements: [work, walk], orders: [], queue: { stationIds: [], intervals: [], endT: 140 }, endT: 140 };
describe('example playback', () => {
  it('starts with visible travel instead of a long wait for arrivals and preparation', () => {
    expect(exampleTimeline([trace], 3600).start).toBe(135);
  });
  it('skips empty time, preserves work and travel, and stops at closing', () => {
    const timeline = exampleTimeline([trace], 3600);
    expect(skipEmptyTime(5, timeline.segments, 3600)).toBe(120);
    expect(skipEmptyTime(125, timeline.segments, 3600)).toBe(125);
    expect(skipEmptyTime(136, timeline.segments, 3600)).toBe(136);
    expect(skipEmptyTime(150, timeline.segments, 3600)).toBe(3600);
    expect(exampleTimeline([trace], 100).start).toBe(0);
  });
});
