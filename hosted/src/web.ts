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
  // `/dashboard/` (HD2): the page a signed-out visitor to the dashboard was sent from.
  if (!(path === "/account" || path === "/dashboard/" || path.startsWith("/oauth/"))) return "/account";
  return path + u.search;
}

/**
 * THE ONE STYLESHEET (gate S, 2026-11-06): counterparts.ai's look, inline under
 * the nonce. Light is the site's light face (the guides' and /check-your-email's
 * cream, ink and teal trace, features/guides/styles/guide.css); dark, when the
 * browser asks for it, is the home's (features/home-v2/styles/home-v2.css: the
 * navy-black ground and the cyan). The site sets its faces per route and has no
 * `prefers-color-scheme`; the pages follow the browser instead.
 * System fonts stand in for the site's web fonts (Newsreader / Fraunces /
 * JetBrains Mono), since the CSP loads nothing. No url(), no @import: with
 * `default-src 'none'` neither could load anyway.
 * Buttons take their weight from the markup they already have: Allow and the
 * sign-in button are primary, the delete buttons are red, the rest are quiet
 * (pinned against the real pages in test/delete.test.ts). --field, the input
 * and button border, holds 3:1 against what it sits on (WCAG 1.4.11); --line,
 * the card and divider lines, is decoration and stays faint.
 */
export const PAGE_STYLE = [
  ":root{color-scheme:light dark;--bg:#faf8f3;--panel:#fffefa;--soft:#f3f0e8;--line:#e3dfd3;--field:#8a8373;--ink:#1a1915;--ink-2:#5f5b51;--accent:#16708c;--accent-ink:#ffffff;--accent-glow:none;--danger:#a3301e;--mark-glow:none;--ground:#faf8f3;--head:#1a1915;",
  "--serif:\"Iowan Old Style\",\"Palatino Linotype\",Palatino,Georgia,serif;--mono:ui-monospace,\"SF Mono\",Menlo,Consolas,\"Liberation Mono\",monospace;--sans:ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}",
  "@media (prefers-color-scheme:dark){:root{--bg:#04070c;--panel:#0a0f17;--soft:#070b11;--line:rgba(0,229,255,.14);--field:#2f7d8a;--ink:#c5cdd8;--ink-2:#8a95a3;--accent:#00e5ff;--accent-ink:#03121a;--accent-glow:0 0 24px rgba(0,229,255,.3);--danger:#ff7a6e;--mark-glow:0 0 20px rgba(0,229,255,.4),0 0 45px rgba(0,229,255,.12);--ground:radial-gradient(1200px 800px at 70% 0%,#0a1220 0%,#04070c 62%) #04070c;--head:#e8eef5}}",
  "*,*::before,*::after{box-sizing:border-box}",
  "html{background:var(--bg);-webkit-text-size-adjust:100%}",
  "body{margin:0;min-height:100vh;background:var(--ground);color:var(--ink);font:17px/1.6 var(--serif);-webkit-font-smoothing:antialiased;overflow-wrap:break-word}",
  ".cp-top{display:flex;align-items:center;padding:14px clamp(16px,4vw,40px);border-bottom:1px solid var(--line)}",
  ".cp-mark{font:700 14px/1 var(--sans);letter-spacing:.32em;text-transform:uppercase;color:var(--accent);text-shadow:var(--mark-glow)}",
  ".cp-main{width:min(34rem,100% - 32px);margin:clamp(24px,6vw,56px) auto;padding:clamp(20px,5vw,32px);background:var(--panel);border:1px solid var(--line);border-radius:8px}",
  "h1,h2{font-family:var(--serif);font-weight:600;line-height:1.2;letter-spacing:-.015em;color:var(--head);text-wrap:balance}",
  "h1{font-size:clamp(1.55rem,5vw,1.95rem);margin:0 0 1rem}",
  "h2{font-size:1.15rem;margin:1.75rem 0 .6rem;padding-top:1.5rem;border-top:1px solid var(--line)}",
  "p{margin:0 0 1rem;text-wrap:pretty}",
  "strong{font-weight:600}",
  "a{color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}",
  "a:hover{text-decoration-thickness:2px}",
  ".muted{color:var(--ink-2);font-size:.92em}",
  "code{font:.82em var(--mono);background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:.08em .35em;overflow-wrap:anywhere}",
  "ul{list-style:none;margin:0 0 1rem;padding:0}",
  "li{padding:.5rem 0}li+li{border-top:1px solid var(--line);padding-top:.75rem}li form{margin:.5rem 0 0}",
  "button+p{margin-top:.6rem}",
  "form{margin:0 0 1rem}form>br,label>br{display:none}",
  "label{display:block;margin:0 0 1rem;font:500 13px/1.4 var(--mono);color:var(--ink-2)}",
  "label .muted{font-size:1em}",
  "details{margin:0 0 1rem}summary{cursor:pointer;font:500 13px/1.4 var(--mono);color:var(--ink-2)}details label{margin:.6rem 0 0}",
  "input[type=email],input[type=text]{display:block;width:100%;min-height:44px;margin-top:.4rem;padding:0 14px;font:15px var(--mono);color:var(--ink);background:var(--soft);border:1px solid var(--field);border-radius:4px}",
  "input[type=email]:hover,input[type=text]:hover{border-color:var(--accent)}",
  "input[type=email]:focus,input[type=text]:focus{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:1px}",
  "button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:.25rem .5rem .25rem 0;padding:0 18px;font:600 13px/1.2 var(--mono);color:var(--ink);background:transparent;border:1px solid var(--field);border-radius:4px;cursor:pointer;text-align:center}",
  "button:hover{border-color:var(--accent);color:var(--accent)}",
  "button:active{transform:scale(.98)}",
  "button[value=allow],form[action=\"/login\"] button,form[action=\"/account/keep\"] button{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);box-shadow:var(--accent-glow)}",
  "button[value=allow]:hover,form[action=\"/login\"] button:hover,form[action=\"/account/keep\"] button:hover{color:var(--accent-ink);filter:brightness(1.08)}",
  "form[action=\"/account/delete\"] button{color:var(--danger);border-color:var(--danger)}",
  "form[action=\"/account/delete\"] button:hover{color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent)}",
  ":focus-visible{outline:2px solid var(--accent);outline-offset:3px}",
  "button:focus-visible{outline-offset:2px}",
  "@media (prefers-reduced-motion:reduce){button:active{transform:none}}",
].join("");

/**
 * THE WARM LOOK (LP1, Mike 2026-11-10): the sign-in pages (/login, check your
 * email, the emailed link's landing and error pages) in counterparts.ai/claude-ai/'s
 * look (counterparts-site features/claude-ai/claude-ai.css): the desk and the
 * device card, light and dark by the browser, the orange link and key, rounded
 * corners, one sans face. Opt-in (`page({ warm: true })`) and appended after
 * PAGE_STYLE, under a class on <body>: it only re-points PAGE_STYLE's tokens
 * and reshapes, so the selectors that give buttons their weight stay PAGE_STYLE's
 * (test/delete.test.ts), and every other page keeps #762's look. System faces
 * stand in for the site's Inter Tight / JetBrains Mono (its own fallback is
 * system-ui), since the CSP loads nothing. --field holds 3:1 against the
 * fields, as in PAGE_STYLE. `.cp-fox` sizes the fox's canvas (fox.ts).
 */
export const WARM_STYLE = [
  ".cp-warm{--bg:#e9e6df;--ground:#e9e6df;--panel:#f7f5f0;--soft:#ffffff;--line:#d6d2c8;--field:#8c8579;--ink:#1a1a1a;--ink-2:#57534e;--head:#1a1a1a;--accent:#b8410e;--accent-ink:#ffffff;--accent-glow:none;--mark-glow:none;--focus:#ff6b1a;--shadow:0 1px 0 #fff inset,0 18px 40px rgba(60,50,30,.12);--serif:var(--sans);font-size:16px;line-height:1.5}",
  "@media (prefers-color-scheme:dark){.cp-warm{--bg:#121212;--ground:#121212;--panel:#1f1f1e;--soft:#161615;--line:#33322f;--field:#6e6960;--ink:#eeebe4;--ink-2:#a8a29e;--head:#eeebe4;--accent:#ff6b1a;--accent-ink:#121212;--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px rgba(0,0,0,.5)}}",
  "html:has(.cp-warm){background:#e9e6df}@media (prefers-color-scheme:dark){html:has(.cp-warm){background:#121212}}",
  ".cp-warm .cp-top{border-bottom:0;padding-top:20px}",
  ".cp-warm .cp-mark{letter-spacing:.28em}",
  ".cp-warm .cp-main{width:min(30rem,100% - 32px);margin:clamp(8px,4vw,40px) auto 48px;padding:28px;border-radius:28px;box-shadow:var(--shadow)}",
  "@media (max-width:480px){.cp-warm .cp-main{padding:20px;border-radius:22px}}",
  ".cp-warm h1{font-size:clamp(1.6rem,6vw,1.9rem);font-weight:700;letter-spacing:-.01em;line-height:1.15;margin:0 0 .75rem}",
  ".cp-warm .muted{font-size:.9em}",
  ".cp-warm label,.cp-warm summary{font:600 14px/1.4 var(--sans);color:var(--ink)}",
  ".cp-warm label .muted{font-weight:400;color:var(--ink-2)}",
  ".cp-warm summary{font-weight:500;color:var(--ink-2)}",
  ".cp-warm input[type=email],.cp-warm input[type=text]{min-height:46px;font:16px var(--sans);border-radius:12px}",
  ".cp-warm button{min-height:46px;padding:0 20px;font:600 15px/1.2 var(--sans);border-radius:12px}",
  ".cp-warm form[action=\"/login\"] button{width:100%;margin:.5rem 0 0}",
  ".cp-warm :focus-visible,.cp-warm input:focus{outline:3px solid var(--focus);outline-offset:2px}",
  ".cp-warm .cp-hero{text-align:center;margin:0 0 1.25rem}",
  ".cp-warm .cp-hero h1{margin:0 0 .4rem}",
  ".cp-warm .cp-hero p{margin:0}",
  ".cp-warm .cp-hero .cp-eyebrow{font:500 13px/1.4 var(--mono);color:var(--ink-2);margin:0 0 .35rem}",
  ".cp-fox{display:block;width:152px;height:162px;margin:-4px auto 14px;image-rendering:pixelated;image-rendering:crisp-edges;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}",
].join("");

/** The page frame. `nonce` gates the one inline style and any inline script; `warm` is the sign-in pages' look (WARM_STYLE). */
export function page(res: ServerResponse, status: number, opts: { title: string; body: string; nonce?: string; headers?: Record<string, string | string[]>; formAction?: string; warm?: boolean }): void {
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
<style nonce="${nonce}">${PAGE_STYLE}${opts.warm === true ? WARM_STYLE : ""}</style>
</head><body${opts.warm === true ? ' class="cp-warm"' : ""}>
<header class="cp-top"><span class="cp-mark">Counterparts</span></header>
<main class="cp-main">
${opts.body}
</main>
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
