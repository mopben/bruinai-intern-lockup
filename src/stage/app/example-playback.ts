import type { RunTrace } from '../../core';

/** Keep the shift clock anchored at zero, including time before the first arrival. */
export function exampleTimeline(traces: readonly RunTrace[], end: number) {
  const segments = traces.flatMap(trace => trace.movements).filter(segment => segment.t0 < end && segment.t1 > segment.t0).sort((a, b) => a.t0 - b.t0);
  return { segments, start: 0 };
}
