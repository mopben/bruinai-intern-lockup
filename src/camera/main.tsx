/**
 * Camera tracker entry (/camera). Runs on the laptop; the phone is its
 * webcam. Finds each worker's hat, maps it to floor metres and sends
 * position reports to the stage over the WebSocket (role "camera").
 */
import "../stage/theme";
import "./ui/camera.css";
import { render } from "preact";
import { createReconnectingSocket } from "../inputs/socket";
import { App } from "./ui/App";
import { createCameraStore } from "./ui/store";

const link = createReconnectingSocket({ role: "camera" });
const store = createCameraStore(link);
const root = document.getElementById("app");

if (root !== null) render(<App store={store} />, root);
