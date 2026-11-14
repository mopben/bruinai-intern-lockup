/**
 * Dry Run core: the numbers. Pure functions, no DOM, no I/O. Inputs are never mutated.
 *
 * Typical wiring
 *
 *   // 1. A recorded (or live) run in the layout it was recorded in.
 *   const worldA = resolveWorld(scan, setup, layoutA);          // throws WorldError (list of issues)
 *   const runA = reconstructRun(setup, taps);                    // never throws; see runA.warnings
 *   // Step "Run": tickets per station at time t
 *   queueAt(runA.queue, t)            // { stationId: count }
 *   ticketsAt(runA.queue, stationId, t) // order ids, oldest first
 *
 *   // 2. Step "Trust": calibrate on even orders, compare on odd ones.
 *   const trust = trustCheck(worldA, taps, positions);
 *   describeTrustError(trust.errorPct); trust.pairs; trust.method; trust.caveat
 *   trust.baselineErrorPct   // trivial guess (learned orders' mean) on the same held-out orders
 *   trust.walkCheck          // { trips, maeS, mapePct, byGroup[] } or null + trust.walkCheckReason
 *   trust.scope              // one plain sentence: what this check does and does not cover
 *
 *   // 3. Step "Play": calibrate on the whole run once, then predict on every drag frame.
 *   const cal = calibrate(worldA, runA, positions);
 *   const worldB = resolveWorld(scan, setup, draggedLayout);
 *   const pred = predict(worldB, cal);                           // ~2 ms; same seed -> no flicker
 *   formatMetres(pred.walkingPerOrderM); formatRange(pred.meanOrderTime); pred.assumption
 *   pred.extrapolation       // { outside, note, measuredRangeM, walks[] }: walks longer/shorter than any measured
 *
 *   // 4. Step "Test": compare the prediction with the second run.
 *   const runB = reconstructRun(setup, tapsB);
 *   const measured = summariseRun(runB).meanOrderTimeS;
 *   if (measured !== null) checkPrediction(pred.meanOrderTime, measured).missText; // never "0.0 s"
 *
 *   // 5. Step "Compare" (or animating any prediction): one simulated run with full trace.
 *   //    Same seed and rep on both layouts = same luck (common random numbers).
 *   const traceA = simulateRun(worldA, cal, { seed: 1, rep: 0 });
 *   const traceB = simulateRun(worldB, cal, { seed: 1, rep: 0 });
 *   //    traceX.movements: worker walks with polylines and times; traceX.queue: same shape as runA.queue.
 *
 * Errors: WorldError (bad scan/setup/layout, `issues` lists each problem in plain words),
 * SimError (e.g. a station with nobody at it or no measured work times). Both are safe to show.
 */

// Contracts shared by the whole product.
export * from "./types";

// World
export { resolveWorld, standPoint, itemOf, WorldError } from "./world";
export type { World, WorldItem, WorldWall } from "./world";
export { itemTasks, taskIssues, workerCovers, isChainKitchen } from "./tasks";
export type { ResolvedTask } from "./tasks";

// Geometry and walking (exact, from the layout alone)
export type { OrientedRect } from "./geometry";
export { distance, polylineLength, rectCorners } from "./geometry";
export { shortestPath } from "./path";
export type { Obstacle, WalkPath } from "./path";
export { buildPathTable, pathBetween, walkingForItem, walkingPerOrder } from "./walking";
export type { PathTable, WalkLeg, LegKind, ItemWalk, WalkingSummary } from "./walking";

// Runs: traces and queue timelines (recorded and simulated share these shapes)
export type { RunTrace, OrderTrace, StepTrace, QueueTimeline, QueueInterval, MovementSegment, MovementKind } from "./trace";
export { reconstructRun } from "./reconstruct";
export type { RunReconstruction } from "./reconstruct";
export { queueAt, ticketsAt, peakQueue, menuStations, buildQueueTimeline } from "./timeline";

// Calibration (learns only from taps and positions)
export {
  calibrate,
  estimateWalkSpeed,
  DEFAULT_WALK_SPEED_MPS,
  MIN_WORK_S,
  MOVING_THRESHOLD_MPS,
  SPEED_WINDOW_S,
} from "./calibrate";
export type { Calibration, CalibrationOptions, SpeedEstimate } from "./calibrate";
export { estimatePace, walkSeconds, bootstrapPace, tripDistanceRange, MIN_TRIPS, FIT_MIN_SPREAD_M } from "./pace";
export type { Pace, PaceMethod, PaceEstimate } from "./pace";
export { detectTrips, TRIP_EXCURSION_M, TRIP_HOME_M, TRIP_MATCH_M, REST_SPEED_MPS, HOME_SEARCH_M } from "./trips";
export type { Trip } from "./trips";

// Simulation and prediction
export { compileModel, SimError } from "./model";
export type { SimModel } from "./model";
export { runReplication } from "./sim";
export type { Releases, Replication, ReplicationOptions } from "./sim";
export { predict, simulateRun, assumptionText, hasSharedStation, DEFAULT_REPS, DEFAULT_SEED } from "./predict";
export type { Prediction, PredictOptions, SimulateRunOptions } from "./predict";

// Trust and checking a prediction
export { trustCheck, MIN_CHECK_ORDERS, TRUST_SCOPE } from "./trust";
export { walkCheck } from "./walkcheck";
export type { WalkCheck, WalkCheckResult, GroupCheck } from "./walkcheck";
export { walkExtrapolation, EXTRAPOLATION_TOLERANCE_M } from "./extrapolation";
export type { WalkExtrapolation, ExtrapolatedWalk } from "./extrapolation";
export type { TrustResult, TrustPair, TrustOptions } from "./trust";
export { checkPrediction, summariseRun } from "./compare";
export type { PredictionCheck, MeasuredSummary } from "./compare";

// Honest formatting
export {
  formatSeconds,
  formatSecondsRange,
  formatRange,
  formatMetres,
  formatPercent,
  formatCountRange,
  formatGapSeconds,
  describeTrustError,
} from "./format";
export { rangeOf, mean, median, quantile } from "./stats";
export type { Range } from "./stats";
export { mulberry32, streamFor } from "./rng";
