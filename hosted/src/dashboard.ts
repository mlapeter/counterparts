/**
 * THE DASHBOARD ON HOSTED (HD2, 2026-11-10): the local dashboard's own page,
 * static files and `/api` views, served at `/dashboard/` to the signed-in
 * owner, from the same code (`src/adapters/dashboard/web/respond.ts`). Nothing
 * of the dashboard is copied here; this file is only the hosted door to it.
 *
 *   GET /dashboard            → /dashboard/
 *   GET /dashboard/           the page (the host's name and base filled in)
 *   GET /dashboard/<static>   the page's modules, stylesheets and fonts
 *   GET /dashboard/api/<view> one of `HOSTED_VIEWS`, over the owner's store
 *   anything else under it    refused; no POST at all (read-only first)
 *
 * THE RULES THIS FILE KEEPS:
 *
 *   - **Owner-only, from the session.** Every request resolves the session's
 *     person, then that person's one active store (`accounts.person`). Nothing
 *     in the URL names a store: no view reads a store id, and none is passed.
 *     No session: the page goes to sign-in, `/api` and the files are a 401.
 *   - **A pending delete opens nothing.** Its session is not a person here
 *     (`sessionPerson` is active-only); the page goes to `/account`, which is
 *     the pending page, and `/api` is a 403. The store's own lock
 *     (`Tenants.locked`, `StoreLocked`) is checked again inside its queue.
 *   - **A look is not a wake.** Nothing here calls the door's `onWake`
 *     (`people.last_wake_on`), a tool, or the worker; the views run over an
 *     OBSERVER Counterpart (`Dashboard.open`, observer by construction), which
 *     stands down every write, catch-up and spawn.
 *   - **Through the store's queue.** Each `/api` view opens the observer handle
 *     inside `Tenants.withTenant(...).serial`, the door export takes, and closes
 *     it before the turn ends: so a delete's close and lock cover it, and no
 *     handle of ours outlives the request. A store with no database yet (signed
 *     up, never connected) is not created by a look: it says so instead.
 *   - **No actions, and a strict CSP with no inline script.** This file never
 *     imports `actions.ts`. The page's scripts are same-origin modules
 *     (`script-src 'self'`); inline `style=` attributes in the drawn markup are
 *     the one inline allowance (`style-src-attr 'unsafe-inline'`), never script.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Dashboard } from "../../src/adapters/dashboard/index.js";
import { BRAIN_LIBRARY, HOSTED_HOST, json, servesView, staticReply, viewReply } from "../../src/adapters/dashboard/web/respond.js";
import type { Files, Reply } from "../../src/adapters/dashboard/web/respond.js";
import { DATABASE_FILE } from "../../src/core/store/paths.js";
import type { Accounts } from "./accounts.js";
import type { Pages } from "./pages.js";
import type { Route } from "./server.js";
import { StoreLocked, StoreNeedsRestore, tenantDir } from "./tenants.js";
import type { Tenants } from "./tenants.js";
import { parseCookies, redirect } from "./web.js";

export const DASHBOARD_PREFIX = "/dashboard";

/**
 * The dashboard's own policy (the account pages' is `web.ts#page`). Scripts,
 * styles, fonts and fetches from this origin only; no inline script (the page
 * has none: its clicks are delegated, `shared/dom.js`); inline style
 * ATTRIBUTES only, which the drawn markup uses for widths and colours. No
 * frames, forms, base or plugins.
 */
export const DASHBOARD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

const HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": DASHBOARD_CSP,
};

const FILES: Files = {
  text: (file) => readFileSync(file, "utf8"),
  bytes: (file) => readFileSync(file),
};

export interface DashboardRouteOptions {
  readonly pages: Pages;
  readonly accounts: Accounts;
  readonly tenants: Tenants;
  /** A 500's error, by where and the store (never its message on the page). */
  readonly onError?: (storeId: string | null, err: unknown) => void;
}

function send(res: ServerResponse, reply: Reply, head: boolean): void {
  res.writeHead(reply.status, { ...reply.headers, ...HEADERS });
  res.end(head ? undefined : (reply.bytes ?? reply.body));
}

/** The words for a store a look can't open, by why. */
const EMPTY_WORDS = "Your memory is empty so far. Connect Counterparts in Claude and start a chat, then come back.";
const RESTORE_WORDS = "Your memory is being restored. Try again in a little while.";
const LOCKED_WORDS = "Your account is set to be deleted, so your memory isn't shown.";
const BUSY_WORDS = "Your dashboard is still reading your memory. Try again in a moment.";

/** How many of one person's `/api` views may run or wait at once (#801 review: one session must not stall the process). */
export const MAX_VIEWS_IN_FLIGHT = 2;

export function dashboardRoute(opts: DashboardRouteOptions): Route {
  const { pages, accounts, tenants } = opts;
  /** Each person's views running or queued now. */
  const inFlight = new Map<string, number>();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const p = url.pathname;
    if (p !== DASHBOARD_PREFIX && !p.startsWith(`${DASHBOARD_PREFIX}/`)) return false;
    req.resume();
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      // Read-only first: no action, and no other method, answers here.
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Allow: "GET, HEAD", ...HEADERS });
      res.end(JSON.stringify({ error: "the hosted dashboard only looks; nothing was done" }));
      return true;
    }
    if (p === DASHBOARD_PREFIX) {
      redirect(res, `${DASHBOARD_PREFIX}/`);
      return true;
    }
    const sub = p.slice(DASHBOARD_PREFIX.length); // "/", "/api/meta", "/shared/x.js", …
    const isPage = sub === "/" || sub === "/index.html";
    const isApi = sub.startsWith("/api/");

    // THE SESSION, and nothing else, says whose dashboard this is.
    const personId = pages.personOf(req);
    if (personId === null) {
      const pending = accounts.sessionPendingDelete(parseCookies(req).get(pages.cookieNames.session) ?? null);
      if (pending !== null) {
        if (isPage) redirect(res, "/account");
        else send(res, json({ error: LOCKED_WORDS }, 403), head);
        return true;
      }
      if (isPage) redirect(res, `/login?next=${encodeURIComponent(`${DASHBOARD_PREFIX}/`)}`);
      else send(res, json({ error: "sign in first" }, 401), head);
      return true;
    }

    if (!isApi) {
      const asset = staticReply(sub, HOSTED_HOST, FILES, existsSync(BRAIN_LIBRARY));
      send(res, asset ?? json({ error: "not found" }, 404), head);
      return true;
    }

    // A view this host doesn't serve answers before any store is looked at.
    if (!servesView(HOSTED_HOST, sub)) {
      send(res, json({ error: "not on hosted yet" }, 404), head);
      return true;
    }
    const person = accounts.person(personId);
    const storeId = person?.storeId ?? null;
    if (person === null || storeId === null) {
      send(res, json({ error: LOCKED_WORDS }, 403), head);
      return true;
    }
    const storeDir = join(tenantDir(tenants.root, storeId), "store");
    if (!existsSync(join(storeDir, DATABASE_FILE))) {
      // Never opened: a look doesn't create it (that is a first chat's). Opened
      // before and missing: it waits for a restore.
      send(res, accounts.wasOpened(storeId) ? json({ error: RESTORE_WORDS }, 503) : json({ error: EMPTY_WORDS }, 409), head);
      return true;
    }
    // Only the path and the query reach the view, under the page's base.
    const viewUrl = new URL(`${sub}${url.search}`, "http://dashboard.invalid");
    // ONE PERSON CAN'T HOLD THE PROCESS (#801 review): a view is synchronous
    // work on the one event loop, so at most `MAX_VIEWS_IN_FLIGHT` of this
    // person's views run or wait at a time; the rest are a 429 at once.
    const held = inFlight.get(personId) ?? 0;
    if (held >= MAX_VIEWS_IN_FLIGHT) {
      send(res, { ...json({ error: BUSY_WORDS }, 429), headers: { ...json(null).headers, "retry-after": "2" } }, head);
      return true;
    }
    inFlight.set(personId, held + 1);
    const timeZone = person.timeZone ?? undefined;
    let reply: Reply;
    try {
      reply = await tenants.withTenant(storeId, timeZone === undefined ? {} : { timeZone }, (target) =>
        target.serial(async () => {
          // A turn for everything else first (other people, /healthz): the
          // queue would otherwise run queued turns back to back.
          await new Promise<void>((r) => setImmediate(r));
          const look = Dashboard.open({ dir: storeDir, ...(timeZone === undefined ? {} : { timeZone }) });
          try {
            return viewReply(viewUrl, look.source, HOSTED_HOST) ?? json({ error: "not found" }, 404);
          } finally {
            look.close();
          }
        }),
      );
    } catch (err) {
      if (err instanceof StoreLocked) reply = json({ error: LOCKED_WORDS }, 403);
      else if (err instanceof StoreNeedsRestore) reply = json({ error: RESTORE_WORDS }, 503);
      else {
        try {
          opts.onError?.(storeId, err);
        } catch {
          /* a log, not a gate */
        }
        reply = json({ error: "this view could not be read just now" }, 500);
      }
    } finally {
      const left = (inFlight.get(personId) ?? 1) - 1;
      if (left <= 0) inFlight.delete(personId);
      else inFlight.set(personId, left);
    }
    send(res, reply, head);
    return true;
  };
}
