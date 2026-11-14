/**
 * Stage entry (/): the big-screen app. Opens in replay mode on the recorded
 * run unless the URL says otherwise (see app/params.ts).
 */
import { render } from "preact";
import "./theme";
import "./ui/stage.css";
import { parseParams } from "./app/params";
import { boot } from "./state/boot";
import { enterStep } from "./state/flow";
import { activeSetupId, view } from "./state/store";
import { watchScans } from "./state/input-actions";
import { installTestHook } from "./state/test-hook";
import { App } from "./ui/App";
import { initializeWorkspace } from "./state/workspace";

const root = document.getElementById("app");
if (root) {
  installTestHook();
  render(<App />, root);
  void boot(parseParams(globalThis.location.search)).then(() => {
    initializeWorkspace();
    watchScans();
    if (activeSetupId.value) enterStep(view.value);
  });
}
