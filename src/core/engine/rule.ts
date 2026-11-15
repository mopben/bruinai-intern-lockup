/**
 * Task rules: which ready task a resting worker takes. A rule is a pure function
 * of (worker, ready tasks, time) and gets no random numbers. The engine passes only
 * tasks at stations the worker covers that have room.
 */

export interface ReadyTask {
  /** The engine's job number (order index × most tasks + task index). */
  readonly job: number;
  readonly stationId: string;
  /** When every input of the task had arrived. */
  readonly readyAt: number;
  /** Order in which tasks became ready; breaks the last ties. */
  readonly seq: number;
  /** Walk from where the worker is to the task's station, metres (0 when there). */
  readonly walkM: number;
}

export interface RuleWorker {
  readonly id: string;
  readonly homeId: string;
  /** The station (or drop point) where the worker is. */
  readonly atId: string;
}

/** Returns the job to take, or null to take none. */
export type TaskRule = (worker: RuleWorker, ready: readonly ReadyTask[], now: number) => number | null;

function better(a: ReadyTask, b: ReadyTask, homeId: string): boolean {
  if (a.readyAt !== b.readyAt) return a.readyAt < b.readyAt;
  const ah = a.stationId === homeId;
  const bh = b.stationId === homeId;
  if (ah !== bh) return ah;
  if (a.walkM !== b.walkM) return a.walkM < b.walkM;
  return a.seq < b.seq;
}

/**
 * The task ready longest; ties go to the home station, then the nearest station,
 * then the task that became ready first. For fixed workers this is first come, first served.
 */
export const oldestFirst: TaskRule = (worker, ready) => {
  let best: ReadyTask | null = null;
  for (const r of ready) if (best === null || better(r, best, worker.homeId)) best = r;
  return best === null ? null : best.job;
};
