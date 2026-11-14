/**
 * Dry Run stage design tokens. One source for the 3D scene and the panels.
 *
 * The idea: a painted-wood toy diorama on a play table. The kitchen is a
 * birch-ply board with a cream floor, sitting on a pale eucalyptus table.
 * Things on the board are painted blocks; their paint says what they are.
 *
 * Colour use
 * - `table` is the page background behind everything. Panels sit on `paper`.
 * - `ink` is the only text colour on light surfaces. `inkSoft` for secondary text.
 * - Role colours (`role.*`) are reserved for kitchen items and their legend dots.
 *   Do not reuse them for buttons, so "jade" always means "a station".
 * - Worker hats use the WorkerDef colours from the data (red, blue, yellow, green).
 *   Role colours were picked to stay clear of those four.
 * - `alert` (tomato) means "orders are piling up here". Use it for the slow
 *   station and nothing decorative.
 * - `scan` (cool slate blue) is the scanner's voice: raw categories before the
 *   owner names things. It disappears once names are shown.
 * - `path` (caramel) is walking. Dashed caramel on the floor = metres walked.
 *
 * Typography (sized for a projector seen from the back of a room)
 * - Display and labels: Baloo 2, weights 700-800. Rounded and chunky, like
 *   stickers on toys. Used for item names, big numbers and step names.
 * - Body and controls: Nunito, weights 600-800. Never below 18px on the stage.
 * - Sentence case everywhere. No all-caps labels, no tracking tricks.
 * - Scale (px at 1920x1080): numeral 120, display 64, title 40, label 28,
 *   body 22, small 18. Scale with the viewport via the CSS clamp values.
 */

export const palette = {
  table: "#cad7d0",
  tableDeep: "#a9bdb3",
  paper: "#fffaf0",
  floor: "#f4e7cb",
  floorLine: "#dcc59a",
  floorLineFaint: "#eadbb8",
  boardEdge: "#d6b583",
  boardEdgeDark: "#b8925e",
  wall: "#e9d6b4",
  wallCap: "#fbf1dc",
  ink: "#3b2f28",
  inkSoft: "#6f5e52",
  alert: "#e2543a",
  scan: "#5b8fa8",
  scanBox: "#dbe5e8",
  path: "#c9762e",
  select: "#f2a93b",
  bolt: "#5a4a3f",
  ticket: "#fffdf6",
} as const;

export type RoleKey = "station" | "storage" | "pickup" | "queue" | "fixture" | "ignore";

/** Paint for each item role. `top` is a lighter lid colour for the box top. */
export const roleColors: Readonly<Record<RoleKey, { readonly body: string; readonly top: string; readonly label: string }>> = {
  station: { body: "#2f9c8a", top: "#5cc0ac", label: "Station" },
  storage: { body: "#8e7cc3", top: "#b3a6dc", label: "Storage" },
  pickup: { body: "#df6f97", top: "#f09bb9", label: "Pickup" },
  queue: { body: "#f0b44c", top: "#f6cf83", label: "Queue" },
  fixture: { body: "#b9ada0", top: "#d6ccc1", label: "Fixed" },
  ignore: { body: "#d9d4cc", top: "#e9e5de", label: "Hidden" },
};

/** Colours for walking-path kinds. Unknown kinds use `walk`. */
export const pathColors: Readonly<Record<string, string>> = {
  walk: palette.path,
  fetch: "#8e7cc3",
  carry: "#2f9c8a",
};

export const fonts = {
  display: "'Baloo 2 Variable', 'Baloo 2', 'Nunito Variable', system-ui, sans-serif",
  body: "'Nunito Variable', 'Nunito', system-ui, sans-serif",
} as const;

/** Type scale in px at 1920x1080. CSS uses clamp() versions of these. */
export const typeScale = {
  numeral: 120,
  display: 64,
  title: 40,
  label: 28,
  body: 22,
  small: 18,
} as const;

export const radii = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const shadows = {
  /** A block sitting on the table. Warm, offset down, never grey. */
  rest: "0 3px 0 rgba(59,47,40,0.18), 0 8px 18px rgba(59,47,40,0.12)",
  lifted: "0 6px 0 rgba(59,47,40,0.16), 0 18px 32px rgba(59,47,40,0.18)",
} as const;

export const motion = {
  fast: 140,
  base: 260,
  slow: 600,
  /** Springy pop used for things arriving. */
  pop: "cubic-bezier(.34,1.56,.64,1)",
  ease: "cubic-bezier(.2,.7,.2,1)",
} as const;
