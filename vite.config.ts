import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

// Three pages: the stage display (index), the tablet, and the camera tracker.
// In dev, API and WebSocket calls are proxied to the Node server on 5179.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        stage: resolve(__dirname, "index.html"),
        tablet: resolve(__dirname, "tablet.html"),
        camera: resolve(__dirname, "camera.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5179",
      "/fixtures": "http://localhost:5179",
      "/ws": { target: "ws://localhost:5179", ws: true },
    },
  },
});
