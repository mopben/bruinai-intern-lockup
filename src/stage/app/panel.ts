/**
 * The side panel's width maths and its saved state. Pure: no DOM, no storage.
 */

export const PANEL_KEY = "dryrun.panel";
export const PANEL_MIN = 280;
export const PANEL_SNAP = 180;

export interface PanelState {
  readonly open: boolean;
  readonly width: number;
}

export function panelMax(vw: number): number {
  return vw * 0.6;
}

export function defaultPanelWidth(vw: number): number {
  return Math.min(Math.max(380, vw * 0.29), 560);
}

export function clampWidth(width: number, vw: number): number {
  return Math.min(Math.max(width, PANEL_MIN), panelMax(vw));
}

/** What a released drag leaves: below the snap it collapses and keeps the width it had before the drag. */
export function dragResult(dragged: number, previous: number, vw: number): PanelState {
  if (dragged < PANEL_SNAP) return { open: false, width: clampWidth(previous, vw) };
  return { open: true, width: clampWidth(dragged, vw) };
}

/** The saved "{ open, width }", or the default when the json is missing, broken or out of range. */
export function parsePanel(json: string | null, vw: number): PanelState {
  const fallback: PanelState = { open: true, width: defaultPanelWidth(vw) };
  if (!json) return fallback;
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) return fallback;
    const p = raw as { open?: unknown; width?: unknown };
    return {
      open: typeof p.open === "boolean" ? p.open : fallback.open,
      width: typeof p.width === "number" && Number.isFinite(p.width) ? clampWidth(p.width, vw) : fallback.width,
    };
  } catch {
    return fallback;
  }
}
