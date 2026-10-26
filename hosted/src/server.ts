/**
 * THE HOSTED SERVER'S DOOR (OL2; design: docs/hosted/DESIGN.md §1–§3).
 *
 * One HTTP server for `app.counterparts.ai`: the MCP endpoint at `/mcp`, a
 * health line, and whatever other routes the composition hands in (accounts,
 * OAuth). This file is the gate in front of the transport that
 * `src/adapters/remote/http.ts#handleMcpPost` already is; nothing here is a
 * memory rule.
 *
 * THE GATE, in order, for `/mcp` (and `/mcp/`, the same, no redirect):
 *
 *   1. anything but POST → `405`, `Allow: POST` (no SSE stream is offered);
 *   2. an `Origin` header that is present and not on the allow-list → `403`
 *      (MCP 2026-07-28 requires it; claude.ai calls server to server and sends
 *      none);
 *   3. no bearer token, or one `authenticate` does not know → `401` with
 *      `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`
 *      — the pointer claude.ai follows to start OAuth (it ignores the header on
 *      any other status);
 *   4. a body that is not `application/json` → `415`, which closes the
 *      `text/plain` "simple request" a page could send with no preflight (the
 *      #634 review's hole in the local door);
 *   5. the caller's store, through `Tenants.withTenant` (its own queue).
 *
 * THE STORE COMES FROM THE TOKEN AND NOTHING ELSE. No path segment, header or
 * argument names a store; `authenticate` maps a token to exactly one person and
 * that person's one store.
 *
 * Bound by the entry point, not here: this returns an unlistened `Server`.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { handleMcpPost } from "../../src/adapters/remote/http.js";
import type { CallRecord } from "../../src/adapters/remote/http.js";
import type { Tenants } from "./tenants.js";

/** Who a valid token speaks for. */
export interface Caller {
  readonly personId: string;
  readonly storeId: string;
  /** IANA zone (`people.time_zone`). */
  readonly timeZone?: string;
}

/** Token → caller, or null. The token is never logged by anything here. */
export type Authenticate = (token: string) => Promise<Caller | null>;

/** Another route's handler: true when it answered. */
export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;

export interface HostedCallRecord extends CallRecord {
  /** The store, as an HMAC under the server's salt: matchable, not nameable. */
  readonly store: string;
}

export interface HostedServerOptions {
  readonly tenants: Tenants;
  readonly authenticate: Authenticate;
  /** `https://app.counterparts.ai`, no trailing slash. Every published URL is built from it, never from a request's Host. */
  readonly publicOrigin: string;
  /** Origins a browser-based client may call `/mcp` from. Empty by default. */
  readonly allowedOrigins?: readonly string[];
  /** Routes tried, in order, before the 404 (accounts, OAuth pages). */
  readonly routes?: readonly Route[];
  readonly maxBodyBytes?: number;
  /** The call log: ids and codes only (`http.ts#CallRecord`) plus the hashed store. */
  readonly onCall?: (record: HostedCallRecord) => void;
  /** The salt the store tag is keyed with. Random per process when absent. */
  readonly logSalt?: string;
}

export const MCP_PATHS = new Set(["/mcp", "/mcp/"]);

/** The Protected Resource Metadata URL the 401 points at (path-inserted, RFC 9728 §3.1). */
export function resourceMetadataUrl(publicOrigin: string): string {
  return `${publicOrigin}/.well-known/oauth-protected-resource/mcp`;
}

/** The resource people paste, exactly. */
export function resourceUrl(publicOrigin: string): string {
  return `${publicOrigin}/mcp`;
}

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function text(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}

/** The bearer token, or null. Only the `Authorization: Bearer` header: never a query string. */
export function bearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = /^Bearer[ ]+([A-Za-z0-9._~+/=-]{16,512})$/.exec(h.trim());
  return m === null ? null : (m[1] ?? null);
}

export function createHostedServer(opts: HostedServerOptions): Server {
  const origin = opts.publicOrigin.replace(/\/+$/, "");
  const allowed = new Set(opts.allowedOrigins ?? []);
  const salt = opts.logSalt ?? randomBytes(32).toString("hex");
  const tag = (storeId: string): string => createHmac("sha256", salt).update(storeId).digest("hex").slice(0, 16);
  const hsts: Record<string, string> = origin.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000" } : {};
  const challenge = (error?: string): Record<string, string> => ({
    "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(origin)}"${error === undefined ? "" : `, error="${error}"`}`,
  });

  const mcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      req.resume();
      text(res, 405, "405\n", { Allow: "POST", ...hsts });
      return;
    }
    const from = req.headers["origin"];
    if (typeof from === "string" && !allowed.has(from)) {
      req.resume();
      text(res, 403, "403\n", hsts);
      return;
    }
    const token = bearer(req);
    const caller = token === null ? null : await opts.authenticate(token).catch(() => null);
    if (caller === null) {
      req.resume();
      text(res, 401, "401\n", { ...challenge(token === null ? undefined : "invalid_token"), ...hsts });
      return;
    }
    const type = req.headers["content-type"];
    if (typeof type !== "string" || !/^application\/json\s*(;|$)/i.test(type)) {
      req.resume();
      text(res, 415, "415\n", hsts);
      return;
    }
    for (const [k, v] of Object.entries(hsts)) res.setHeader(k, v);
    const store = tag(caller.storeId);
    await opts.tenants.withTenant(caller.storeId, caller.timeZone === undefined ? {} : { timeZone: caller.timeZone }, (target) =>
      new Promise<void>((done) => {
        res.once("close", () => done());
        res.once("finish", () => done());
        handleMcpPost(req, res, target, {
          ...(opts.maxBodyBytes === undefined ? {} : { maxBodyBytes: opts.maxBodyBytes }),
          onCall: (r) => opts.onCall?.({ ...r, store }),
        });
      }),
    );
  };

  return createServer((req, res) => {
    void (async (): Promise<void> => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", origin);
      } catch {
        req.resume();
        text(res, 400, "400\n");
        return;
      }
      if (MCP_PATHS.has(url.pathname)) return mcp(req, res);
      if (url.pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
        req.resume();
        text(res, 200, "ok\n", hsts);
        return;
      }
      for (const route of opts.routes ?? []) {
        if (await route(req, res, url)) return;
      }
      req.resume();
      text(res, 404, "Not found\n", hsts);
    })().catch(() => {
      // Never the message: it could name a path on disk.
      if (!res.headersSent) text(res, 500, "500\n");
      else res.destroy();
    });
  });
}
