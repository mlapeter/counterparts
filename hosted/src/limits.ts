/**
 * `/mcp`'S LIMITS, PER ACCOUNT (OL2b; the old INTERFACE-GAPS item on /mcp limits; the numbers: §11).
 *
 * Every store's calls run synchronous SQLite on one event loop, so one
 * account's flood slows every other account even with a queue per store (the
 * #643 review). Three limits, all LOOSE to start (Mike's guards-loose-first:
 * few guards, loose limits, tightened only after a real issue):
 *
 *   1. **Calls**: `tools/call` messages per account, 120 a minute and 1,500 an
 *      hour. A person chatting never meets either; a runaway loop does.
 *      `initialize`, `tools/list` and notifications are not counted.
 *   2. **In flight**: 8 POSTs per account at once. The ninth is a `429` with
 *      `Retry-After`: a transport answer, for a client that doesn't wait for
 *      its own answers.
 *   3. **Size**: 1 GiB per store (a store's own `stores.quota_bytes` wins when
 *      set). Over it, every tool that can add to the memory refuses; `recall`,
 *      `status`, `wake`, `scope` and reading the self page keep working.
 *
 * A refused CALL is answered the way a tool refuses (`isError: true`, a
 * `reason`, and words the model can pass on), not with an HTTP error, because
 * claude.ai shows the model a tool's answer and only a generic failure for a
 * transport error. Every refusal is told to `onLimit` (the call log's `reason`
 * carries it too), with no body and no id beyond what the caller passes.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { HttpMcpServer } from "../../src/adapters/remote/http.js";
import { success } from "../../src/adapters/mcp/protocol.js";
import type { Request, Response } from "../../src/adapters/mcp/protocol.js";
import { RateLimit } from "./web.js";

export const MCP_CALLS_PER_MINUTE = 120;
export const MCP_CALLS_PER_HOUR = 1500;
export const MCP_IN_FLIGHT = 8;
export const STORE_QUOTA_BYTES = 1024 * 1024 * 1024;
/** How long a measured size is trusted before the dir is walked again. */
export const SIZE_TTL_MS = 60_000;

/** Tools that add nothing to a memory: they keep working over the quota. `self_page` with no argument but `session`/`ifVersion` is a read and joins them. */
export const QUOTA_FREE_TOOLS: ReadonlySet<string> = new Set(["recall", "status", "wake", "scope"]);

/** The only `self_page` arguments a read carries. */
const SELF_PAGE_READ_ARGS: ReadonlySet<string> = new Set(["session", "ifVersion"]);

export type LimitReason = "rate-limited" | "store-full" | "in-flight";

export interface McpLimitsOptions {
  readonly perMinute?: number;
  readonly perHour?: number;
  readonly inFlight?: number;
  readonly quotaBytes?: number;
  /** The store's bytes on the volume (`dirBytes` of its tenant dir by default, cached for `SIZE_TTL_MS`). */
  readonly sizeOf: (storeId: string) => number;
  /** A store's own quota, when one was set (accounts' `stores.quota_bytes`). */
  readonly quotaOf?: (storeId: string) => number | null;
  readonly now?: () => number;
}

/** Every file's size under `dir`, recursively. A file that vanishes mid-walk counts 0. */
export function dirBytes(dir: string): number {
  let total = 0;
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return 0;
  }
  for (const n of names) {
    try {
      const st = statSync(join(dir, n));
      if (st.isFile()) total += st.size;
    } catch {
      /* gone */
    }
  }
  return total;
}

function refusal(id: Request["id"], payload: Record<string, unknown>): Response | null {
  if (id === undefined) return null; // a notification is answered with nothing, refused or not
  return success(id, {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  });
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)} GB` : `${String(Math.round(bytes / 1024 ** 2))} MB`;
}

export class McpLimits {
  readonly perMinute: number;
  readonly perHour: number;
  readonly inFlightMax: number;
  readonly quotaBytes: number;
  private readonly minute: RateLimit;
  private readonly hour: RateLimit;
  private readonly flying = new Map<string, number>();
  private readonly sizes = new Map<string, { bytes: number; at: number }>();
  private readonly opts: McpLimitsOptions;
  private readonly now: () => number;

  constructor(opts: McpLimitsOptions) {
    this.opts = opts;
    this.now = opts.now ?? ((): number => Date.now());
    this.perMinute = opts.perMinute ?? MCP_CALLS_PER_MINUTE;
    this.perHour = opts.perHour ?? MCP_CALLS_PER_HOUR;
    this.inFlightMax = opts.inFlight ?? MCP_IN_FLIGHT;
    this.quotaBytes = opts.quotaBytes ?? STORE_QUOTA_BYTES;
    this.minute = new RateLimit(this.perMinute, 60_000, this.now);
    this.hour = new RateLimit(this.perHour, 60 * 60_000, this.now);
  }

  /** One more POST in flight for this account, or false at the cap. Pair a true with `leave`. */
  enter(personId: string): boolean {
    const n = this.flying.get(personId) ?? 0;
    if (n >= this.inFlightMax) return false;
    this.flying.set(personId, n + 1);
    return true;
  }

  leave(personId: string): void {
    const n = (this.flying.get(personId) ?? 1) - 1;
    if (n <= 0) this.flying.delete(personId);
    else this.flying.set(personId, n);
  }

  private bytesOf(storeId: string): number {
    const t = this.now();
    const hit = this.sizes.get(storeId);
    if (hit !== undefined && t - hit.at < SIZE_TTL_MS) return hit.bytes;
    const bytes = this.opts.sizeOf(storeId);
    this.sizes.set(storeId, { bytes, at: t });
    if (this.sizes.size > 10_000) this.sizes.clear();
    return bytes;
  }

  /**
   * The refusal for one message, or null to let it through. Only `tools/call`
   * is ever refused. The call counts against the rate whether or not the size
   * then refuses it: a loop retrying a full store is still a loop.
   */
  check(personId: string, storeId: string, request: Request): { reason: LimitReason; response: Response | null } | null {
    if (request.method !== "tools/call") return null;
    const params = request.params ?? {};
    const name = typeof params["name"] === "string" ? params["name"] : "";
    // Both windows are charged together; a refusal by either costs the other nothing more.
    const inMinute = this.minute.take(personId);
    const inHour = inMinute && this.hour.take(personId);
    if (!inMinute || !inHour) {
      const retryAfterSeconds = inMinute ? 600 : 60;
      return {
        reason: "rate-limited",
        response: refusal(request.id, {
          stored: false,
          reason: "rate-limited",
          retryAfterSeconds,
          message: `This memory is taking a short pause: it had more than ${String(inMinute ? this.perHour : this.perMinute)} calls in the last ${inMinute ? "hour" : "minute"}, the hosted beta's limit. Nothing was lost. Try again in about ${inMinute ? "ten minutes" : "a minute"}.`,
        }),
      };
    }
    const args = params["arguments"];
    const a = args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
    // `self_page` is a read only with nothing but a session or a version check:
    // `body`, `short`, `summary` (the #653 review, L3) and anything new all write.
    const reads = QUOTA_FREE_TOOLS.has(name) || (name === "self_page" && Object.keys(a).every((k) => SELF_PAGE_READ_ARGS.has(k)));
    if (reads) return null;
    const quota = this.opts.quotaOf?.(storeId) ?? this.quotaBytes;
    if (this.bytesOf(storeId) < quota) return null;
    return {
      reason: "store-full",
      response: refusal(request.id, {
        stored: false,
        reason: "store-full",
        quotaBytes: quota,
        message: `This memory has reached the hosted beta's size limit (${mb(quota)}), so nothing new can be added to it right now. Everything already in it is still there, and recall still works. The person who invited you can raise the limit.`,
      }),
    };
  }

  /** `inner`, with `check` in front of every message. */
  wrap(inner: HttpMcpServer, personId: string, storeId: string, onLimit?: (reason: LimitReason) => void): HttpMcpServer {
    return {
      handle: async (request: Request): Promise<Response | null> => {
        const refused = this.check(personId, storeId, request);
        if (refused === null) return inner.handle(request);
        try {
          onLimit?.(refused.reason);
        } catch {
          /* a log, not a gate */
        }
        return refused.response;
      },
      get clientName() {
        return inner.clientName ?? null;
      },
      get clientVersion() {
        return inner.clientVersion ?? null;
      },
    };
  }
}
