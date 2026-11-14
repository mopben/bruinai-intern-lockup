/**
 * Small shared pieces: a button with its key, a big number, a plain message.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Key(props: { readonly k: string }) {
  return <span class="st-key" aria-hidden="true">{props.k}</span>;
}

export function Btn(props: {
  readonly label: string;
  readonly k?: string;
  readonly onClick: () => void;
  readonly kind?: "primary" | "on" | "plain";
  readonly small?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly title?: string;
}) {
  const cls = ["st-btn", props.kind && props.kind !== "plain" ? props.kind : "", props.small ? "small" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" class={cls} onClick={props.onClick} disabled={props.disabled} data-testid={props.testId} title={props.title}>
      {props.label}
      {props.k ? <Key k={props.k} /> : null}
    </button>
  );
}

/** A big number with what it is, how it was worked out, and optionally the value before. */
export function BigNum(props: {
  readonly what: string;
  readonly value: string | null;
  /** Shown instead of the value when the model cannot compute it. */
  readonly cannot?: string | null;
  readonly was?: string | null;
  readonly dir?: string | null;
  readonly how: ComponentChildren;
  readonly testId: string;
  readonly mid?: boolean;
}) {
  return (
    <div class="st-num">
      <span class="what">{props.what}</span>
      {props.value !== null && !props.cannot ? (
        <span class={`value${props.mid ? " mid" : ""}`}>
          <span data-testid={props.testId}>{props.value}</span>
        </span>
      ) : (
        <span class="cannot" data-testid={`${props.testId}-cannot`}>
          {props.cannot ?? "Not worked out yet."}
        </span>
      )}
      {props.was && props.value !== null && !props.cannot ? (
        <span class="change">
          <span class="was" data-testid={`${props.testId}-before`}>
            {props.was}
          </span>
          {props.dir ? <span class="dir">{props.dir}</span> : null}
        </span>
      ) : null}
      <span class="how">{props.how}</span>
    </div>
  );
}

/** Seconds as a run clock: "1:05". */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A block that scrolls itself into view inside the rail when it first appears,
 * so a result (the verdict, the run story) is never hidden below the fold on a
 * small projector.
 */
export function Reveal(props: { readonly children: ComponentChildren; readonly class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, []);
  return (
    <div ref={ref} class={`st-reveal${props.class ? ` ${props.class}` : ""}`}>
      {props.children}
    </div>
  );
}
