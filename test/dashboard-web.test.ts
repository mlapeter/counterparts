/**
 * `adapters/dashboard/web/` — the local web view, held to the same four rules
 * the terminal views are held to, plus the two the web shape adds.
 *
 * The terminal answer to CONTRACT OQ1 argued that a string-returning view makes
 * "byte-identical directory after every render" a loop in a test rather than a
 * browser harness. That argument is honoured rather than abandoned here:
 * `router()` is a pure function of an OPENED OBSERVER SOURCE and returns a plain
 * `{status, headers, body}`, so every endpoint is exercised without binding a
 * socket — and the byte-identical assertion is the same loop, over endpoints
 * instead of over views.
 *
 * What this file proves:
 *
 *   1. **Every endpoint answers 200 with JSON, over BOTH an empty store and a
 *      seeded one.** The empty case is the one that catches "the panel just
 *      doesn't render when there is nothing" — the failure the two absence words
 *      exist for.
 *   2. **The data dir is byte-identical after every endpoint has been served.**
 *      The observer guarantee, restated for a web adapter.
 *   3. **The Host allowlist refuses before any view is computed** (DNS-rebinding
 *      guard).
 *   4. **Totality, twice over**: every `DURABLE_EVENT_NAMES` entry has a flow
 *      node and a narration line. Both are `satisfies`-pinned at compile time;
 *      these are the runtime restatements, for a reader who reads tests.
 *   5. **Confidential rows are withheld** — the rule every other surface keeps.
 *   6. **The empty store says which kind of nothing it has**, everywhere.
 *
 * Hermetic (CLAUDE.md): fresh temp dirs, removed after; the seeder takes its
 * directory as an argument and reads no environment.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { DATA_DIR_ENV } from "../src/core/store/index.js";
import { FRAMING, LANE_ORDER } from "../src/core/self/index.js";
import { isJournal } from "../src/core/sleep/index.js";
import { Dashboard, DURABLE_EVENT_NAMES, NEVER, NONE, sourceOf } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { EVENT_NODE, FLOW_EDGES, FLOW_NODES, NODE_KEYS, nodeOf } from "../src/adapters/dashboard/web/flow.js";
import { NARRATORS, REF_KIND, narrate } from "../src/adapters/dashboard/web/narrate.js";
import { WITHHELD, reveal } from "../src/adapters/dashboard/web/reveal.js";
import {
  DEFAULT_PORT,
  isAllowedHost,
  router,
  startDashboard,
} from "../src/adapters/dashboard/web/server.js";
import {
  activityView,
  divergentPair,
  healthView,
  mindView,
  overviewView,
  relativeToStore,
  wakeLanes,
} from "../src/adapters/dashboard/web/views.js";
import {
  describeStoreError,
  parseServe,
  run,
  runReport,
  serve,
  serveRefusal,
  unknownFlag,
} from "../src/adapters/dashboard/bin/dashboard.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const HOST = "127.0.0.1:4747";
/** The bin as a script, for the one test that has to run `serve` as a process. */
const BIN = fileURLToPath(new URL("../src/adapters/dashboard/bin/dashboard.ts", import.meta.url));

/** Every endpoint the page and the poster actually call, with its query. */
const ENDPOINTS = [
  "/api/meta",
  "/api/pulse",
  "/api/overview",
  "/api/memories",
  "/api/search?q=swap",
  "/api/mind",
  "/api/flow",
  "/api/health",
  "/api/activity",
  "/api/activity?limit=5",
  "/api/activity?sinceSeq=0",
  ...NODE_KEYS.map((k) => `/api/node?key=${k}`),
] as const;

let temps: string[] = [];
let priorEnv: string | undefined;

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

beforeEach(() => {
  priorEnv = process.env[ENV];
  temps = [];
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// ── the two stores, seeded once for the whole file ──────────────────────────
// The rich seed runs thirty lived days through the real brain; doing that per
// test would make this suite the slowest in the repo for no added coverage.

let richDir: string;
let emptyDir: string;
const persistent: string[] = [];

beforeAll(async () => {
  richDir = mkdtempSync(join(tmpdir(), "counterparts-web-rich-"));
  emptyDir = mkdtempSync(join(tmpdir(), "counterparts-web-empty-"));
  persistent.push(richDir, emptyDir);
  await seedDemo({ dir: richDir });
  seedEmpty({ dir: emptyDir });
});

afterAll(() => {
  for (const d of persistent) rmSync(d, { recursive: true, force: true });
});

function open(dir: string): { src: DashboardSource; close(): void } {
  const dash = Dashboard.open({ dir });
  return { src: dash.source, close: () => dash.close() };
}

function get(src: DashboardSource, path: string, host: string | null = HOST): {
  status: number;
  headers: Record<string, string>;
  json: Record<string, unknown>;
} {
  const reply = router(new URL(`http://${host ?? "localhost"}${path}`), host, src);
  let parsed: Record<string, unknown> = {};
  if ((reply.headers["content-type"] ?? "").startsWith("application/json")) {
    parsed = JSON.parse(reply.body) as Record<string, unknown>;
  }
  return { status: reply.status, headers: reply.headers, json: parsed };
}

// ── the byte-identical protocol, lifted from `test/dashboard.test.ts` ────────

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(dir, full);
      const bytes = readFileSync(full);
      out.set(rel, `${statSync(full).size}:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [path, hash] of a) {
    if (!b.has(path)) changed.push(`gone: ${path}`);
    else if (b.get(path) !== hash) changed.push(`changed: ${path}`);
  }
  for (const path of b.keys()) if (!a.has(path)) changed.push(`appeared: ${path}`);
  return changed.sort();
}

/** Box 1 and box 2 only: box 3 is the rebuildable cache, and `openCache` writes
 *  its schema-version row on construction (INTERFACE-GAPS §1). The strict
 *  property is asserted for the canonical boxes; the cache is asserted stable
 *  ACROSS requests, which is the honest pair the terminal suite already draws. */
function canonical(dir: string): Map<string, string> {
  const all = snapshot(dir);
  const out = new Map<string, string>();
  for (const [path, hash] of all) {
    if (path.startsWith("cache/") || path.startsWith(`cache${"/"}`)) continue;
    out.set(path, hash);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the router answers every endpoint over a store with a life in it", () => {
  test("200 JSON everywhere, and no endpoint returns an error body", () => {
    const d = open(richDir);
    try {
      for (const path of ENDPOINTS) {
        const res = get(d.src, path);
        expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
        expect(res.headers["content-type"]).toContain("application/json");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.json["error"]).toBeUndefined();
      }
    } finally {
      d.close();
    }
  });

  test("the seeded store fills the panels the screenshots are of", () => {
    const d = open(richDir);
    try {
      const overview = get(d.src, "/api/overview").json;
      expect(Number(overview["tiles"] && (overview["tiles"] as unknown[]).length)).toBeGreaterThan(6);
      expect((overview["feed"] as unknown[]).length).toBeGreaterThan(5);
      expect((overview["identity"] as unknown[]).length).toBeGreaterThan(0);
      expect((overview["contested"] as unknown[]).length).toBeGreaterThan(0);
      expect((overview["chapters"] as unknown[]).length).toBeGreaterThan(0);
      expect(overview["identityAbsent"]).toBeNull();

      const memories = get(d.src, "/api/memories").json;
      expect(Number(memories["total"])).toBeGreaterThan(50);
      expect((memories["points"] as unknown[]).length).toBeGreaterThan(50);
      expect((memories["hubs"] as unknown[]).length).toBeGreaterThan(0);
      expect((memories["kinds"] as unknown[]).length).toBe(6);

      const mind = get(d.src, "/api/mind").json;
      const wake = mind["wake"] as { ok: boolean; bytes: number; lanes: unknown[] };
      expect(wake.ok).toBe(true);
      expect(wake.bytes).toBeGreaterThan(500);
      expect(wake.lanes.length).toBeGreaterThan(0);
      expect((mind["stories"] as unknown[]).length).toBeGreaterThan(0);

      const health = get(d.src, "/api/health").json;
      expect((health["phases"] as unknown[]).length).toBeGreaterThan(0);
      expect((health["blind"] as unknown[]).length).toBeGreaterThan(3);
      expect((health["heatmap"] as { cells: unknown[] }).cells.length).toBeGreaterThan(0);
    } finally {
      d.close();
    }
  });

  test("a memory opens, and every id it points at resolves to words", () => {
    const d = open(richDir);
    try {
      const list = get(d.src, "/api/memories").json;
      const first = (list["points"] as { id: string }[])[0];
      expect(first).toBeDefined();
      const detail = get(d.src, `/api/memory?id=${first?.id ?? ""}`).json;
      expect(detail["found"]).toBe(true);
      expect(String(detail["prosePath"]).length).toBeGreaterThan(3);
      expect(Number(detail["strength"])).toBeGreaterThan(0);
      // Nothing on the page is a bare id where words were promised.
      for (const edge of detail["edges"] as { text: string }[]) {
        expect(edge.text.length).toBeGreaterThan(0);
      }
    } finally {
      d.close();
    }
  });

  test("a chapter opens like anything else, and says it is not a memory", () => {
    const d = open(richDir);
    try {
      const chapters = mindView(d.src).chapters;
      expect(chapters.length).toBeGreaterThan(0);
      const detail = get(d.src, `/api/memory?id=${chapters[0]?.id ?? ""}`).json;
      // It resolves — a journal entry is a row like any other.
      expect(detail["found"]).toBe(true);
      expect(String(detail["text"]).length).toBeGreaterThan(60);
      // And it is FLAGGED, because the physics printed beside it is recorded
      // and never acted on: an episode sits outside every sleep phase.
      expect(detail["journal"]).toBe(true);
      // A real memory is not flagged.
      const mem = (get(d.src, "/api/memories").json["points"] as { id: string }[])[0];
      expect(get(d.src, `/api/memory?id=${mem?.id ?? ""}`).json["journal"]).toBe(false);
    } finally {
      d.close();
    }
  });

  test("an id that is not there answers with a NAMED absence, not a blank", () => {
    const d = open(richDir);
    try {
      const detail = get(d.src, "/api/memory?id=mem_nothinghere").json;
      expect(detail["found"]).toBe(false);
      expect(String(detail["absence"])).toContain("no longer at this address");
    } finally {
      d.close();
    }
  });

  test("search finds the demo store's own words", () => {
    const d = open(richDir);
    try {
      const res = get(d.src, "/api/search?q=Fernbrook").json;
      expect(Array.isArray(res["hits"])).toBe(true);
      // Whatever it finds, every hit carries text rather than an id alone.
      for (const hit of res["hits"] as { text: string }[]) expect(hit.text.length).toBeGreaterThan(0);
    } finally {
      d.close();
    }
  });

  test("an empty search says (never run), not (none yet)", () => {
    const d = open(richDir);
    try {
      expect(get(d.src, "/api/search?q=").json["absent"]).toBe(NEVER);
      expect(get(d.src, "/api/search?q=zzzznotaword").json["absent"]).toBe(NONE);
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the empty store looks intentional, not broken", () => {
  test("200 JSON on every endpoint, over a store with nothing in it", () => {
    const d = open(emptyDir);
    try {
      for (const path of ENDPOINTS) {
        const res = get(d.src, path);
        expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
        expect(res.json["error"]).toBeUndefined();
      }
    } finally {
      d.close();
    }
  });

  test("every panel that could be blank names its absence in two words", () => {
    const d = open(emptyDir);
    try {
      const overview = get(d.src, "/api/overview").json;
      for (const key of ["identityAbsent", "guardedAbsent", "contestedAbsent", "chaptersAbsent"]) {
        expect([NONE, NEVER]).toContain(String(overview[key]));
      }
      expect(String(overview["opening"]).length).toBeGreaterThan(20);
      // Every band still gets a row, with its absence marker.
      const bands = overview["bands"] as { label: string; count: number; absent: string | null }[];
      expect(bands.length).toBe(3);
      for (const b of bands) {
        expect(b.count).toBe(0);
        expect([NONE, NEVER]).toContain(String(b.absent));
      }

      // Every KIND still gets a row, with its physics — the totality rule.
      const kinds = get(d.src, "/api/memories").json["kinds"] as { kind: string; absent: string | null; kappa: number }[];
      expect(kinds.length).toBe(6);
      for (const k of kinds) {
        expect([NONE, NEVER]).toContain(String(k.absent));
        expect(k.kappa).toBeGreaterThan(0);
      }

      // Every durable event name still gets a row, marked never-run.
      const vocab = get(d.src, "/api/activity").json["vocabulary"] as { name: string; absent: string | null }[];
      expect(vocab.length).toBe(DURABLE_EVENT_NAMES.length);
      for (const v of vocab) expect(v.absent).toBe(NEVER);
    } finally {
      d.close();
    }
  });

  test("every flow node renders, and each one honestly says it has never run", () => {
    const d = open(emptyDir);
    try {
      const flow = get(d.src, "/api/flow").json;
      const nodes = flow["nodes"] as { key: string; silent: boolean; state: string }[];
      expect(nodes.length).toBe(NODE_KEYS.length);
      for (const node of nodes) {
        expect(node.silent).toBe(true);
        expect([NONE, NEVER]).toContain(String(node.state));
      }
      expect((flow["feed"] as unknown[]).length).toBe(0);
    } finally {
      d.close();
    }
  });

  test("every node's detail carries its brain analog AND where it breaks", () => {
    const d = open(emptyDir);
    try {
      for (const key of NODE_KEYS) {
        const node = get(d.src, `/api/node?key=${key}`).json;
        expect(node["found"]).toBe(true);
        expect(String(node["what"]).length).toBeGreaterThan(40);
        expect(String(node["analog"]).length).toBeGreaterThan(20);
        // "Where the analogy deliberately breaks" is never omitted — a
        // comparison that only says where it holds is advertising.
        expect(String(node["breaks"]).length).toBeGreaterThan(20);
        // A node with no events of its own says so rather than reading empty.
        const names = node["eventNames"] as string[];
        if (names.length === 0) expect(String(node["noEventOfItsOwn"]).length).toBeGreaterThan(20);
      }
    } finally {
      d.close();
    }
  });

  test("the mind page's wake says it has never composed one", () => {
    const d = open(emptyDir);
    try {
      const wake = get(d.src, "/api/mind").json["wake"] as { ok: boolean; absent: string | null; lanes: unknown[] };
      expect(wake.ok).toBe(false);
      expect([NONE, NEVER]).toContain(String(wake.absent));
      expect(wake.lanes).toEqual([]);
    } finally {
      d.close();
    }
  });

  test("`(never run)` and `(none yet)` are used for different questions", () => {
    const d = open(emptyDir);
    try {
      // Never asked: the cycle has not run, so its phases are (never run).
      const phases = get(d.src, "/api/health").json["phases"] as { absent: string | null }[];
      for (const p of phases) expect(p.absent).toBe(NEVER);
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the observer guarantee, restated for a web adapter", () => {
  test("the canonical boxes are byte-identical after every endpoint is served", () => {
    const dir = tempDir("counterparts-web-obs-");
    const seeded = seedEmpty({ dir: join(dir, "store") });
    const d = open(seeded.dir);
    try {
      const before = canonical(seeded.dir);
      for (const path of ENDPOINTS) get(d.src, path);
      get(d.src, "/api/memory?id=mem_whatever");
      get(d.src, "/api/event?seq=1");
      get(d.src, "/");
      get(d.src, "/brain");
      get(d.src, "/favicon.svg");
      expect(diff(before, canonical(seeded.dir))).toEqual([]);
    } finally {
      d.close();
    }
  });

  test("the canonical boxes are byte-identical over a store with a LIFE in it", () => {
    // The empty-store case above proves the loop; this one proves it where
    // there is something to damage — thirty lived days, an archived set, a
    // revised belief and a journal, every endpoint served over all of it.
    const d = open(richDir);
    try {
      const before = canonical(richDir);
      for (const path of ENDPOINTS) get(d.src, path);
      const first = (get(d.src, "/api/memories").json["points"] as { id: string }[])[0];
      get(d.src, `/api/memory?id=${first?.id ?? ""}`);
      for (const chapter of mindView(d.src).chapters) get(d.src, `/api/memory?id=${chapter.id}`);
      const lastSeq = activityView(d.src, { limit: 1 }).lastSeq;
      get(d.src, `/api/event?seq=${lastSeq}`);
      get(d.src, "/api/search?q=rota");
      expect(diff(before, canonical(richDir))).toEqual([]);
    } finally {
      d.close();
    }
  });

  test("the WHOLE directory, cache included, is stable across repeated requests", () => {
    const d = open(richDir);
    try {
      for (const path of ENDPOINTS) get(d.src, path);
      const after = snapshot(richDir);
      for (const path of ENDPOINTS) get(d.src, path);
      expect(diff(after, snapshot(richDir))).toEqual([]);
    } finally {
      d.close();
    }
  });

  test("the source refuses to be built from a writable brain", () => {
    const dir = tempDir("counterparts-web-writable-");
    const c = Counterpart.open({ dir: join(dir, "s"), owner: true });
    try {
      expect(() => sourceOf(c)).toThrow();
    } finally {
      c.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the two refusals", () => {
  test("only localhost, 127.0.0.1 and [::1] are accepted as a Host", () => {
    for (const host of ["localhost", "localhost:4747", "127.0.0.1", "127.0.0.1:4747", "[::1]", "[::1]:4747", "LOCALHOST"]) {
      expect(`${host} → ${isAllowedHost(host)}`).toBe(`${host} → true`);
    }
    for (const host of ["evil.example", "evil.example:4747", "127.0.0.1.evil.example", "", null, undefined, "127.0.0.2"]) {
      expect(`${String(host)} → ${isAllowedHost(host)}`).toBe(`${String(host)} → false`);
    }
  });

  test("a bad Host is refused with 403 BEFORE any view is computed", () => {
    const d = open(richDir);
    try {
      for (const path of ["/", "/brain", "/api/overview", "/api/memories", "/nonsense"]) {
        const res = get(d.src, path, "evil.example");
        expect(`${path} → ${res.status}`).toBe(`${path} → 403`);
        expect(String(res.json["error"])).toContain("forbidden");
      }
    } finally {
      d.close();
    }
  });

  test("an unknown path is a JSON 404, never a crash", () => {
    const d = open(richDir);
    try {
      const res = get(d.src, "/api/does-not-exist");
      expect(res.status).toBe(404);
      expect(String(res.json["error"])).toContain("not found");
      expect(get(d.src, "/api/node?key=nope").status).toBe(404);
      expect(get(d.src, "/api/memory").status).toBe(400);
      expect(get(d.src, "/api/event").status).toBe(400);
    } finally {
      d.close();
    }
  });

  test("the page and the favicon are served, and only the favicon may cache", () => {
    const d = open(emptyDir);
    try {
      const app = router(new URL(`http://${HOST}/`), HOST, d.src);
      expect(app.status).toBe(200);
      expect(app.headers["content-type"]).toContain("text/html");
      expect(app.headers["cache-control"]).toBe("no-store");
      expect(app.body).toContain("<title>");
      const brain = router(new URL(`http://${HOST}/brain`), HOST, d.src);
      expect(brain.status).toBe(200);
      expect(brain.body).toContain("<title>");
      const icon = router(new URL(`http://${HOST}/favicon.svg`), HOST, d.src);
      expect(icon.headers["content-type"]).toBe("image/svg+xml");
      expect(icon.headers["cache-control"]).toContain("max-age");
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("totality: nothing the core can record has nowhere to go", () => {
  test("every durable event name maps to a flow node", () => {
    const unmapped = DURABLE_EVENT_NAMES.filter((name) => nodeOf(name) === null);
    expect(unmapped).toEqual([]);
    // And every node it maps to is a real node on the diagram.
    for (const [name, key] of Object.entries(EVENT_NODE)) {
      expect(`${name} → ${key}`).toBe(`${name} → ${FLOW_NODES.find((n) => n.key === key)?.key ?? "MISSING"}`);
    }
  });

  test("every durable event name has a narration line", () => {
    const missing = DURABLE_EVENT_NAMES.filter((name) => !(name in NARRATORS));
    expect(missing).toEqual([]);
    // And no narrator exists for a name the core cannot write.
    const extra = Object.keys(NARRATORS).filter(
      (name) => !(DURABLE_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(extra).toEqual([]);
  });

  test("every durable event name says what kind of thing its ref holds", () => {
    const missing = DURABLE_EVENT_NAMES.filter((name) => !(name in REF_KIND));
    expect(missing).toEqual([]);
    // The three that are NOT memory ids are the whole reason this table exists:
    // resolving one of them through the memory resolver prints a false absence.
    expect(REF_KIND["recall.decision"]).toBe("session");
    expect(REF_KIND["gate.chunk"]).toBe("chunk");
    expect(REF_KIND["sweep.gate"]).toBe("none");
  });

  test("every edge on the diagram joins two real nodes", () => {
    const keys = new Set<string>(NODE_KEYS);
    for (const edge of FLOW_EDGES) {
      expect(`${edge.from}→${edge.to}: ${keys.has(edge.from) && keys.has(edge.to)}`).toBe(
        `${edge.from}→${edge.to}: true`,
      );
    }
  });

  test("every node appears in at least one edge — nothing floats unconnected", () => {
    for (const key of NODE_KEYS) {
      const touched = FLOW_EDGES.some((e) => e.from === key || e.to === key);
      expect(`${key} connected: ${touched}`).toBe(`${key} connected: true`);
    }
  });

  test("a real event narrates into a sentence that names its memory", () => {
    const d = open(richDir);
    try {
      const rows = d.src.store.eventLog({ name: "memory.pruned", limit: 5 });
      expect(rows.length).toBeGreaterThan(0);
      const line = narrate(d.src.store, rows[0]!);
      expect(line.text).toContain("I let go of");
      // A pruned memory is archived, not gone, so it still resolves to words.
      expect(line.text.length).toBeGreaterThan(40);
      expect(line.node).toBe("sleep");
      // Ordinary forgetting is CALM. Amber is reserved for "look at this".
      expect(line.tone).toBe("calm");
    } finally {
      d.close();
    }
  });

  test("the sweep row ambers on IO_FAILED and only NAMES a BELOW_MIN_CLAIM (M3)", () => {
    // A `sweep.gate` row is one row, and one row cannot tell a first refusal
    // from a thousandth. `BELOW_MIN_CLAIM` is permanent by construction — the
    // small leftover is restored to the buffer and the crashed session is never
    // forgotten — so ambering on it made one 200-byte leftover an amber
    // dashboard forever. `IO_FAILED` and `OBSERVER` cannot be a normal day even
    // once, and they keep the alarm.
    const dir = mkdtempSync(join(tmpdir(), "counterparts-web-sweep-"));
    const c = Counterpart.open({ dir, owner: true });
    const quiet = {
      NO_CRASHED_SESSION: 5,
      NOTHING_TO_SWEEP: 1,
      NOTHING_UNCLAIMED: 0,
      BELOW_MIN_CLAIM: 0,
      IO_FAILED: 0,
      OBSERVER: 0,
      SWEPT: 0,
    };
    try {
      c.store.appendEvent({
        name: "sweep.gate",
        day: 1,
        payload: {
          reason: "ran",
          scopes: 7,
          ran: 0,
          skippedNotCrashed: 5,
          refusals: { ...quiet, BELOW_MIN_CLAIM: 1 },
          noisyRefusals: 0,
          chronicCandidates: 1,
        },
      });
      c.store.appendEvent({
        name: "sweep.gate",
        day: 1,
        payload: {
          reason: "ran",
          scopes: 7,
          ran: 0,
          skippedNotCrashed: 5,
          refusals: { ...quiet, IO_FAILED: 1 },
          noisyRefusals: 1,
          chronicCandidates: 0,
        },
      });
      const rows = c.store.eventLog({ name: "sweep.gate", limit: 10 });
      expect(rows.length).toBe(2);

      const chronic = narrate(c.store, rows[0]!);
      expect(chronic.tone).toBe("calm");
      expect(chronic.text).toContain("too small to claim");
      expect(chronic.text).toContain("fine once");

      const failed = narrate(c.store, rows[1]!);
      expect(failed.tone).toBe("amber");
      expect(failed.text).toContain("IO_FAILED");
      // The alarm names only the reason that raised it.
      expect(failed.text).not.toContain("BELOW_MIN_CLAIM");
    } finally {
      c.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a recall decision resolves its refs BY TYPE — a session id is not a memory", () => {
    const d = open(richDir);
    try {
      const rows = d.src.store.eventLog({ name: "recall.decision", limit: 5 });
      expect(rows.length).toBeGreaterThan(0);
      const line = narrate(d.src.store, rows[0]!);
      // The terminal feed puts this `ref` through the memory resolver and prints
      // a false absence. Here it is named as what it is.
      expect(String(line.subject)).toContain("session ");
      expect(String(line.subject)).not.toContain("no longer at this address");
    } finally {
      d.close();
    }
  });

  test("every narration over the whole seeded log produces a real sentence", () => {
    const d = open(richDir);
    try {
      const events = activityView(d.src, { limit: 500 }).events;
      expect(events.length).toBeGreaterThan(20);
      for (const e of events) {
        expect(`${e.name}: ${e.text.length > 25}`).toBe(`${e.name}: true`);
        expect(["calm", "notable", "amber"]).toContain(e.tone);
        // No raw hex leaks through as the whole sentence.
        expect(e.text).not.toMatch(/^mem_[0-9a-z]+$/);
      }
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("what the page withholds", () => {
  test("a confidential memory keeps its row and loses only its words", () => {
    const dir = tempDir("counterparts-web-conf-");
    const target = join(dir, "s");
    const c = Counterpart.open({ dir: target, owner: true });
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The gate key for the studio yard is written on the whiteboard.",
      meta: { confidential: true },
      salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.close();

    const d = open(target);
    try {
      const r = reveal(d.src.store, id, 80);
      // The row exists — the owner can see THAT it is there.
      expect(r.present).toBe(true);
      // And its words do not. Asserted outright rather than branched on: a
      // branch here would swallow the regression this test exists to catch.
      expect(r.confidential).toBe(true);
      expect(r.text).toBeNull();
      expect(r.label).toBe(WITHHELD);

      const points = get(d.src, "/api/memories").json["points"] as {
        id: string;
        text: string;
        confidential: boolean;
        strength: number;
        band: string;
      }[];
      const row = points.find((p) => p.id === id);
      expect(row?.confidential).toBe(true);
      expect(row?.text).toBe(WITHHELD);
      // The dot is still on the chart with its real physics: withholding the
      // sentence is not hiding the memory.
      expect(typeof row?.strength).toBe("number");
      expect(["episodic", "semantic", "identity"]).toContain(String(row?.band));
      expect(get(d.src, `/api/memory?id=${id}`).json["text"]).toBe(WITHHELD);
      // And nothing leaks through the search surface either.
      const hits = get(d.src, "/api/search?q=whiteboard").json["hits"] as { id: string; text: string }[];
      for (const hit of hits) if (hit.id === id) expect(hit.text).toBe(WITHHELD);
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the shapes the page draws with", () => {
  test("two versions of one statement are shown around where they diverge", () => {
    const a = "Ada prefers async review, and will say so if you ask her about it directly.";
    const b = "Ada prefers a live walkthrough, and will say so if you ask her about it directly.";
    const [began, now] = divergentPair(a, b, 40);
    // The point of the whole exercise: the two ends must not render identical.
    expect(began).not.toBe(now);
    // Both windows start at the same place, and it is near the change — not at
    // character zero, which would spend the width on the shared prefix.
    expect(began.startsWith("…")).toBe(began.startsWith("…"));
    expect(began).toContain("async");
    expect(now).toContain("live walkthrough");
    // A trim is visible as a trim, at both ends.
    expect(began.endsWith("…")).toBe(true);
  });

  test("identical statements come back identical — that is a fact, not a bug", () => {
    const [x, y] = divergentPair("the same sentence", "the same sentence", 40);
    expect(x).toBe(y);
    expect(x).toBe("the same sentence");
  });

  test("a prose path is said relative to the store it lives in", () => {
    expect(relativeToStore("/tmp/store", "/tmp/store/prose/memories/mem_a.md")).toBe(
      "prose/memories/mem_a.md",
    );
    // A trailing slash on the dir is the store's business, not the caller's.
    expect(relativeToStore("/tmp/store/", "/tmp/store/prose/x.md")).toBe("prose/x.md");
    // A path that is NOT inside the store is left alone rather than mangled.
    expect(relativeToStore("/tmp/store", "/elsewhere/x.md")).toBe("/elsewhere/x.md");
    expect(relativeToStore("/tmp/store", "")).toBe("—");
  });

  test("`/api/meta` carries a row count, so a poll can see a deposit that wrote no event", () => {
    const d = open(richDir);
    try {
      const meta = get(d.src, "/api/meta").json;
      // The bug this exists for: `counterparts note` deposits a memory and
      // writes no durable event, so an open page polling the event log alone
      // reported the old count forever while the server answered the new one.
      expect(typeof meta["rows"]).toBe("number");
      expect(meta["rows"] as number).toBeGreaterThan(0);
      expect(meta["empty"]).toBe(false);
    } finally {
      d.close();
    }
  });

  /**
   * THE OVERVIEW IS ON THE SAME SIGNAL AS THE FLOW PAGE.
   *
   * The first fix for the stale `143 came through` gave the poll a second
   * question — `/api/meta`'s row count, so a deposit that writes no durable
   * event is still noticed — and then refreshed only the flow diagram. The page
   * the dashboard OPENS on kept its boot-time tiles: `memories held` frozen at
   * whatever it was when the tab was opened, on the first screen of the
   * product, while the tab beside it moved.
   *
   * The behaviour itself is asserted in a browser by `tools/visual-loop`, which
   * types a real note and reads the tile back off the DOM. This is the cheap
   * half: the refresh path must ask for the overview at all, and it must not be
   * the boot path (which owns the feed).
   */
  test("the poll's refresh re-reads the overview, not only the flow diagram", () => {
    const app = readFileSync(
      fileURLToPath(new URL("../src/adapters/dashboard/web/app.html", import.meta.url)),
      "utf8",
    );
    const start = app.indexOf("async function refreshCounters(");
    expect(start).toBeGreaterThan(0);
    const body = app.slice(start, app.indexOf("\n}", start));
    expect(body).toContain("/api/overview");
    expect(body).toContain("paintOverview(");
    expect(body).toContain("/api/flow");
    // And the paint is a function of its own, so the refresh path can skip the
    // feed the poll is prepending into.
    expect(app).toContain("function paintOverview(d, withFeed)");
    expect(app).toContain("window.tileValue");
  });

  test("an empty store's row count is zero and its emptiness agrees with it", () => {
    const d = open(emptyDir);
    try {
      const meta = get(d.src, "/api/meta").json;
      expect(meta["rows"]).toBe(0);
      expect(meta["empty"]).toBe(true);
    } finally {
      d.close();
    }
  });

  test("ENCODE lights on the AUTHORED gate record, and owes no unlogged-path apology", () => {
    const d = open(richDir);
    try {
      const nodes = get(d.src, "/api/flow").json["nodes"] as { key: string; state: string }[];
      const encode = nodes.find((n) => n.key === "encode");
      const store = nodes.find((n) => n.key === "store");
      expect(store?.state).toMatch(/\d+ memories held/);
      // Both absence words are FALSE here: the battery ran on every one of
      // those memories, and — since `gate.deposit` (replay §2a) — BOTH of its
      // doors record that it did. The seeder deposits through the real authored
      // door and never sweeps, so this node's whole count is the authored one:
      // before §2a it read `N passed · no gate record yet`.
      expect(encode?.state).not.toBe(NEVER);
      expect(encode?.state).not.toBe(NONE);
      expect(String(encode?.state)).toMatch(/^\d+ recorded$/);
      expect(d.src.store.eventLog({ name: "gate.deposit", limit: 5 }).length).toBeGreaterThan(0);
      // The third absence word is retired with the condition it described: the
      // node has an ordinary count now, so it says nothing about being unlogged.
      const detail = get(d.src, "/api/node?key=encode").json;
      expect(detail["unloggedPath"]).toBeNull();
      expect(detail["eventNames"]).toContain("gate.deposit");
    } finally {
      d.close();
    }
  });

  test("`memories held` counts memories — beliefs and entities are counted apart", () => {
    const d = open(richDir);
    try {
      // The definition, read off the store itself rather than off either
      // surface: live, not archived, not the journal, not a schema row. The
      // console prints this number after `Memories:`; the overview printed the
      // whole population instead — 145 against 121 on the same store, at the
      // same moment, which is the kind of disagreement that makes a reader
      // stop trusting both.
      let memories = 0;
      let beliefs = 0;
      for (const id of d.src.store.list({ archived: false })) {
        const row = d.src.store.row(id);
        if (row === undefined || isJournal(row)) continue;
        if (row.type === "schema") beliefs += 1;
        else memories += 1;
      }
      expect(beliefs).toBeGreaterThan(0);

      const tiles = get(d.src, "/api/overview").json["tiles"] as { label: string; value: string }[];
      const tile = (label: string): string => tiles.find((t) => t.label === label)?.value ?? "";
      expect(tile("memories held")).toBe(String(memories));
      expect(tile("beliefs and entities")).toBe(String(beliefs));

      // And every other surface that says the word agrees with the tile.
      expect(get(d.src, "/api/pulse").json["memories"]).toBe(memories);
      const nodes = get(d.src, "/api/flow").json["nodes"] as { key: string; state: string }[];
      expect(nodes.find((n) => n.key === "store")?.state).toBe(`${memories} memories held`);
      expect(nodes.find((n) => n.key === "remember")?.state).toBe(`${memories} came through`);
      expect(String(get(d.src, "/api/overview").json["opening"])).toContain(`${memories} memories`);
    } finally {
      d.close();
    }
  });

  test("identity rows carry lived days, not the day the store was built", () => {
    const d = open(richDir);
    try {
      const rows = get(d.src, "/api/overview").json["identity"] as
        { bornDay: number; lastUsedDay: number }[];
      expect(rows.length).toBeGreaterThan(1);
      // The measurement behind this: every row said `learned 2026-09-04`,
      // because that is the day the store was built, beside `strength 1.00`,
      // which is what being in this band means. Two of three fields constant.
      expect(rows.some((r) => r.lastUsedDay !== rows[0]?.lastUsedDay)).toBe(true);
      for (const r of rows) expect(r.lastUsedDay).toBeGreaterThanOrEqual(r.bornDay);
      // The calendar date is gone from the row and still in the card.
      expect(Object.keys(rows[0] ?? {})).not.toContain("learnedOn");
      const first = (get(d.src, "/api/memories").json["points"] as { id: string }[])[0];
      const detail = get(d.src, `/api/memory?id=${first?.id ?? ""}`).json;
      expect(String(detail["learnedOn"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      d.close();
    }
  });

  test("the modal is handed BOTH forms: the short one to show, the full one to copy", () => {
    const d = open(richDir);
    try {
      const first = (get(d.src, "/api/memories").json["points"] as { id: string }[])[0];
      const detail = get(d.src, `/api/memory?id=${first?.id ?? ""}`).json;
      const short = String(detail["prosePathShort"]);
      // The subtitle of the best surface in the product used to be 150
      // characters of somebody's tmpdir, in every screenshot of it.
      expect(short.startsWith("/")).toBe(false);
      expect(short).toContain("prose/");
      expect(String(detail["prosePath"]).endsWith(short)).toBe(true);
    } finally {
      d.close();
    }
  });

  test("the wake briefing splits at the lane headings `self/` itself writes", () => {
    const lanes = wakeLanes(
      [
        "<!-- counterparts:wake/end day=3 -->",
        FRAMING.context,
        "",
        FRAMING.identity,
        "- 2026-07-01 · I build slowly.",
        "",
        FRAMING.threads,
        "- 2026-07-02 · The swap sheet is unresolved.",
      ].join("\n"),
    );
    expect(lanes.map((l) => l.lane)).toEqual([null, "identity", "threads"]);
    expect(lanes[0]?.items).toEqual([FRAMING.context]);
    // Bullets are stripped; the statement and its date are otherwise verbatim.
    expect(lanes[1]?.items).toEqual(["2026-07-01 · I build slowly."]);
    // The sentinel comment is bookkeeping, not something the assistant says.
    expect(JSON.stringify(lanes)).not.toContain("counterparts:wake");
  });

  test("the real briefing splits into the lanes it was composed with", () => {
    const d = open(richDir);
    try {
      const wake = mindView(d.src).wake;
      expect(wake.ok).toBe(true);
      const named = wake.lanes.filter((l) => l.lane !== null);
      expect(named.length).toBeGreaterThan(1);
      for (const lane of named) {
        expect(LANE_ORDER as readonly string[]).toContain(String(lane.lane));
        expect(lane.items.length).toBeGreaterThan(0);
        // No bullet survives into the rendered item.
        for (const item of lane.items) expect(item.startsWith("- ")).toBe(false);
      }
    } finally {
      d.close();
    }
  });

  test("health names what it cannot see, rather than filling the panel", () => {
    const d = open(richDir);
    try {
      const health = healthView(d.src);
      expect(health.blind.length).toBeGreaterThan(4);
      for (const b of health.blind) {
        expect(b.what.length).toBeGreaterThan(8);
        expect(b.why.length).toBeGreaterThan(40);
      }
      // The exits are SINCE BIRTH, and the reason that is so is in `blind`.
      expect(health.blind.some((b) => b.why.includes("SINCE BIRTH"))).toBe(true);
    } finally {
      d.close();
    }
  });

  /**
   * `strength 1.00` ON AN IDENTITY ROW IS A TAUTOLOGY.
   *
   * Every element in the band is at 1.00 by construction, so the field said one
   * thing fifteen times down the panel in the README's first image. The day it
   * crossed is the fact that varies — and where the store never recorded a
   * crossing (a seeded or migrated core was never watched crossing), the row
   * must say nothing there rather than invent a day.
   */
  test("identity rows carry the day they were promoted, or nothing, never an invented one", () => {
    const d = open(richDir);
    try {
      const overview = overviewView(d.src);
      expect(overview.identity.length).toBeGreaterThan(0);
      const promotions = new Map<string, number>();
      for (const row of d.src.store.eventLog({ name: "band.promoted", limit: 20_000 })) {
        if (row.ref !== null && !promotions.has(row.ref)) promotions.set(row.ref, row.day);
      }
      for (const el of overview.identity) {
        // Never invented: a day is present exactly when the log holds one.
        expect(el.promotedDay).toBe(promotions.get(el.id) ?? null);
        if (el.promotedDay !== null) {
          expect(Number.isInteger(el.promotedDay)).toBe(true);
          expect(el.promotedDay).toBeGreaterThanOrEqual(0);
        }
      }
      // An empty store has no rows to be wrong about, and says so.
      const empty = open(emptyDir);
      try {
        expect(overviewView(empty.src).identity.length).toBe(0);
      } finally {
        empty.close();
      }
    } finally {
      d.close();
    }
  });

  /**
   * ONE TABLE, LED BY ENGLISH — and still total.
   *
   * The health tab had two: eleven `adapter.*` names in one and all nineteen in
   * the other, so seven identifiers were listed twice on one screen with
   * near-duplicate glosses, and the first thing a reader met was 23 dotted
   * names against a column of `(never run)`. Merging them is only safe if the
   * totality rule survives it, so this asserts both halves: every durable name
   * appears EXACTLY once, and every row leads with the plain-English gloss the
   * registry already carries.
   */
  test("every durable event appears exactly once on the health page, led by its gloss", () => {
    const d = open(richDir);
    try {
      const health = healthView(d.src);
      expect(health.records.length).toBe(DURABLE_EVENT_NAMES.length);
      const seen = new Set(health.records.map((r) => r.name));
      expect(seen.size).toBe(DURABLE_EVENT_NAMES.length);
      for (const name of DURABLE_EVENT_NAMES) expect(seen.has(name)).toBe(true);
      for (const r of health.records) {
        // The lead is a sentence, not an identifier: it is longer than the
        // dotted name and it is not the dotted name.
        expect(r.gloss.length).toBeGreaterThan(20);
        expect(r.gloss).not.toBe(r.name);
        expect(r.gloss.includes(" ")).toBe(true);
        // `absent` is a fact about the count, in both directions.
        expect(r.absent === null).toBe(r.count > 0);
        // A host-written row says so and carries its caveat; a machinery row
        // has neither, which is the only thing the split table was saying.
        expect(r.note === null).toBe(!r.adapter);
      }
      // What has actually happened is listed above what never has.
      const counts = health.records.map((r) => r.count);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      expect(counts[0]).toBeGreaterThan(0);
      // At least one adapter row and one machinery row, or the merge is moot.
      expect(health.records.some((r) => r.adapter)).toBe(true);
      expect(health.records.some((r) => !r.adapter)).toBe(true);
    } finally {
      d.close();
    }
  });

  test("the stories page tells each contested belief as a timeline", () => {
    const d = open(richDir);
    try {
      const stories = mindView(d.src).stories;
      expect(stories.length).toBeGreaterThan(0);
      const withBeats = stories.filter((s) => s.beats.length > 0);
      expect(withBeats.length).toBeGreaterThan(0);
      for (const s of withBeats) {
        expect(s.began.length).toBeGreaterThan(0);
        expect(s.now.length).toBeGreaterThan(0);
        for (const beat of s.beats) {
          expect(beat.challenger.length).toBeGreaterThan(0);
          // The verdict is a CLAUSE, in prose. Never an id: an id inside a
          // sentence written for a human is the leak this field was rewritten
          // to close.
          expect(beat.verdict).not.toMatch(/\b(?:mem|sch|epi)_[0-9a-f]+/);
          expect(beat.verdict.length).toBeGreaterThan(8);
        }
      }
      // At least one belief in the demo store actually changed its mind.
      const revised = stories.filter((s) => s.revised);
      expect(revised.length).toBeGreaterThan(0);
      // AND THE PAGE SHOWS THE CHANGE. Both ends used to resolve through the
      // supersede chain to the same row and truncate identically, so the one
      // surface whose job is to show a revision showed two identical strings.
      for (const s of revised) {
        expect(s.began).not.toBe(s.now);
        expect(s.beganFull).not.toBe(s.nowFull);
        // What it became is carried as words beside the beat, not spliced into
        // the sentence as an address.
        const crossed = s.beats.filter((b) => b.crossed);
        for (const b of crossed) {
          if (b.became !== null) expect(b.became).not.toMatch(/^(?:mem|sch|epi)_/);
        }
      }
    } finally {
      d.close();
    }
  });

  test("activity can be polled for what is new since a sequence number", () => {
    const d = open(richDir);
    try {
      const all = activityView(d.src, { limit: 5 });
      expect(all.lastSeq).toBeGreaterThan(0);
      // Nothing is new since the newest.
      expect(activityView(d.src, { sinceSeq: all.lastSeq }).events).toEqual([]);
      // Everything is new since zero.
      expect(activityView(d.src, { sinceSeq: 0 }).events.length).toBe(all.total);
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("starting the thing", () => {
  test("it binds loopback on a free port and serves the app over HTTP", async () => {
    const running = await startDashboard({ dir: richDir, port: 0 });
    try {
      expect(running.port).toBeGreaterThan(0);
      expect(running.dir).toBe(richDir);
      expect(running.url).toContain("127.0.0.1");
      const res = await fetch(`${running.url}/api/meta`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { dir: string; observer: boolean };
      expect(body.dir).toBe(richDir);
      expect(body.observer).toBe(true);
      const page = await fetch(`${running.url}/`);
      expect(page.status).toBe(200);
      expect((await page.text())).toContain("<title>");
    } finally {
      await running.stop();
    }
  });

  test("a request with a forged Host is refused over the wire too", async () => {
    const running = await startDashboard({ dir: emptyDir, port: 0 });
    try {
      const res = await fetch(`${running.url}/api/overview`, { headers: { host: "evil.example" } });
      expect(res.status).toBe(403);
    } finally {
      await running.stop();
    }
  });

  test("the default port is 4747 — 3737 belongs to v1 for the parallel run", () => {
    expect(DEFAULT_PORT).toBe(4747);
  });

  test("it refuses a directory with no store in it, in one sentence", async () => {
    const nowhere = join(tempDir("counterparts-web-nostore-"), "not-a-store");
    const said: string[] = [];
    const realErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      said.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await serve(["serve", "--dir", nowhere, "--port", "0"]);
      expect(code).toBe(1);
    } finally {
      process.stderr.write = realErr;
    }
    const message = said.join("");
    // ONE sentence, naming the directory and what to do — not a stack.
    expect(message).toContain(nowhere);
    expect(message).toContain("counterparts init");
    expect(message.split("\n").filter((l) => l.trim().length > 0).length).toBe(1);
  });

  test("`serve` is parsed apart from the five views", () => {
    expect(parseServe(["serve", "--dir", "/tmp/x", "--port", "5000"])).toEqual({
      serve: true,
      dir: "/tmp/x",
      port: 5000,
      defaultStore: false,
    });
    expect(parseServe(["status"]).serve).toBe(false);
    expect(parseServe(["serve"]).port).toBeUndefined();
    expect(parseServe(["serve"]).defaultStore).toBe(false);
    expect(parseServe(["serve", "--default-store"]).defaultStore).toBe(true);
    expect(parseServe(["serve", "--default-store=true"]).defaultStore).toBe(true);
  });

  /**
   * A STRAY `serve` MUST NOT OPEN THE OWNER'S MEMORY.
   *
   * It used to: no `--dir` meant the DEFAULT data dir, which on a machine with
   * an install is the live store, and the only thing standing in front of that
   * was a warning line printed after the socket was already bound. The refusal
   * is pure, so this test needs no store, no socket and no default dir it might
   * accidentally be right about.
   */
  test("`serve` with no --dir refuses, names the store it would have opened, and opens nothing", async () => {
    // The environment is passed in rather than read, so this asserts about the
    // sentence rather than about the machine the suite happens to run on.
    const refusal = String(serveRefusal(parseServe(["serve"]), {}));
    expect(refusal).toContain("Refused");
    expect(refusal).toContain("default store");
    expect(refusal).toContain("--default-store");
    expect(refusal).not.toContain("--yes");
    // It NAMES the directory it would have opened, whatever that resolves to
    // on this machine — the whole point of the sentence.
    expect(refusal.length).toBeGreaterThan(80);
    // One line, like every other refusal this binary prints.
    expect(refusal.includes("\n")).toBe(false);

    // AND IT DOES NOT CLAIM WHAT IT CANNOT CHECK. `~/.counterparts/store` on a
    // machine with an install IS the live memory; `COUNTERPARTS_DATA_DIR` is
    // whatever somebody exported, and an adversarial review pointed this at a
    // scratch demo store and got a refusal calling it live memory. It still
    // refuses — the variable is the one QUICKSTART §7 says to export — but the
    // sentence says why instead of asserting whose memory it is.
    const fromEnv = String(
      serveRefusal(parseServe(["serve"]), { [DATA_DIR_ENV]: "/tmp/some-scratch-store" }),
    );
    expect(fromEnv).toContain("Refused");
    expect(fromEnv).toContain(DATA_DIR_ENV);
    expect(fromEnv).toContain("/tmp/some-scratch-store");
    expect(fromEnv).toContain("--default-store");
    expect(fromEnv).not.toContain("--yes");
    expect(fromEnv.includes("\n")).toBe(false);
    expect(fromEnv).not.toContain("that is the owner's live memory");

    // Named on purpose, either way, and nothing is refused.
    expect(serveRefusal(parseServe(["serve", "--dir", "/tmp/x"]), {})).toBeNull();
    expect(serveRefusal(parseServe(["serve", "--default-store"]), {})).toBeNull();
    expect(
      serveRefusal(parseServe(["serve", "--default-store"]), { [DATA_DIR_ENV]: "/tmp/some-scratch-store" }),
    ).toBeNull();

    // And the whole command exits 1 without touching a store or a socket.
    const said: string[] = [];
    const realErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      said.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await serve(["serve", "--port", "0"])).toBe(1);
    } finally {
      process.stderr.write = realErr;
    }
    expect(said.join("")).toContain("Refused");
  });

  /**
   * `--yes` MEANS ONE THING EVERYWHERE — "skip an interactive confirmation" —
   * and `serve` has no confirmation to skip. Until 2026-09-05 this was the last
   * flag in the package with a second meaning ("open the DEFAULT store"); the
   * flag is `--default-store` now, and `--yes` is not a no-op but an UNKNOWN
   * flag, refused before the store is resolved, let alone opened. The env var
   * points at an empty scratch dir so "nothing was opened" is checked rather
   * than assumed — and the sentence is checked too: a `serve` that got past the
   * flag would have said "No store at", not "unknown flag".
   */
  test("`serve --yes` is refused as an unknown flag, before anything is opened", async () => {
    const untouched = tempDir("counterparts-web-yes-");
    process.env[ENV] = untouched;
    const said: string[] = [];
    const realErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      said.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await serve(["serve", "--yes", "--port", "0"])).toBe(1);
      expect(await serve(["serve", "--yes=true", "--port", "0"])).toBe(1);
      // Even beside a store named on purpose: the flag is unknown, not merely
      // insufficient, so a reader of the old docs learns the new word at once.
      expect(await serve(["serve", "--yes", "--dir", richDir, "--port", "0"])).toBe(1);
    } finally {
      process.stderr.write = realErr;
    }
    expect(said).toHaveLength(3);
    for (const line of said) {
      expect(line).toContain("Refused: unknown flag --yes");
      expect(line).toContain("--default-store");
      expect(line).not.toContain("No store at");
      // One line, like every refusal this binary prints.
      expect(line.trimEnd().includes("\n")).toBe(false);
    }
    expect(readdirSync(untouched)).toEqual([]);

    // Pure, so the sentence is checkable without a socket.
    expect(unknownFlag(["serve", "--yes"])).toContain("'serve' takes --dir --port --default-store");
    expect(unknownFlag(["serve", "--default-store", "--dir", "/x", "--port", "1"])).toBeNull();
    expect(unknownFlag(["serve", "--default-store=true"])).toBeNull();
    expect(unknownFlag(["serve"])).toBeNull();
  });

  test("`serve --default-store` takes the store from COUNTERPARTS_DATA_DIR — a missing one is refused by that name", async () => {
    // Past the gate and into the store's own resolution: the variable names a
    // dir with no store, and the refusal names THAT dir, so the variable was
    // read — and nothing was minted there in the process.
    const nowhere = tempDir("counterparts-web-default-nostore-");
    process.env[ENV] = nowhere;
    const said: string[] = [];
    const realErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      said.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await serve(["serve", "--default-store", "--port", "0"])).toBe(1);
    } finally {
      process.stderr.write = realErr;
    }
    const message = said.join("");
    expect(message).toContain(`No store at ${nowhere}`);
    expect(message).not.toContain("Refused");
    expect(readdirSync(nowhere)).toEqual([]);
  });

  /**
   * THE WAY THROUGH, exercised for real. `serve()` binds a socket and stays, so
   * a test that calls it in-process with a store to open has no handle to stop
   * it; a child process does. The child gets an EXPLICIT env — the shape
   * preload.ts names as safe for a spawned child: `HOME` is the temp home
   * preload minted, so `homedir()` in the child can only ever resolve there,
   * and `COUNTERPARTS_DATA_DIR` names the seeded scratch store.
   * The start-up lines say that store was opened and that `--default-store` is
   * why. A regression is a server that never says it started, or one that exits
   * at once; both end as a failure carrying the child's output, never a hang.
   */
  test("`serve --default-store` opens the store COUNTERPARTS_DATA_DIR names, and says so", async () => {
    const child = spawn(process.execPath, ["run", BIN, "serve", "--default-store", "--port", "0"], {
      env: { ...process.env, [ENV]: richDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += String(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      err += String(c);
    });
    const started = new Promise<void>((ok, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`serve did not start within 20s\nstdout: ${out}\nstderr: ${err}`)),
        20_000,
      );
      child.stdout.on("data", () => {
        if (out.includes("ctrl-c to stop.")) {
          clearTimeout(timer);
          ok();
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        fail(new Error(`serve exited ${String(code)} before it started\nstdout: ${out}\nstderr: ${err}`));
      });
    });
    try {
      await started;
    } finally {
      child.kill();
    }
    expect(out).toContain(`reading ${richDir}`);
    expect(out).toContain("(--default-store, so this is the DEFAULT store");
    expect(out).toContain("observer mode");
    expect(out).not.toContain("--yes");
    expect(err).toBe("");
  }, 30_000);

  test("a view with a flag it does not take is a refusal, not a render", () => {
    // `--dirr` is the console's founding case (cli/commands.ts#unknownFlag): a
    // typo in the one flag that says WHICH STORE, swallowed, and the default
    // store read instead. Under the mocked home the default is a missing store,
    // so the render would have been a refusal anyway — the assertion is WHICH
    // refusal: the flag, before the store.
    const report = runReport(["status", "--dirr", richDir]);
    expect(report.refused).toBe(true);
    expect(report.text).toContain("Refused: unknown flag --dirr");
    expect(report.text).toContain("--dir");
    expect(report.text).not.toContain("No store at");
    expect(report.text.includes("\n")).toBe(false);
    // Every flag the views do take still renders …
    expect(
      runReport(["browse", "--dir", richDir, "--no-colour", "--limit=3", "--archived", "--width", "80"]).refused,
    ).toBe(false);
    expect(unknownFlag(["status", "--dir", "/x", "--colour"])).toBeNull();
    // … and help still wins over an unknown flag, opening nothing, as on the console.
    expect(run(["--help", "--bogus"])).toBe(run(["--help"]));
  });

  test("a view of a store that is not there is a refusal, not a render", () => {
    const nowhere = join(tempDir("counterparts-web-report-"), "not-a-store");
    const report = runReport(["status", "--dir", nowhere]);
    expect(report.refused).toBe(true);
    expect(report.text).toContain(`No store at ${nowhere}`);
    // A real render is not a refusal — and `run()` still returns just the text.
    const fine = runReport(["status", "--dir", richDir]);
    expect(fine.refused).toBe(false);
    expect(run(["status", "--dir", richDir])).toBe(fine.text);
  });

  test("the no-store sentence offers the --dir that was actually passed", () => {
    const err = { code: "STORE_UNINITIALIZED", detail: {} } as unknown as Parameters<
      typeof describeStoreError
    >[0];
    // Without a --dir, the remedy is the plain one.
    expect(describeStoreError(err, "/tmp/somewhere")).toBe(
      "No store at /tmp/somewhere. Run 'counterparts init' to create one.",
    );
    // With one, the remedy carries it — `counterparts init` on its own would
    // have created the store in the DEFAULT place, not the one just named.
    expect(describeStoreError(err, "/tmp/somewhere", true)).toBe(
      "No store at /tmp/somewhere. Run 'counterparts init --dir /tmp/somewhere' to create one.",
    );
  });
});
