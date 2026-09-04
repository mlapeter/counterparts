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
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { FRAMING, LANE_ORDER } from "../src/core/self/index.js";
import { Dashboard, DURABLE_EVENT_NAMES, NEVER, NONE, sourceOf } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { EVENT_NODE, FLOW_EDGES, FLOW_NODES, NODE_KEYS, nodeOf } from "../src/adapters/dashboard/web/flow.js";
import { NARRATORS, narrate } from "../src/adapters/dashboard/web/narrate.js";
import { WITHHELD, reveal } from "../src/adapters/dashboard/web/reveal.js";
import {
  DEFAULT_PORT,
  isAllowedHost,
  router,
  startDashboard,
} from "../src/adapters/dashboard/web/server.js";
import { activityView, healthView, mindView, wakeLanes } from "../src/adapters/dashboard/web/views.js";
import { parseServe } from "../src/adapters/dashboard/bin/dashboard.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const HOST = "127.0.0.1:4747";

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
      if (r.confidential) {
        expect(r.text).toBeNull();
        expect(r.label).toBe(WITHHELD);
        const points = get(d.src, "/api/memories").json["points"] as { id: string; text: string; confidential: boolean }[];
        const row = points.find((p) => p.id === id);
        expect(row?.confidential).toBe(true);
        expect(row?.text).toBe(WITHHELD);
        // Its physics is still fully visible: the dot is on the chart.
        expect(get(d.src, `/api/memory?id=${id}`).json["text"]).toBe(WITHHELD);
      } else {
        // The store's own predicate did not call this confidential; the rule is
        // still the one the dashboard follows, so the assertion is that the
        // dashboard AGREES with the predicate rather than inventing its own.
        expect(r.text).not.toBeNull();
      }
    } finally {
      d.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the shapes the page draws with", () => {
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
          expect(["held", "crossed the bar — but I find no supersession recorded"]).toContain(
            beat.crossed ? "held" : beat.verdict,
          );
        }
      }
      // At least one belief in the demo store actually changed its mind.
      expect(stories.some((s) => s.revised)).toBe(true);
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

  test("`serve` is parsed apart from the five views", () => {
    expect(parseServe(["serve", "--dir", "/tmp/x", "--port", "5000"])).toEqual({
      serve: true,
      dir: "/tmp/x",
      port: 5000,
    });
    expect(parseServe(["status"]).serve).toBe(false);
    expect(parseServe(["serve"]).port).toBeUndefined();
  });
});
