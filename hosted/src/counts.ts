/**
 * THE OPERATOR'S COUNTS (CN1, Mike 2026-11-17): `GET /ops/counts`, for a script
 * (the marketing seat's daily check-in), the way the site reads its own
 * `/api/waitlist-count`.
 *
 *   { "at": "<ISO>", "accounts": 11, "used": 8, "active7d": 5,
 *     "spots": { "total": 500, "left": 489 },
 *     "sources": { "reddit": 3, "(none)": 8 },
 *     "referrers": { "https://www.reddit.com": 2, "(none)": 9 },
 *     "otherBrowser7d": 1 }
 *
 * COUNTS ONLY (`Accounts#counts`): no address, id, name or date of anyone. The
 * people counted are the ones the spots count, so `sources` and `referrers` each
 * sum to `accounts`.
 *
 * PRIVATE: `Authorization: Bearer <HOSTED_COUNTS_TOKEN>`, compared in constant
 * time (both sides hashed first, so their lengths don't show either). No token
 * configured: the route isn't there (a plain 404, the same as any unknown path).
 * A missing or wrong token: 401. Never cached.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import type { Accounts } from "./accounts.js";
import type { Route } from "./server.js";

export const COUNTS_PATH = "/ops/counts";

const digest = (v: string): Buffer => createHash("sha256").update(v, "utf8").digest();

/** True when `given` is the token, in time that doesn't depend on where they differ. */
export function tokenMatches(given: string, token: string): boolean {
  return timingSafeEqual(digest(given), digest(token)) && given.length > 0;
}

export function countsRoute(opts: { accounts: Accounts; token: string | undefined; now?: () => number }): Route {
  const token = opts.token?.trim() ?? "";
  const now = opts.now ?? ((): number => Date.now());
  return (req, res, url) => {
    if (token.length === 0 || url.pathname !== COUNTS_PATH) return false;
    req.resume();
    const base = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...base, Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed\n");
      return true;
    }
    const header = req.headers["authorization"];
    const m = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
    if (!tokenMatches(m?.[1] ?? "", token)) {
      res.writeHead(401, { ...base, "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="counts"' });
      res.end(req.method === "HEAD" ? undefined : `${JSON.stringify({ error: "unauthorized" })}\n`);
      return true;
    }
    const body = `${JSON.stringify({ at: new Date(now()).toISOString(), ...opts.accounts.counts() })}\n`;
    res.writeHead(200, { ...base, "Content-Type": "application/json" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
