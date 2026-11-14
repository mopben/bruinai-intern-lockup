/**
 * WebSocket relay: /ws?role=stage|tablet|camera.
 *
 * Every valid envelope a client sends is relayed, unchanged, to every other
 * client. The server itself sends `presence` on the control channel whenever
 * someone connects or leaves, and can broadcast (e.g. a received scan).
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { decodeEnvelope, encodeEnvelope, ROLES, type Envelope, type Role, type RoleCounts } from "../src/inputs/protocol";
import type { Logger } from "./logger";

export interface Relay {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  broadcast(envelope: Envelope): void;
  counts(): RoleCounts;
  close(): Promise<void>;
}

export interface RelayOptions {
  readonly logger: Logger;
  readonly maxMessageBytes?: number;
  readonly heartbeatMs?: number;
}

interface Client {
  readonly socket: WebSocket;
  readonly role: Role | "other";
  alive: boolean;
}

const roleOf = (raw: string | null): Role | "other" =>
  (ROLES as readonly string[]).includes(raw ?? "") ? (raw as Role) : "other";

export function createRelay(options: RelayOptions): Relay {
  const { logger } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: options.maxMessageBytes ?? 4 * 1024 * 1024 });
  const clients = new Set<Client>();

  const counts = (): RoleCounts => {
    const base = { stage: 0, tablet: 0, camera: 0, other: 0 };
    return [...clients].reduce((acc, c) => ({ ...acc, [c.role]: acc[c.role] + 1 }), base);
  };

  const sendTo = (client: Client, text: string) => {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(text);
  };

  const broadcastText = (text: string, except?: Client) => {
    for (const client of clients) if (client !== except) sendTo(client, text);
  };

  const announcePresence = () =>
    broadcastText(encodeEnvelope({ channel: "control", payload: { type: "presence", roles: counts() } }));

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        logger.warn("Dropping an unresponsive client", { role: client.role });
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, options.heartbeatMs ?? 15_000);
  heartbeat.unref();

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const role = roleOf(new URL(req.url ?? "/", "http://x").searchParams.get("role"));
    const client: Client = { socket, role, alive: true };
    clients.add(client);
    logger.info(`${role} connected`, { from: req.socket.remoteAddress, clients: counts() });
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      const envelope = decodeEnvelope(text);
      if (envelope === undefined) {
        logger.warn("Ignored a message that is not a {channel, payload} envelope", { role });
        return;
      }
      broadcastText(text, client);
    });
    socket.on("close", () => {
      clients.delete(client);
      logger.info(`${role} disconnected`, { clients: counts() });
      announcePresence();
    });
    socket.on("error", (error) => logger.warn("WebSocket error", { role, error: error.message }));
    announcePresence();
  });

  return {
    handleUpgrade(req, socket, head) {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },
    broadcast: (envelope) => broadcastText(encodeEnvelope(envelope)),
    counts,
    close: () =>
      new Promise((done) => {
        clearInterval(heartbeat);
        for (const client of clients) client.socket.terminate();
        clients.clear();
        wss.close(() => done());
      }),
  };
}
