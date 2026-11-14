import { useEffect, useRef } from "preact/hooks";
import { importOpen, notices } from "../state/store";
import { Btn } from "./bits";
import { ScanRail } from "./ScanRail";

/** Keep all import and input controls together in a centered modal. */
export function ImportMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const close = () => (importOpen.value = false);
  return (
    <dialog ref={dialog} class="st-workers-dialog st-import-dialog" data-testid="import-menu" aria-labelledby="import-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header class="st-workers-head">
        <div><h1 id="import-title">Import</h1><p>Bring in your kitchen scan and manage connected inputs and recordings.</p></div>
        <Btn label="Done" k="Esc" onClick={close} testId="btn-close-import" />
      </header>
      <div class="st-workers-body st-import-body">
        <ScanRail />
        {notices.value.length > 0 ? <div role="status" class="st-import-notices">{notices.value.map((notice) => <p key={notice.id} class={`st-chip ${notice.tone}`}>{notice.text}</p>)}</div> : null}
      </div>
      <footer class="st-workers-foot"><span>Changes apply to your kitchen as you import.</span><Btn small label="Done" onClick={close} /></footer>
    </dialog>
  );
}
