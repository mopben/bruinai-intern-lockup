import { useEffect, useRef, useState } from "preact/hooks";

export function LibraryDropdown(props: {
  readonly kind: "setup" | "shift";
  readonly entries: readonly { readonly id: string; readonly name: string }[];
  readonly activeId: string | null;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = props.entries.find((entry) => entry.id === props.activeId);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div ref={root} class="st-library-dropdown" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={(event) => {
      if (!open) return;
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }}>
      <span class="st-library-label" id={`${props.kind}-label`}>Active {props.kind}</span>
      <button ref={trigger} type="button" class="st-library-trigger" disabled={props.disabled} aria-labelledby={`${props.kind}-label ${props.kind}-selected`} aria-expanded={open} aria-controls={`${props.kind}-choices`} data-testid={`active-${props.kind}`} data-value={active?.id ?? ""} onClick={() => setOpen(!open)}>
        <span id={`${props.kind}-selected`}>{active?.name ?? `Choose a ${props.kind}`}</span><span aria-hidden="true">▾</span>
      </button>
      {open ? <div class="st-library-menu" id={`${props.kind}-choices`} role="group" aria-label={`${props.kind} selection`}>
        <div class="st-library-choices">
          {props.entries.map((entry) => <button type="button" key={entry.id} class={`st-library-choice${entry.id === props.activeId ? " selected" : ""}`} aria-current={entry.id === props.activeId ? "true" : undefined} data-testid={`${props.kind}-option-${entry.id}`} onClick={() => { props.onSelect(entry.id); close(); }}>
            <span>{entry.name}</span>{entry.id === props.activeId ? <span aria-hidden="true">✓</span> : null}
          </button>)}
        </div>
        {active ? <form key={active.id} class="st-library-rename" onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.querySelector("input")!;
          const name = input.value.trim();
          if (!name) { input.focus(); return; }
          props.onRename(name);
          close();
        }}>
          <label class="st-field"><span>Rename {props.kind}</span><input defaultValue={active.name} required maxLength={80} data-testid={`${props.kind}-name`} /></label>
          <button type="submit" class="st-btn small" data-testid={`save-${props.kind}-name`}>Save name</button>
        </form> : null}
        <button type="button" class="st-library-create" data-testid={`create-${props.kind}-option`} onClick={() => { props.onCreate(); close(); }}>+ Create new {props.kind}</button>
      </div> : null}
    </div>
  );
}
