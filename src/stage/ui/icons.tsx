/**
 * The activity bar's icons: 24×24 stroke drawings in currentColor, so they
 * take the button's colour. Decorative only (the button has the label).
 */

export function BuildIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14.5 4.5 19.5 9.5 9.5 19.5 4.5 14.5Z" />
      <path d="M13 6 18 11" />
      <path d="M4.5 14.5 3 21l6.5-1.5" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </svg>
  );
}

export function RunIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5Z" />
    </svg>
  );
}
