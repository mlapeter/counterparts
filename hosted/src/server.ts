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
import type { LimitReason, McpLimits } from "./limits.js";
import { StoreNeedsRestore } from "./tenants.js";
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
  /** Per-account limits on `/mcp` (`limits.ts`). Absent ⇒ none (tests of the earlier steps). */
  readonly limits?: McpLimits;
  /** Told each limit refusal and each store refused for a missing restore, with the hashed store tag only. A throw is swallowed. */
  readonly onEvent?: (name: `limit.${LimitReason}` | "store.needs-restore", store: string) => void;
  /** `/readyz`: names of checks and their states only, never an id or a secret. Absent ⇒ `/readyz` answers like `/healthz`. */
  readonly readiness?: () => Promise<Readiness>;
  /** First deploy only (`LOG_FORWARDED_FOR=1`): told the raw `X-Forwarded-For` of each `/readyz` request, to check the proxy's hops (INTERFACE-GAPS §4). */
  readonly logForwardedFor?: (raw: string) => void;
}

/** What `/readyz` reports: `ready`, and each check's word ("ok", "off", "down", "starting"). */
export interface Readiness {
  readonly ready: boolean;
  readonly checks: Readonly<Record<string, string>>;
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
    // A token we could not CHECK (the accounts database down, say) is not a
    // token we refused: 503, so claude.ai retries instead of asking the person
    // to sign in again (review of the OL2 stack, info).
    let caller: Caller | null;
    try {
      caller = token === null ? null : await opts.authenticate(token);
    } catch {
      req.resume();
      text(res, 503, "503\n", { "Retry-After": "30", ...hsts });
      return;
    }
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
    const store = tag(caller.storeId);
    const limits = opts.limits;
    if (limits !== undefined && !limits.enter(caller.personId)) {
      req.resume();
      event("limit.in-flight", store);
      text(res, 429, "429: too many requests at once for this account\n", { "Retry-After": "5", ...hsts });
      return;
    }
    // The slot is given back once, at the answer, or when the client's socket
    // goes (under bun an abort mid-body never ends the request: INTERFACE-GAPS §18).
    let held = limits !== undefined;
    const release = (): void => {
      if (!held) return;
      held = false;
      limits?.leave(caller.personId);
    };
    req.socket.once("close", release);
    for (const [k, v] of Object.entries(hsts)) res.setHeader(k, v);
    try {
      await opts.tenants.withTenant(caller.storeId, caller.timeZone === undefined ? {} : { timeZone: caller.timeZone }, (target) =>
        new Promise<void>((done) => {
          res.once("close", () => done());
          res.once("finish", () => done());
          // Under bun an abort mid-body emits neither (INTERFACE-GAPS §18); the socket's close is the last word.
          const gone = (): void => done();
          req.socket.once("close", gone);
          res.once("finish", () => req.socket.removeListener("close", gone));
          res.once("close", () => req.socket.removeListener("close", gone));
          const routed = limits === undefined ? target : { serial: target.serial, server: limits.wrap(target.server, caller.personId, caller.storeId, (reason) => event(`limit.${reason}`, store)) };
          handleMcpPost(req, res, routed, {
            ...(opts.maxBodyBytes === undefined ? {} : { maxBodyBytes: opts.maxBodyBytes }),
            onCall: (r) => opts.onCall?.({ ...r, store }),
          });
        }),
      );
    } catch (err) {
      // A store whose files are gone waits for a restore (tenants.ts#StoreNeedsRestore):
      // 503, so the client retries later instead of asking the person to sign in again.
      if (!(err instanceof StoreNeedsRestore) || res.headersSent) throw err;
      req.resume();
      event("store.needs-restore", store);
      text(res, 503, "503: this memory is being restored\n", { "Retry-After": "300" });
    } finally {
      req.socket.removeListener("close", release);
      release();
    }
  };
  const event = (name: `limit.${LimitReason}` | "store.needs-restore", store: string): void => {
    try {
      opts.onEvent?.(name, store);
    } catch {
      /* a log, not a gate */
    }
  };

  const server = createServer((req, res) => {
    void (async (): Promise<void> => {
      // ONLY ORIGIN-FORM TARGETS ("/path?query"). An absolute-form or
      // "//host/x" target would give `url.host` a host the client chose; every
      // route builds its URLs from `publicOrigin`, and nothing reaches a route
      // whose target could say otherwise (review of the OL2 stack, info).
      const target = req.url ?? "/";
      if (!target.startsWith("/") || target.startsWith("//")) {
        req.resume();
        text(res, 400, "400\n");
        return;
      }
      let url: URL;
      try {
        url = new URL(target, origin);
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
      // READY: the control databases answer, start-up finished, the key ring
      // opened every key, and (with backups on) the sidecar is up. Names and
      // states only. A check that throws is "down", and its message is not shown.
      if (url.pathname === "/readyz" && (req.method === "GET" || req.method === "HEAD")) {
        req.resume();
        if (opts.logForwardedFor !== undefined) {
          const xff = req.headers["x-forwarded-for"];
          opts.logForwardedFor((Array.isArray(xff) ? xff.join(" | ") : (xff ?? "(none)")).slice(0, 200));
        }
        let report: Readiness;
        try {
          report = opts.readiness === undefined ? { ready: true, checks: {} } : await opts.readiness();
        } catch {
          report = { ready: false, checks: { readiness: "down" } };
        }
        res.writeHead(report.ready ? 200 : 503, { ...BASE_HEADERS, "Content-Type": "application/json", ...hsts });
        res.end(`${JSON.stringify({ ready: report.ready, checks: report.checks })}\n`);
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
  // The same bounds as the local door (`remote/http.ts#serveHttp`): a client
  // that trickles its headers or its body is cut off.
  server.headersTimeout = 30_000;
  server.requestTimeout = 300_000;
  return server;
}
