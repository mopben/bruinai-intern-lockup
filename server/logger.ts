/**
 * A tiny logger. One line per entry: time, level, message, optional details.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) =>
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = ORDER[options.level ?? "info"];
  const write = options.write ?? defaultWrite;
  const log = (level: LogLevel) => (message: string, details?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const time = new Date().toISOString().slice(11, 19);
    const extra = details === undefined ? "" : ` ${JSON.stringify(details)}`;
    write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${extra}`, level);
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}

/** A logger that keeps lines in memory. For tests. */
export function createMemoryLogger(): Logger & { readonly lines: readonly string[] } {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
  return { ...logger, lines };
}
