/**
 * Rename and correct one scanned box: name, what it is, fixed or not, where
 * people stand, split a long counter in two.
 */
import type { BoxSide, ItemRole } from "../../core";
import { canSplit, itemSetupOf, renameItem, setLocked, setRole, setStandSide, splitBox } from "../app/kitchen-edit";
import { roleColors } from "../theme/tokens";
import { editKitchen } from "../state/kitchen-actions";
import { kitchen, moveInScan, selectedId } from "../state/store";
import { Btn } from "./bits";

const ROLES: readonly { readonly role: ItemRole; readonly label: string }[] = [
  { role: "station", label: "Station" },
  { role: "storage", label: "Storage" },
  { role: "pickup", label: "Pickup" },
  { role: "queue", label: "Queue" },
  { role: "fixture", label: "Fixed thing" },
  { role: "ignore", label: "Not real (hide)" },
];
const SIDES: readonly { readonly side: BoxSide; readonly label: string }[] = [
  { side: "front", label: "Front" },
  { side: "back", label: "Back" },
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
];

export function ItemPanel(props: { readonly boxId: string }) {
  const k = kitchen.value;
  if (!k) return null;
  const box = k.scan.boxes.find((b) => b.id === props.boxId);
  if (!box) return null;
  const item = itemSetupOf(k, props.boxId);
  const side = item.standSide ?? "front";
  const split = () => {
    const current = kitchen.value;
    const result = current ? splitBox(current, props.boxId) : null;
    if (!result) return;
    editKitchen(() => result.kitchen);
    selectedId.value = result.newId;
  };
  return (
    <div class="st-card" data-testid="item-panel">
      <label class="st-field">
        <span>Name (the scanner called it “{box.category}”)</span>
        <input
          class="st-input"
          value={item.name}
          data-testid="item-name"
          onInput={(e) => editKitchen((x) => renameItem(x, props.boxId, (e.target as HTMLInputElement).value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <div class="st-field">
        <span>What is it?</span>
        <div class="st-chips">
          {ROLES.map((r) => (
            <button
              key={r.role}
              type="button"
              class={`st-pick${item.role === r.role ? " on" : ""}`}
              data-testid={`role-${r.role}`}
              onClick={() => editKitchen((x) => setRole(x, props.boxId, r.role))}
            >
              <span class="sw" style={{ background: roleColors[r.role].body }} />
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div class="st-field">
        <span>Can it move?</span>
        <div class="st-chips">
          <button type="button" class={`st-pick${!item.locked ? " on" : ""}`} data-testid="lock-off" onClick={() => editKitchen((x) => setLocked(x, props.boxId, false))}>
            Can be moved
          </button>
          <button type="button" class={`st-pick${item.locked ? " on" : ""}`} data-testid="lock-on" onClick={() => editKitchen((x) => setLocked(x, props.boxId, true))}>
            Fixed (plumbing or power)
          </button>
        </div>
      </div>
      {item.role === "station" || item.role === "storage" || item.role === "pickup" ? (
        <div class="st-field">
          <span>Which side do people stand?</span>
          <div class="st-chips">
            {SIDES.map((s) => (
              <button key={s.side} type="button" class={`st-pick${side === s.side ? " on" : ""}`} onClick={() => editKitchen((x) => setStandSide(x, props.boxId, s.side))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div class="st-row">
        {canSplit(box) ? <Btn label="Split in two" onClick={split} testId="btn-split" /> : null}
        <Btn label="Done" k="Esc" kind="primary" onClick={() => (selectedId.value = null)} testId="btn-panel-done" />
      </div>
      {moveInScan.value ? <p class="st-small">Drag a box to put it where it really is.</p> : null}
    </div>
  );
}
