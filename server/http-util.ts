/**
 * Small helpers over node:http: JSON envelopes and bounded body reading.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

export const sendData = (res: ServerResponse, data: unknown, status = 200) => sendJson(res, status, { success: true, data });
export const sendError = (res: ServerResponse, status: number, error: string) => sendJson(res, status, { success: false, error });

/** Reads the whole body, refusing anything over `limitBytes`. */
export function readBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limitBytes) {
      reject(new HttpError(413, `Body too large (${declared} bytes; limit ${limitBytes})`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        reject(new HttpError(413, `Body too large (limit ${limitBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

export async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const text = await readBody(req, limitBytes);
  if (text.trim() === "") throw new HttpError(400, "The request body is empty; expected JSON");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HttpError(400, `The request body is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}
