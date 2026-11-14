#!/usr/bin/env node
/**
 * `npm start`: the one command.
 *
 * 1. Installs dependencies if node_modules is missing (the only step that needs internet).
 * 2. Builds the app if dist/ is missing or older than anything in src/ or the HTML pages.
 * 3. Generates fixtures if fixtures/counter-a is missing.
 * 4. Starts the server, prints the URLs for the stage, tablet, camera and phone scan,
 *    and opens the stage in the default browser.
 *
 * Flags: --no-open (or env DRYRUN_NO_OPEN=1) skips opening the browser.
 * Env:   PORT (default 5179).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = Number(process.env.PORT || 5179);
const noOpen = process.argv.includes("--no-open") || process.env.DRYRUN_NO_OPEN === "1";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const say = (message) => process.stdout.write(`[dry run] ${message}\n`);
const fail = (message) => {
  process.stderr.write(`\n[dry run] ${message}\n`);
  process.exit(1);
};

function run(label, args, hint) {
  say(label);
  const result = spawnSync(npm, args, { cwd: root, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (result.error) fail(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed (exit ${result.status}). ${hint}`);
}

/** Newest modification time of any file below `dir` (skipping dot folders). */
function newest(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(path)
    .filter((name) => !name.startsWith("."))
    .reduce((max, name) => Math.max(max, newest(join(path, name))), 0);
}

function oldestInDist(dir) {
  const pages = ["index.html", "tablet.html", "camera.html"].map((p) => join(dir, p));
  if (!pages.every((p) => existsSync(p))) return 0;
  return Math.min(...pages.map((p) => statSync(p).mtimeMs));
}

// 1. Install
if (!existsSync(join(root, "node_modules"))) {
  run(
    "Installing dependencies (this one step needs internet; the demo itself does not)…",
    ["install", "--no-audit", "--no-fund"],
    "Check the internet connection and run `npm install` by hand.",
  );
}

// 2. Build
const sources = Math.max(
  newest(join(root, "src")),
  ...["index.html", "tablet.html", "camera.html", "vite.config.ts", "package.json"].map((f) => newest(join(root, f))),
);
const built = oldestInDist(join(root, "dist"));
if (built === 0 || built < sources) {
  run(
    built === 0 ? "Building the app (first run)…" : "Sources changed since the last build; rebuilding…",
    ["run", "build"],
    "Read the error above. `npm run build` reproduces it.",
  );
} else {
  say("App is built and up to date.");
}

// 3. Fixtures
if (!existsSync(join(root, "fixtures", "counter-a", "run.json"))) {
  run("Generating fixtures…", ["run", "fixtures"], "`npm run fixtures` reproduces it.");
}

// 4. Serve
say(`Starting the server on port ${port}…`);
const server = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "server", "main.ts")], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, PORT: String(port) },
});
server.on("error", (error) => fail(`Could not start the server: ${error.message}`));
server.on("exit", (code, signal) => {
  if (signal === "SIGINT" || signal === "SIGTERM" || code === 0) process.exit(0);
  fail(
    `The server stopped (exit ${code}). If the port is in use, close the other Dry Run, ` +
      `run "lsof -ti tcp:${port} | xargs kill", or start with "PORT=5180 npm start".`,
  );
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/info`);
      if (res.ok) return (await res.json()).data;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

const info = await waitForServer();
if (info === undefined) {
  server.kill();
  fail(`The server did not answer on port ${port} within 15 s. See its log above.`);
}

const stage = `http://localhost:${port}/`;
const lines = [
  "",
  "  Dry Run is running. Keep this window open; Ctrl+C stops it.",
  "",
  `  Stage (this laptop):  ${stage}`,
  `  Tablet:               ${info.urls.tablet}`,
  `  Camera page:          ${info.urls.camera}`,
  `  Phone scan upload:    ${info.urls.scanUpload}`,
  ...(info.addresses.length === 0
    ? ["", "  No network found: tablet and phone cannot connect. The stage works on its own in replay."]
    : info.allUrls.length > 1
      ? ["", `  Other addresses: ${info.addresses.slice(1).join(", ")}`]
      : []),
  "",
];
process.stdout.write(`${lines.join("\n")}\n`);

if (!noOpen) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(opener, [stage], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  child.on("error", () => say(`Could not open a browser; open ${stage} by hand.`));
  child.unref();
}
