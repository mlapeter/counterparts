/**
 * The local web dashboard's server — `node:http`, one page (and the static
 * modules it is built from), JSON under `/api`.
 *
 * CONTRACT OQ1 asked terminal or local web and the build answered "terminal, for
 * now" with a named revision condition: *the moment the owner wants to click.*
 * That moment arrived (owner ruling 2026-09-04, `NOTES.md`), and nothing in the
 * answer's reasoning is discarded here — the guarantees the terminal shape made
 * cheap to prove are the ones this file is built to keep provable:
 *
 *   - **`router()` is a pure function of an opened observer source.** It takes
 *     the source, returns a plain `{status, headers, body}`, and binds no
 *     socket. Every endpoint is therefore testable exactly the way a view
 *     function was — including "the data dir is byte-identical after every
 *     endpoint", which is the observer guarantee restated for a web adapter.
 *   - **One source, opened once, in observer mode by construction.**
 *     `Dashboard.open` sets `observer: true` itself and `sourceOf` refuses a
 *     Counterpart that is not one, so a request cannot reach a writable brain
 *     even by mistake. SQLite readers see committed writes, so a long-lived
 *     handle is fresh without reopening the store on every request.
 *   - **`node:http`, not `Bun.serve`.** The core targets Node and Bun both; a
 *     dashboard that only starts under one runtime would foreclose the other for
 *     no gain (owner ruling, same date).
 *
 * ## The two refusals
 *
 * **127.0.0.1 only.** The model of you stays on your machine.
 *
 * **A Host-header allowlist**, checked before any view is computed. Binding to
 * loopback stops remote connections; it does NOT stop a page in the owner's own
 * browser rebinding its origin to 127.0.0.1 and issuing same-origin fetches with
 * an attacker Host header (v1's audit finding #30, inherited as a scar rather
 * than as code). Only `localhost`, `127.0.0.1` and `[::1]`, with an optional
 * port, are accepted.
 *
 * ## The filesystem exception, named
 *
 * This is the ONE file in `adapters/dashboard/` that imports `node:fs`, and it
 * imports exactly `readFileSync`, to serve the static files that ship beside
 * it: the two HTML pages, and the page's own `.js`/`.css` modules under `web/`
 * — only the paths `static.ts` resolves (a fixed set of folders, an allow-listed
 * set of extensions, no traversal). The directory-wide ban exists to mechanize
 * "no memory body text is persisted into dashboard state" — there is no state
 * file because nothing here can open one — and a read-only import preserves
 * that exactly.
 * `test/dashboard.test.ts` encodes the exception per-file and asserts the
 * binding, so it cannot quietly widen into a write.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isStoreError, today as todayUtc } from "../../../core/store/index.js";
import { Dashboard } from "../index.js";
import type { DashboardSource } from "../source.js";
import { firedPanel } from "./fired.js";
import { resolveStatic } from "./static.js";
import {
  activityView,
  eventDetail,
  flowView,
  healthView,
  memoriesView,
  memoryDetail,
  metaView,
  mindView,
  nodeDetail,
  overviewView,
  pulse,
  searchView,
} from "./views.js";

/** bansai's 3737 is in use for the length of the parallel run. */
export const DEFAULT_PORT = 4747;
export const PORT_ENV = "COUNTERPARTS_DASHBOARD_PORT";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(HERE, "app.html");
const BRAIN_PATH = join(HERE, "brain.html");

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * A small mark: three dots on a rising diagonal, the middle one lit. Served from
 * memory, so there is no fourth file to lose — and served at all because a
 * missing favicon is a console error, and this dashboard's bar is zero of them.
 * Static branding rather than a data view, so it is the one response that may
 * cache.
 */
const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="13" fill="#0a0e14"/>` +
  `<path d="M14 46 L32 32 L50 18" stroke="#00e5ff" stroke-opacity=".35" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
  `<circle cx="14" cy="46" r="4.5" fill="#00bfa5"/>` +
  `<circle cx="32" cy="32" r="7" fill="#00e5ff"/>` +
  `<circle cx="50" cy="18" r="4.5" fill="#b388ff"/></svg>`;

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isAllowedHost(host: string | null | undefined): boolean {
  if (typeof host !== "string" || host.length === 0) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(:\d+)?$/.exec(host.trim());
  if (match === null) return false;
  const hostname = (match[1] ?? "").toLowerCase();
  return ALLOWED_HOSTNAMES.has(hostname);
}

export interface Reply {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** A binary static file (a font), sent instead of `body`. */
  readonly bytes?: Uint8Array;
}

function json(body: unknown, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
    body: JSON.stringify(body),
  };
}

function html(body: string): Reply {
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE }, body };
}

/** One of the two static pages. A missing file is a sentence, never a stack. */
function page(file: string): Reply {
  try {
    return html(readFileSync(file, "utf8"));
  } catch {
    return json(
      { error: `the dashboard page is missing from the install (${file}). Reinstall, or run from a checkout.` },
      500,
    );
  }
}

/**
 * One of the page's static modules, already resolved by `static.ts`. Read per
 * request and never cached, like the HTML: a checkout edited under a running
 * server shows the edit on reload. Anything unreadable is the ordinary 404.
 */
function staticFile(path: string): Reply | null {
  const found = resolveStatic(path, HERE);
  if (found === null) return null;
  const headers = { "content-type": found.contentType, ...NO_STORE };
  try {
    if (found.text) return { status: 200, headers, body: readFileSync(found.file, "utf8") };
    return { status: 200, headers, body: "", bytes: readFileSync(found.file) };
  } catch {
    return json({ error: `not found: ${path}` }, 404);
  }
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Resolve one request against an already-open observer source.
 *
 * Read-only by construction and by scan. Every throw becomes a 500 JSON body:
 * an instrument that crashes its own loop on a broken store is the one moment
 * the owner most needs it to render (scar E7).
 */
export function router(url: URL, host: string | null, src: DashboardSource): Reply {
  if (!isAllowedHost(host)) {
    return json(
      { error: "forbidden: this dashboard answers only to localhost, 127.0.0.1 or [::1]" },
      403,
    );
  }
  const path = url.pathname;
  try {
    if (path === "/" || path === "/index.html") return page(APP_PATH);
    if (path === "/brain") return page(BRAIN_PATH);
    if (path === "/favicon.svg" || path === "/favicon.ico") {
      return {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
        body: FAVICON_SVG,
      };
    }

    if (path === "/api/meta") return json(metaView(src));
    if (path === "/api/pulse") return json(pulse(src));
    if (path === "/api/overview") return json(overviewView(src, intParam(url, "limit", 40)));
    if (path === "/api/memories") return json(memoriesView(src, { limit: intParam(url, "limit", 4000) }));
    if (path === "/api/memory") {
      const id = url.searchParams.get("id") ?? "";
      if (id.length === 0) return json({ error: "id is required" }, 400);
      return json(memoryDetail(src, id));
    }
    if (path === "/api/search") {
      return json(searchView(src, url.searchParams.get("q") ?? "", intParam(url, "limit", 25)));
    }
    if (path === "/api/mind") return json(mindView(src));
    if (path === "/api/flow") return json(flowView(src, intParam(url, "limit", 24)));
    if (path === "/api/node") {
      const key = url.searchParams.get("key") ?? "";
      const detail = nodeDetail(src, key, intParam(url, "limit", 8));
      return detail.found ? json(detail) : json({ error: `no such node: ${key}` }, 404);
    }
    if (path === "/api/health") return json(healthView(src));
    if (path === "/api/fired") return json(firedPanel(src, todayUtc()));
    if (path === "/api/activity") {
      const sinceRaw = url.searchParams.get("sinceSeq");
      const opts: { limit: number; name?: string; sinceSeq?: number } = {
        limit: intParam(url, "limit", 40),
      };
      const name = url.searchParams.get("name");
      if (name !== null && name.length > 0) opts.name = name;
      if (sinceRaw !== null) opts.sinceSeq = intParam(url, "sinceSeq", 0);
      return json(activityView(src, opts));
    }
    if (path === "/api/event") {
      const seq = intParam(url, "seq", -1);
      if (seq < 0) return json({ error: "seq is required" }, 400);
      const detail = eventDetail(src, seq);
      return detail.found ? json(detail) : json({ error: "no event with that seq in the kept window" }, 404);
    }
    const asset = staticFile(path);
    if (asset !== null) return asset;
    return json({ error: `not found: ${path}` }, 404);
  } catch (err) {
    // A store refusal reaches the page as its code and its detail — ids and
    // counts, never prose, so both are safe to print (`bin/dashboard.ts` makes
    // the same argument for the terminal).
    if (isStoreError(err)) return json({ error: `${err.code}: ${JSON.stringify(err.detail)}` }, 500);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export interface ServeOptions {
  /** The data dir. Always passed explicitly by every caller in this repo. */
  readonly dir?: string;
  /** 0 asks the OS for a free port — what the visual loop uses. */
  readonly port?: number;
}

export interface RunningDashboard {
  readonly port: number;
  readonly url: string;
  readonly dir: string;
  readonly server: Server;
  stop(): Promise<void>;
}

function resolvePort(opts: ServeOptions): number {
  if (opts.port !== undefined) return opts.port;
  const fromEnv = Number.parseInt(process.env[PORT_ENV] ?? "", 10);
  return Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 65536 ? fromEnv : DEFAULT_PORT;
}

/**
 * Open the store in observer mode, bind loopback, serve. The returned handle
 * carries the BOUND port — which is not the requested one when the caller asked
 * for 0 — and closing it closes the store.
 */
export function startDashboard(opts: ServeOptions = {}): Promise<RunningDashboard> {
  const dashboard = Dashboard.open({ ...(opts.dir === undefined ? {} : { dir: opts.dir }) });
  const src = dashboard.source;
  const dir = dashboard.store.dir;

  const server = createServer((req, res) => {
    let reply: Reply;
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      reply = router(url, req.headers.host ?? null, src);
    } catch (err) {
      reply = {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
        body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      };
    }
    res.writeHead(reply.status, reply.headers);
    res.end(reply.bytes ?? reply.body);
  });

  return new Promise<RunningDashboard>((ok, fail) => {
    server.once("error", fail);
    server.listen(resolvePort(opts), "127.0.0.1", () => {
      server.removeListener("error", fail);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : resolvePort(opts);
      ok({
        port,
        url: `http://127.0.0.1:${port}`,
        dir,
        server,
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => {
              dashboard.close();
              done();
            });
            // Node keeps a server open while a keep-alive socket lives; the
            // dashboard is a local tool and a hung `stop()` in a test harness is
            // worse than a dropped connection.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
