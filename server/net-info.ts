/**
 * LAN addresses and the ready-made URLs a tablet, camera or phone should open.
 */
import { networkInterfaces } from "node:os";
import type { ServerInfo } from "../src/inputs/api";

/** Non-internal IPv4 addresses, private ranges first. */
export function lanAddresses(interfaces = networkInterfaces()): readonly string[] {
  const all = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return [...new Set([...all.filter(isPrivate), ...all.filter((ip) => !isPrivate(ip))])];
}

export function urlsFor(host: string, port: number): ServerInfo["urls"] {
  const base = `http://${host}:${port}`;
  return { stage: `${base}/`, tablet: `${base}/tablet`, camera: `${base}/camera`, scanUpload: `${base}/api/scan` };
}

export function serverInfo(port: number, clients: ServerInfo["clients"], addresses = lanAddresses()): ServerInfo {
  const hosts = addresses.length > 0 ? addresses : ["localhost"];
  const allUrls = hosts.map((h) => urlsFor(h, port));
  return { port, addresses, urls: allUrls[0] ?? urlsFor("localhost", port), allUrls, clients };
}
