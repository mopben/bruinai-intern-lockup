/**
 * The input layer: file formats, run loading, and the three inputs (scan,
 * taps, positions) as live or replay behind one interface.
 *
 * Typical stage use:
 *
 *   const bundle = await loadRunBundle("/fixtures/counter-a/");
 *   // replay
 *   const feed = createReplayFeed(bundle);
 *   // or live, with the recording standing by
 *   const link = createReconnectingSocket({ role: "stage" });
 *   const feed = createSwitchableFeed({
 *     live: createLiveFeed({ link, setup: bundle.setup, workers: bundle.layout.workers }),
 *     recorded: createReplayFeed(bundle),
 *     link,
 *   });
 *   feed.onTap(...); feed.onPosition(...); feed.start();
 */
export * from "./schemas";
export * from "./parse";
export * from "./bundle";
export * from "./api";
export * from "./clock";
export * from "./protocol";
export * from "./socket";
export * from "./feed";
export * from "./replay-feed";
export * from "./live-feed";
export * from "./watchdog";
export {
  createSwitchableFeed,
  type InputHealth,
  type SourceKind,
  type Sources,
  type SwitchableOptions,
  type SwitchableRunFeed,
} from "./switchable-feed";
export * from "./scan-feed";
export * from "./recording";
export * from "./presence";
