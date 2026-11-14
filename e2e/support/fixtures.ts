/**
 * The test fixture every acceptance test uses.
 *
 * - No network (rule 9): every request to a host other than localhost is
 *   aborted and recorded, and the test fails if any was attempted. WebSockets
 *   to other hosts are closed and recorded the same way.
 * - No unhandled errors: an uncaught exception or unhandled promise rejection
 *   in any page fails the test.
 */
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocal(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
    return LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export interface Guard {
  /** Requests to other hosts that were attempted (and blocked). */
  readonly external: string[];
  /** Uncaught errors and unhandled rejections, with the page they came from. */
  readonly pageErrors: string[];
  /** Watches another context (a second browser, e.g. the tablet) the same way. */
  watch(context: BrowserContext): Promise<void>;
}

async function guardContext(context: BrowserContext, guard: { external: string[]; pageErrors: string[] }): Promise<void> {
  await context.route(
    (url) => !isLocal(url.href),
    (route) => {
      guard.external.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  await context.routeWebSocket(
    (url) => !isLocal(url.href.replace(/^ws/, "http")),
    (ws) => {
      guard.external.push(ws.url());
      return ws.close();
    },
  );
  const onPage = (page: Page) => {
    page.on("pageerror", (error) => guard.pageErrors.push(`${page.url()}: ${error.message}`));
  };
  context.pages().forEach(onPage);
  context.on("page", onPage);
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context }, use) => {
      const state = { external: [] as string[], pageErrors: [] as string[] };
      await guardContext(context, state);
      const guard: Guard = { ...state, watch: (c) => guardContext(c, state) };
      await use(guard);
      expect(state.external, "requests to the network (the demo must run offline)").toEqual([]);
      expect(state.pageErrors, "uncaught errors or unhandled rejections in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
