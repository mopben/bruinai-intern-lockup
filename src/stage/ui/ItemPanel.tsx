/**
 * Rename and correct one scanned box: name, what it is, fixed or not, where
 * people stand, split a long counter in two.
 */
import type { BoxSide, ItemRole } from "../../core";
import { canSplit, itemSetupOf, renameItem, setLocked, setRole, setStandSide, splitBox } from "../app/kitchen-edit";
import { editKitchen } from "../state/kitchen-actions";
import { kitchen, selectedId } from "../state/store";
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
    editKitchen((x) => splitBox(x, props.boxId)?.kitchen ?? x);
    selectedId.value = result.newId;
  };
  return (
    <div class="st-card" data-testid="item-panel">
      <label class="st-field">
        <span>Name</span>
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
        <span>Type</span>
        <select
          class="st-select"
          data-testid="item-type"
          value={item.role}
          onChange={(e) => editKitchen((x) => setRole(x, props.boxId, (e.target as HTMLSelectElement).value as ItemRole))}
        >
          {ROLES.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div class="st-field">
        <span>Can it move?</span>
        <label class="st-check">
          <input
            type="checkbox"
            data-testid="item-fixed"
            checked={item.locked}
            onChange={(e) => editKitchen((x) => setLocked(x, props.boxId, (e.target as HTMLInputElement).checked))}
          />
          Fixed (plumbing or power)
        </label>
      </div>
      {item.role === "station" || item.role === "storage" || item.role === "pickup" ? (
        <div class="st-field">
          <span>Which side do people stand?</span>
          <select
            class="st-select"
            data-testid="item-side"
            value={side}
            onChange={(e) => editKitchen((x) => setStandSide(x, props.boxId, (e.target as HTMLSelectElement).value as BoxSide))}
          >
            {SIDES.map((s) => (
              <option key={s.side} value={s.side}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div class="st-row">
        {canSplit(box) ? <Btn label="Split in two" onClick={split} testId="btn-split" /> : null}
        <Btn label="Done" k="Esc" kind="primary" onClick={() => (selectedId.value = null)} testId="btn-panel-done" />
      </div>
    </div>
  );
}
