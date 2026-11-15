import type { MovementSegment, RunTrace } from '../../core';

/** Playback can jump over empty stretches without changing financial estimates. */
export function exampleTimeline(traces: readonly RunTrace[], end: number) {
  const segments = traces.flatMap(trace => trace.movements).filter(segment => segment.t0 < end && segment.t1 > segment.t0).sort((a, b) => a.t0 - b.t0);
  const firstWalk = segments.find(segment => segment.kind !== 'work' && segment.path.some(point => Math.hypot(point.x - segment.path[0]!.x, point.z - segment.path[0]!.z) > .001));
  return { segments, start: firstWalk?.t0 ?? segments[0]?.t0 ?? 0 };
}

export function skipEmptyTime(t: number, segments: readonly MovementSegment[], end: number): number {
  if (segments.some(segment => segment.t0 <= t && t < segment.t1)) return Math.min(t, end);
  return Math.min(segments.find(segment => segment.t0 > t)?.t0 ?? end, end);
}
