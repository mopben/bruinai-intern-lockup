/**
 * Import this once from the stage entry point: it loads the bundled fonts
 * (no CDN, the demo runs offline) and the CSS variables in theme.css.
 * TS consumers import the tokens from here too.
 */
import "@fontsource-variable/baloo-2/wght.css";
import "@fontsource-variable/nunito/wght.css";
import "./theme.css";

export * from "./tokens";
