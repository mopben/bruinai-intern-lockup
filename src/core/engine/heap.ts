/**
 * The engine's event queue: a binary min-heap ordered by time, then by creation
 * sequence, so two events at one moment run in the order they were made.
 * The same order as the old station-queue engine's heap, which golden.test.ts needs.
 */

export interface Timed {
  readonly t: number;
  readonly seq: number;
}

const before = (x: Timed, y: Timed): boolean => x.t < y.t || (x.t === y.t && x.seq < y.seq);

export class EventHeap<E extends Timed> {
  private readonly h: E[] = [];

  get size(): number {
    return this.h.length;
  }

  push(e: E): void {
    const h = this.h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[i] as E, h[p] as E)) break;
      [h[i], h[p]] = [h[p] as E, h[i] as E];
      i = p;
    }
  }

  pop(): E | undefined {
    const h = this.h;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0 && last) {
      h[0] = last;
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    const h = this.h;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[l] as E, h[m] as E)) m = l;
      if (r < h.length && before(h[r] as E, h[m] as E)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m] as E, h[i] as E];
      i = m;
    }
  }
}
