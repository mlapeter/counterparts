/**
 * THE SMALL WEB TOOLKIT THE PAGES SHARE (OL2 step 3): cookies, forms, CSRF,
 * HTML escaping, the page frame and its headers, client IPs, rate limits.
 * No framework, no dependency.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_FORM_BYTES = 8 * 1024;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function parseCookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  const raw = req.headers["cookie"];
  if (typeof raw !== "string") return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k.length > 0 && !out.has(k)) out.set(k, v);
  }
  return out;
}

export interface CookieNames {
  readonly browser: string;
  readonly session: string;
  readonly secure: boolean;
}

/** `__Host-` names (Secure, Path=/, no Domain) on https; plain names for local http. */
export function cookieNames(publicOrigin: string): CookieNames {
  const secure = publicOrigin.startsWith("https://");
  return secure ? { browser: "__Host-cp_browser", session: "__Host-cp_session", secure } : { browser: "cp_browser", session: "cp_session", secure };
}

export function cookie(name: string, value: string, opts: { secure: boolean; maxAgeS: number }): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(opts.maxAgeS)}${opts.secure ? "; Secure" : ""}`;
}

/** Read an urlencoded form body, bounded. Null when too large or not a form. */
export async function readForm(req: IncomingMessage, max = MAX_FORM_BYTES): Promise<URLSearchParams | null> {
  const type = req.headers["content-type"];
  if (typeof type !== "string" || !/^application\/x-www-form-urlencoded\s*(;|$)/i.test(type)) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * CSRF: a token bound to this browser's cookie under a server key.
 *
 * THE KEY OUTLIVES A RESTART (H1, 2026-10-29): `app.ts` passes `keys.ts#csrfKey`
 * of the current cookie key (COOKIE_KEYS' first), so a deploy no longer expires
 * every open form, and it rotates when the cookie keys do. With no key
 * (COOKIE_KEYS unset) it is random per process, as before: forms expire on restart.
 */
export class Csrf {
  private readonly key: Buffer;
  constructor(key?: Buffer) {
    this.key = key ?? randomBytes(32);
  }
  token(browser: string): string {
    return createHmac("sha256", this.key).update(`csrf:${browser}`).digest("base64url");
  }
  check(browser: string | undefined, presented: string | null): boolean {
    if (browser === undefined || presented === null) return false;
    const want = Buffer.from(this.token(browser));
    const got = Buffer.from(presented);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}

/** A POST from a page of ours: the Origin, when the browser sends one, is ours. */
export function sameOrigin(req: IncomingMessage, publicOrigin: string): boolean {
  const o = req.headers["origin"];
  return o === undefined || o === publicOrigin;
}

/**
 * A local path to return to after login: one of ours, never another host.
 * `//evil.example`, `/\evil`, schemes and anything outside the allowed prefixes
 * fall back to `/account`. The allow-list is checked on the path AFTER the URL
 * parser has resolved dot-segments and dropped tabs and newlines, because that
 * resolved path is what goes out in `Location`: `/oauth/..//evil.example`
 * resolves to `//evil.example`, another host (review of #644).
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return "/account";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/account";
  let u: URL;
  try {
    u = new URL(raw, "https://x.invalid");
  } catch {
    return "/account";
  }
  if (u.origin !== "https://x.invalid") return "/account";
  const path = u.pathname;
  if (path.startsWith("//") || path.includes("\\")) return "/account";
  if (!(path === "/account" || path.startsWith("/oauth/"))) return "/account";
  return path + u.search;
}

/** The page frame. `nonce` gates the one inline style and any inline script. */
export function page(res: ServerResponse, status: number, opts: { title: string; body: string; nonce?: string; headers?: Record<string, string | string[]>; formAction?: string }): void {
  const nonce = opts.nonce ?? randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `form-action ${opts.formAction ?? "'self'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // same-origin, not no-referrer: under no-referrer a browser sends `Origin: null` on our own
    // form POSTs, and sameOrigin() refuses every one (the first deploy, 2026-10-29). Other sites
    // still get no referrer.
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": csp,
    ...(opts.headers ?? {}),
  });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} · Counterparts</title>
<style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}input,button{font:inherit;padding:.5rem .7rem;margin:.25rem 0}input[type=email],input[type=text]{width:100%;box-sizing:border-box}button{cursor:pointer}.muted{color:#666}li{margin:.4rem 0}</style>
</head><body>
${opts.body}
</body></html>
`);
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store", ...headers });
  res.end();
}

/**
 * The client's address. Behind `hops` proxies we trust, the X-Forwarded-For
 * entry `hops` from the end: each trusted proxy appends the address it saw, so
 * the entry the outermost one appended is the client. Anything before it is
 * whatever the client sent, and trusting it let anyone name a fresh "address"
 * per request and walk past every per-IP limit (review of #644). Railway's
 * first deploy (2026-10-29) showed two entries for a direct request: the
 * client, then an edge hop (TRUST_PROXY=2). Too few entries for the hops means
 * the header didn't come through the proxies we expect: the socket address,
 * not a guess. With hops 0 the header is never read.
 */
export function clientIp(req: IncomingMessage, hops: number): string {
  if (hops >= 1) {
    const xff = req.headers["x-forwarded-for"];
    const joined = Array.isArray(xff) ? xff.join(",") : xff;
    const parts = joined?.split(",") ?? [];
    const pick = parts.length >= hops ? parts[parts.length - hops]?.trim() : undefined;
    if (pick !== undefined && pick.length > 0 && pick.length < 64) return pick;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** A fixed-window-ish rate limit in memory: at most `max` hits per `windowMs` per key. One instance only. */
export class RateLimit {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(max: number, windowMs: number, now: () => number = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }
  take(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((h) => h > t - this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.sweep(t);
    return true;
  }
  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (!v.some((h) => h > t - this.windowMs)) this.hits.delete(k);
  }
}
