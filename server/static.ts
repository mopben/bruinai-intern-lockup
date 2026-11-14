/**
 * Static files with no directory traversal.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

export const mimeType = (path: string): string => MIME[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * Maps a URL path below `root` to a file path, or undefined if it would leave
 * `root` (.., encoded slashes, NUL bytes, backslashes) or cannot be decoded.
 */
export function safeResolve(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const parts = decoded.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === ".." || p === ".")) return undefined;
  const base = resolve(root);
  const full = resolve(base, ...parts);
  return full === base || full.startsWith(base + sep) ? full : undefined;
}

export interface ServeOptions {
  readonly cache?: "none" | "short" | "immutable";
}

/** Streams a file if it exists and is a regular file. Returns false if not found. */
export async function serveFile(res: ServerResponse, file: string, options: ServeOptions = {}): Promise<boolean> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const cache =
    options.cache === "immutable" ? "public, max-age=31536000, immutable" : options.cache === "short" ? "no-cache" : "no-store";
  res.writeHead(200, { "content-type": mimeType(file), "content-length": info.size, "cache-control": cache });
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(file);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}
