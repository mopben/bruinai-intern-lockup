import { describe, expect, it } from 'vitest';
import type { MovementSegment, RunTrace } from '../../core';
import { exampleTimeline } from './example-playback';
const work: MovementSegment = { workerId: 'w', orderId: 'o', step: 0, kind: 'work', t0: 120, t1: 135, path: [{ x: 0, z: 0 }] };
const walk: MovementSegment = { ...work, kind: 'fetch-out', t0: 135, t1: 140, path: [{ x: 0, z: 0 }, { x: 1, z: 0 }] };
const trace: RunTrace = { movements: [work, walk], orders: [], queue: { stationIds: [], intervals: [], endT: 140 }, endT: 140 };
describe('example playback', () => {
  it('starts at zero even when arrivals and travel happen later', () => {
    expect(exampleTimeline([trace], 3600).start).toBe(0);
  });
  it('preserves work and travel and excludes activity after closing', () => {
    const timeline = exampleTimeline([trace], 3600);
    expect(timeline.segments).toEqual([work, walk]);
    expect(exampleTimeline([trace], 100)).toEqual({ start: 0, segments: [] });
  });
});
