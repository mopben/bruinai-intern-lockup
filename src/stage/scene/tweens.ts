/** Promise-returning tweens driven by the scene's own frame loop. */
interface Tween {
  readonly start: number;
  readonly dur: number;
  readonly apply: (p: number) => void;
  readonly done: () => void;
}

export class Tweens {
  private list: Tween[] = [];
  private clock = performance.now() / 1000;

  /** Run `apply(p)` for p from 0 to 1 over `dur` seconds (eased). */
  run(dur: number, apply: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.list = [...this.list, { start: performance.now() / 1000, dur, apply, done: resolve }];
    });
  }

  wait(dur: number): Promise<void> {
    return this.run(dur, () => undefined);
  }

  /** Returns true while any tween is running. */
  tick(now: number): boolean {
    this.clock = now;
    if (this.list.length === 0) return false;
    const keep: Tween[] = [];
    for (const t of this.list) {
      const raw = (now - t.start) / t.dur;
      const p = Math.min(1, Math.max(0, raw));
      t.apply(p < 1 ? 1 - (1 - p) * (1 - p) * (1 - p) : 1);
      if (raw >= 1) t.done();
      else keep.push(t);
    }
    this.list = keep;
    return true;
  }

  /** Resolve everything at once (on dispose), so awaiting callers never hang. */
  cancelAll(): void {
    for (const t of this.list) t.done();
    this.list = [];
    void this.clock;
  }
}
