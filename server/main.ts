/**
 * Entry point: `npm run serve` (tsx server/main.ts).
 *
 * Env: PORT (default 5179), DRYRUN_FIXTURES, DRYRUN_RECORDINGS, DRYRUN_DIST,
 * DRYRUN_LOG_LEVEL (debug|info|warn|error).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, type LogLevel } from "./logger";
import { startServer } from "./app";

export const DEFAULT_PORT = 5179;

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const env = process.env;
const logger = createLogger({ level: (env.DRYRUN_LOG_LEVEL as LogLevel | undefined) ?? "info" });
const port = env.PORT === undefined || env.PORT === "" ? DEFAULT_PORT : Number(env.PORT);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  logger.error(`PORT must be a whole number between 0 and 65535, got "${env.PORT}"`);
  process.exit(2);
}

try {
  const running = await startServer({
    port,
    distDir: env.DRYRUN_DIST ?? resolve(root, "dist"),
    fixturesDir: env.DRYRUN_FIXTURES ?? resolve(root, "fixtures"),
    recordingsDir: env.DRYRUN_RECORDINGS ?? resolve(root, "recordings"),
    logger,
  });
  logger.info(`Dry Run server listening on port ${running.port}`);
  const shutdown = () => {
    logger.info("Shutting down");
    running.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    logger.error(
      `Port ${port} is already in use. Another Dry Run may be running: close it, or free the port with ` +
        `"lsof -ti tcp:${port} | xargs kill", or start on another port with "PORT=5180 npm start".`,
    );
  } else {
    logger.error("Could not start the server", { error: error instanceof Error ? error.message : String(error) });
  }
  process.exit(1);
}
