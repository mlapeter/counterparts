/**
 * MCP OVER HTTP, FOR A CONNECTOR ON THE WEB (2026-10-26, the claude.ai trial).
 *
 * The Streamable HTTP transport, plain-JSON half only: a client POSTs one
 * JSON-RPC message (or a 2025-03-26 batch) and gets one `application/json`
 * answer; a POST carrying only notifications gets `202` and no body. No SSE
 * stream is offered — GET is `405`, as the spec asks of a server without one —
 * which is what lets a tunnel that does not stream (a cloudflared quick tunnel)
 * carry it. The memory is the same `McpServer` the stdio pump serves
 * (`mcp/stdio.ts`): this file is transport, and nothing in it is a memory rule.
 *
 * THE SURFACE, which is the whole review:
 *
 *   - **127.0.0.1 only.** `listen` is given the loopback address and nothing
 *     else; reaching it from outside the machine takes a tunnel somebody starts.
 *   - **One secret path.** The server answers only under `/<secret>`, a fresh
 *     192-bit random segment per run (`newSecret`), compared in constant time.
 *     Every other path, every method, `/.well-known/*` included, gets the same
 *     `404` with the same body, so nothing about the server is learnable
 *     without the secret. There is no sign-in: this is a trial door, and OAuth
 *     is the later pattern (the hosts plan).
 *   - **The secret is never logged.** It is in the URL the entry point prints
 *     once, and nowhere else: not in the call log, not in an error, not in an
 *     event.
 *   - **No Origin or Host check, and no CORS.** The tunnel forwards its own
 *     hostname, and claude.ai calls from Anthropic's cloud, so neither header
 *     is something this file can name in advance. DNS rebinding — the attack the
 *     spec's Origin rule is for — needs the page to know the path, and the path
 *     is a 192-bit secret no page has. THE SECRET IS THE WHOLE DEFENSE (review
 *     of #634): with no CORS headers a page cannot READ an answer, but the
 *     Content-Type is not checked, so a `text/plain` POST — a "simple" request,
 *     sent with no preflight — would still be served to a page that knew the
 *     path. Treat the URL as a password.
 *   - **Nothing about the host in an error.** A throw inside `handle` answers
 *     "internal error", never its message, which could carry a path on disk.
 *   - **Bounded.** A body over `maxBodyBytes` is `413`; a body that is not JSON
 *     is `400` with JSON-RPC's parse error; headers and requests time out.
 *   - **One call at a time.** `McpServer` keeps per-call state on the instance
 *     (its Desktop binding, the write guard), and stdio delivers one message at
 *     a time. HTTP does not — claude.ai may send two tool calls at once, from
 *     web and phone — so every message is handed to `handle` through one queue.
 *   - **Inbound only.** It opens no connection and resolves no host
 *     (`test/claude-code.test.ts` pins it).
 *
 * THE CALL LOG (`onCall`): one record per message — the time, the method, the
 * tool, the `Mcp-Session-Id` this server issued at `initialize` (a connection,
 * which is the nearest thing to a conversation the wire carries), the
 * Counterparts session the call named or `wake` minted (never the one a
 * nameless call fell back to), ok or the refusal's
 * reason code, and at `initialize` the client's own name and version. Ids and
 * codes only: never an argument, never a result's text.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { ERROR_CODES, failure, parseLine } from "../mcp/protocol.js";
import type { Id, Request, Response } from "../mcp/protocol.js";

/** The one address this server binds. */
export const LOOPBACK = "127.0.0.1";

/** A request body larger than this is refused (`413`). Tool arguments are small. */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * A JSON-RPC batch longer than this is refused (`400`) before any message
 * runs (security review of the OL2 stack, info). Batches were dropped from MCP
 * in 2025-06-18 and are kept for 2025-03-26 clients, which send a handful.
 */
export const MAX_BATCH = 32;

/** The secret path segment's entropy, in bytes (192 bits; the brief asks ≥128). */
export const SECRET_BYTES = 24;

/** A fresh secret path segment: base64url, so it is one URL-safe token. */
export function newSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/** What the transport needs of the server: `handle`, and who the client said it was. */
export interface HttpMcpServer {
  handle(request: Request): Promise<Response | null>;
  readonly clientName?: string | null;
  readonly clientVersion?: string | null;
}

/** One record per JSON-RPC message, for the call log. Ids and codes only. */
export interface CallRecord {
  /** ISO instant. */
  readonly at: string;
  readonly method: string;
  /** `tools/call`'s tool, when it is tool-shaped. */
  readonly tool?: string;
  /** The `Mcp-Session-Id` the request carried (or, at `initialize`, the one issued). */
  readonly connection: string | null;
  /** The Counterparts session the call named, or the one `wake` minted. */
  readonly session?: string;
  /** True for a result that is not `isError`; false for a refusal or a protocol error. */
  readonly ok: boolean;
  /** The refusal's reason, or the JSON-RPC error code, when not ok. */
  readonly reason?: string;
  readonly ms: number;
  /** At `initialize`: what the client said it was. */
  readonly client?: string | null;
  readonly clientVersion?: string | null;
  readonly protocolVersion?: string;
}

/**
 * The options every door shares: what happens to ONE POST once it has been
 * routed to an MCP endpoint (2026-10-26, OL2 step 1). The local door
 * (`serveHttp`) and the hosted server (`hosted/`) both hand a request here
 * after their own gate — the secret path here, a bearer token there.
 */
export interface McpPostOptions {
  readonly maxBodyBytes?: number;
  /** Messages in one batch; `MAX_BATCH` when absent. */
  readonly maxBatch?: number;
  /** Told once per message, after its answer is known. A throw is swallowed. */
  readonly onCall?: (record: CallRecord) => void;
  /** Told the status of each request refused before it reached the server
   *  (413, 400). A throw is swallowed. */
  readonly onRefused?: (status: number) => void;
  readonly now?: () => number;
  /**
   * Asked once the whole body has arrived, before any message reaches the
   * server: a refusal is answered with its status and headers instead. The
   * hosted door uses it for a store locked while a slow body was in flight.
   * Absent ⇒ never refused here.
   */
  readonly gate?: () => Refusal | null;
  /**
   * Asked when a message's call throws: a refusal answers the WHOLE request
   * with its status and headers, instead of the message's JSON-RPC "internal
   * error", while no message of it has run. In a batch where one already ran,
   * the answers made are kept: that message and each one refused after it
   * carries its own `REFUSED_ERROR` (with the status in `data`), and HTTP stays
   * 200, so a client never sends again a write that was made. The hosted door
   * uses it for a store locked, or a token revoked, while the message waited its
   * turn. Absent, or null for this error ⇒ "internal error".
   */
  readonly refusal?: (err: unknown) => Refusal | null;
}

/** What a door's `gate` or `refusal` answers instead: an HTTP status and its headers. */
export interface Refusal {
  readonly status: number;
  readonly headers?: Record<string, string>;
}

/**
 * The JSON-RPC error a message refused inside a batch carries, once another
 * message of the batch has run (`McpPostOptions.refusal`): implementation-defined
 * (-32000 to -32099), and never "internal error". `data.status` is the HTTP
 * status the whole request would have had; `data.retryAfter` its Retry-After.
 */
export const REFUSED_ERROR = -32001;

/** Carries a `refusal` out of one message (and that message's id) to the request's answer. */
class Refused extends Error {
  readonly refusal: Refusal;
  readonly id: Id | undefined;
  constructor(refusal: Refusal, id: Id | undefined) {
    super("refused");
    this.refusal = refusal;
    this.id = id;
  }
}

export interface ServeHttpOptions extends McpPostOptions {
  readonly server: HttpMcpServer;
  /** The secret path segment; a fresh one when absent. At least 22 characters. */
  readonly secret?: string;
  /** The port on 127.0.0.1; 0 (the default) lets the system choose. */
  readonly port?: number;
  /** Told the status of each request refused before it reached the server
   *  (404, 405, 413, 400). Never told the path. A throw is swallowed. */
  readonly onRefused?: (status: number) => void;
}

export interface RunningHttp {
  /** The bound address, always `127.0.0.1`. */
  readonly address: string;
  readonly port: number;
  /** `http://127.0.0.1:<port>/<secret>` — the one string that carries the secret. */
  readonly url: string;
  close(): Promise<void>;
}

/** Runs `fn` after every earlier `fn` handed to the same queue has settled. */
export type Serial = <T>(fn: () => Promise<T>) => Promise<T>;

/** Where one routed POST goes: a server, and the queue in front of it. */
export interface McpTarget {
  readonly server: HttpMcpServer;
  /** ONE MESSAGE AT A TIME per server (the header). The hosted server keeps
   *  one queue per store; the local door has one store and one queue. */
  readonly serial: Serial;
}

/**
 * A fresh queue: every function handed to it waits for the last to settle,
 * whether it resolved or threw.
 */
export function serialQueue(): Serial {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

const NOT_FOUND = "Not found\n";

/** A short id-or-code string, or undefined: what the call log may hold. */
function code(value: unknown, max = 64): string | undefined {
  // Ids, codes and method names (`tools/call`): letters, digits and . _ : / -.
  return typeof value === "string" && /^[A-Za-z0-9._:/-]+$/.test(value) && value.length <= max ? value : undefined;
}

/** The client's self-description, printable and bounded; anything else is dropped. */
function printable(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[^\x20-\x7e]/g, "").slice(0, max);
  return clean.length === 0 ? null : clean;
}

function tell(fn: () => void): void {
  try {
    fn();
  } catch {
    /* a listener's trouble is never the client's answer */
  }
}

function plain(res: ServerResponse, status: number, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(status === 404 ? NOT_FOUND : `${status}\n`);
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** One message through the server, and its call-log record. */
async function one(raw: unknown, connection: string | null, target: McpTarget, opts: McpPostOptions, now: () => number, ran: { any: boolean }): Promise<Response | null> {
  const started = now();
  const parsed = parseLine(JSON.stringify(raw));
  if (!parsed.ok) {
    const response = failure(parsed.id, parsed.code, parsed.message);
    tell(() => opts.onCall?.({ at: new Date(started).toISOString(), method: "invalid", connection, ok: false, reason: String(parsed.code), ms: now() - started }));
    return response;
  }
  const request = parsed.request;
  let response: Response | null;
  try {
    response = await target.serial(() => target.server.handle(request));
    ran.any = true;
  } catch (err) {
    const refused = opts.refusal?.(err) ?? null;
    if (refused !== null) {
      tell(() => opts.onCall?.({ at: new Date(started).toISOString(), method: code(request.method, 64) ?? "other", connection, ok: false, reason: String(refused.status), ms: now() - started }));
      throw new Refused(refused, request.id);
    }
    ran.any = true; // it reached the server, and may have written before it threw
    // The message stays on this machine: it could name a path on disk.
    response = request.id === undefined ? null : failure(request.id, ERROR_CODES.INTERNAL_ERROR, "internal error");
  }
  const params = request.params ?? {};
  const isInit = request.method === "initialize";
  const record: Record<string, unknown> = {
    at: new Date(started).toISOString(),
    method: code(request.method, 64) ?? "other",
    connection,
    ms: now() - started,
  };
  if (request.method === "tools/call") {
    record["tool"] = code(params["name"], 32) ?? "other";
    const args = params["arguments"];
    const named = args !== null && typeof args === "object" ? code((args as Record<string, unknown>)["session"]) : undefined;
    if (named !== undefined) record["session"] = named;
  }
  if (response === null) {
    record["ok"] = true;
  } else if ("error" in response) {
    record["ok"] = false;
    record["reason"] = String(response.error.code);
  } else {
    const result = response.result;
    const structured = result["structuredContent"];
    const sc = structured !== null && typeof structured === "object" ? (structured as Record<string, unknown>) : {};
    record["ok"] = result["isError"] !== true;
    if (result["isError"] === true) record["reason"] = code(sc["reason"]) ?? "error";
    // `wake` mints the session; it is the one call that names none going in.
    // ONLY `wake` (review of #641): `chapter`, `reflect` and `dream` echo the
    // session a nameless call was filed under (the most recent one, remote
    // INTERFACE-GAPS §2), which may be another chat's; logging that as the
    // call's session would hide a chat that never woke inside another's row.
    if (record["session"] === undefined && record["tool"] === "wake") {
      const minted = code(sc["session"]);
      if (minted !== undefined) record["session"] = minted;
    }
  }
  if (isInit) {
    record["client"] = printable(target.server.clientName, 128);
    record["clientVersion"] = printable(target.server.clientVersion, 64);
    const asked = code(params["protocolVersion"], 32);
    if (asked !== undefined) record["protocolVersion"] = asked;
  }
  tell(() => opts.onCall?.(record as unknown as CallRecord));
  return response;
}

/**
 * Serve ONE POST that a door has already routed to an MCP endpoint and let
 * through its gate: read the body (bounded), frame it as JSON-RPC (one message
 * or a batch), hand each message to `target.server` through `target.serial`,
 * and answer plain JSON — or `202` with no body for notifications alone.
 *
 * The method is not checked here: the door answers anything but POST itself
 * (`405` with `Allow: POST`). Nothing about the gate is known here either, so
 * nothing about it can leak from here.
 */
export function handleMcpPost(req: IncomingMessage, res: ServerResponse, target: McpTarget, opts: McpPostOptions = {}): void {
  const maxBody = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const now = opts.now ?? ((): number => Date.now());
  const refuse = (status: number, extra: Record<string, string> = {}): void => {
    tell(() => opts.onRefused?.(status));
    plain(res, status, extra);
  };
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  req.on("data", (chunk: Buffer) => {
    if (over) return;
    size += chunk.length;
    if (size > maxBody) {
      over = true;
      refuse(413, { Connection: "close" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => {
    if (!res.headersSent) refuse(400);
  });
  req.on("end", () => {
    if (over) return;
    const shut = opts.gate?.() ?? null;
    if (shut !== null) {
      refuse(shut.status, shut.headers ?? {});
      return;
    }
    void (async (): Promise<void> => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        tell(() => opts.onRefused?.(400));
        json(res, 400, failure(null, ERROR_CODES.PARSE_ERROR, "invalid JSON"));
        return;
      }
      const header = req.headers["mcp-session-id"];
      const carried = code(Array.isArray(header) ? header[0] : header);
      const batch = Array.isArray(body);
      const messages = batch ? (body as unknown[]) : [body];
      if (messages.length === 0) {
        json(res, 400, failure(null, ERROR_CODES.INVALID_REQUEST, "empty batch"));
        return;
      }
      if (messages.length > (opts.maxBatch ?? MAX_BATCH)) {
        tell(() => opts.onRefused?.(400));
        json(res, 400, failure(null, ERROR_CODES.INVALID_REQUEST, "batch too large"));
        return;
      }
      // A connection id is issued at `initialize` and logged on every later
      // message that carries it; one that carries none is still served.
      const initializing = messages.some((m) => m !== null && typeof m === "object" && (m as Record<string, unknown>)["method"] === "initialize");
      const connection = initializing ? randomUUID() : (carried ?? null);
      const responses: Response[] = [];
      // Whether any message reached the server. Until one has, a refusal
      // answers the whole request (the client signs in again and sends it all).
      // After, the answers made are kept and each refused message carries its
      // own error: a whole-request 401 there would hide a write that was made,
      // and a client sending the batch again would make it twice.
      const ran = { any: false };
      try {
        for (const message of messages) {
          let response: Response | null;
          try {
            response = await one(message, connection, target, opts, now, ran);
          } catch (err) {
            if (!(err instanceof Refused) || !ran.any) throw err;
            const retryAfter = err.refusal.headers?.["Retry-After"];
            response = err.id === undefined ? null : failure(err.id, REFUSED_ERROR, `refused (HTTP ${String(err.refusal.status)}): this message did not run`, { status: err.refusal.status, ...(retryAfter === undefined ? {} : { retryAfter }) });
          }
          if (response !== null) responses.push(response);
        }
      } catch (err) {
        if (!(err instanceof Refused) || res.headersSent) throw err;
        refuse(err.refusal.status, err.refusal.headers ?? {});
        return;
      }
      const headers: Record<string, string> = initializing && connection !== null ? { "Mcp-Session-Id": connection } : {};
      if (responses.length === 0) {
        res.writeHead(202, { "Cache-Control": "no-store", ...headers });
        res.end();
        return;
      }
      json(res, 200, batch ? responses : responses[0], headers);
    })().catch(() => {
      if (!res.headersSent) refuse(500);
    });
  });
}

/**
 * Serve `server` on 127.0.0.1 under `/<secret>`. Resolves once listening.
 */
export async function serveHttp(opts: ServeHttpOptions): Promise<RunningHttp> {
  const secret = opts.secret ?? newSecret();
  if (!/^[A-Za-z0-9_-]{22,}$/.test(secret)) throw new Error("the secret path segment must be at least 22 URL-safe characters");
  const expected = Buffer.from(`/${secret}`, "utf8");
  // ONE MESSAGE AT A TIME (the header): every `handle` waits for the last.
  const target: McpTarget = { server: opts.server, serial: serialQueue() };

  const pathOk = (rawUrl: string | undefined): boolean => {
    let pathname: string;
    try {
      pathname = new URL(rawUrl ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return false;
    }
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    const got = Buffer.from(pathname, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const refuse = (res: ServerResponse, status: number, extra: Record<string, string> = {}): void => {
    tell(() => opts.onRefused?.(status));
    plain(res, status, extra);
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!pathOk(req.url)) {
      req.resume();
      refuse(res, 404);
      return;
    }
    if (req.method !== "POST") {
      req.resume();
      refuse(res, 405, { Allow: "POST" });
      return;
    }
    handleMcpPost(req, res, target, opts);
  };

  const server: Server = createServer(onRequest);
  server.headersTimeout = 30_000;
  server.requestTimeout = 300_000;
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(opts.port ?? 0, LOOPBACK, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const bound = server.address();
  if (bound === null || typeof bound === "string" || bound.address !== LOOPBACK) {
    server.close();
    throw new Error("the HTTP server did not bind 127.0.0.1");
  }
  return {
    address: bound.address,
    port: bound.port,
    url: `http://127.0.0.1:${String(bound.port)}/${secret}`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections?.();
      }),
  };
}
