/**
 * Tablet entry (/tablet). Connects to the laptop server as role "tablet".
 */
import "@fontsource-variable/baloo-2";
import "@fontsource-variable/nunito";
import "./tablet.css";
import { render } from "preact";
import { createReconnectingSocket } from "../inputs/socket";
import { App } from "./App";
import { createTabletStore } from "./store";

const params = new URLSearchParams(globalThis.location.search);
const link = createReconnectingSocket({ role: "tablet" });
const store = createTabletStore(link);
const root = document.getElementById("app");

if (root !== null) {
  render(
    <App store={store} stationParam={params.get("station") ?? undefined} workerParam={params.get("worker") ?? undefined} />,
    root,
  );
}
