/**
 * `adapters/dashboard/` — the owner's window, and the four rules it may not break.
 *
 * Nothing is faked here. Every fixture is seeded THROUGH the real `Counterpart`
 * over a real temp data dir — memories authored at the front door, an entity born
 * by mention, beliefs added, three lived days of credited challenge until one
 * crosses its bar and supersedes, a real sleep cycle — and then a `Dashboard` is
 * opened over the result. A dashboard tested against a hand-built store would
 * prove nothing about the store the owner actually has.
 *
 * The four hard rules, each with its own describe block:
 *
 *   1. **Observer by construction.** Three layers: the stance is set by
 *      `Dashboard.open` and cannot be passed in; `sourceOf` refuses a writable
 *      brain; and the DIRECTORY IS BYTE-IDENTICAL after every view renders —
 *      hashed between renders, not only at the end.
 *   2. **No write handle.** A source scan over every file in the adapter, with
 *      comments and string literals stripped (the technique
 *      `test/counterpart.test.ts` uses on the composition root): no call to any
 *      `WRITE_METHODS` name, and no filesystem module imported at all. That last
 *      one is also the mechanization of "no memory body text is persisted into
 *      any dashboard state file" — there is no state file because nothing here
 *      can open one.
 *   3. **Totality.** The three registries are ENUMERATED from the live core —
 *      physics' kind table, the band order map, sleep's phase tuple, plus the
 *      durable-event vocabulary — and every member must appear in a view or be
 *      explicitly marked absent. A test that listed the kinds itself would go
 *      stale the day a seventh kind is born, which is the failure the rule is for.
 *   4. **Render-time id resolution.** A superseded id renders what it BECAME, a
 *      removed id renders a named absence, an unknown id renders a named absence.
 *      Never baked text.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { WRITE_METHODS, hashText, serializeProse } from "../src/core/store/index.js";
import {
  ABSENCE,
  BANDS,
  CYCLE_PHASES,
  DURABLE_EVENTS,
  DURABLE_EVENT_NAMES,
  Dashboard,
  KINDS,
  NEVER,
  NONE,
  ObserverRequired,
  PLAIN,
  VIEWS,
  VIEW_BLURB,
  contestedBeliefs,
  isViewName,
  renderStatus,
  resolveRef,
  sourceOf,
  stripAnsi,
  style as makeStyle,
} from "../src/adapters/dashboard/index.js";
import { helpText, parseArgv, run } from "../src/adapters/dashboard/bin/dashboard.js";
// The console, imported so the two surfaces can be compared on ONE store rather
// than trusted to agree.
import { run as runCli } from "../src/adapters/cli/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
/** The HOST's reported ceiling. Nothing in `src/` may invent one (scar §2.18). */
const BUDGET_BYTES = 9000;

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-dash-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// The fixture: a store with a life in it, seeded through the real brain
// ═══════════════════════════════════════════════════════════════════════════

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
];

const CHALLENGES = [
  "Ada asked for a live walkthrough of the change instead of a written review.",
  "Ada booked a screen share rather than leaving comments on the branch.",
  "Ada said she reads faster when someone is talking her through it.",
];

interface Seeded {
  readonly authoredId: string;
  readonly entityId: string;
  readonly beliefId: string;
  readonly protectedId: string;
  readonly successorId: string;
  readonly challengerIds: string[];
  readonly fillerIds: string[];
}

/**
 * One lived arc: filler, an authored memory through the front door, an entity
 * born by mention, two beliefs (one PROTECTED), then three lived days of
 * challenge until the third crosses the bar and supersedes. `person` inertia is
 * 0.8, so the slow-kind daily force cap makes three days arithmetic, not luck.
 *
 * Nothing is promoted, per the task: identity stays empty on purpose, which is
 * what makes the identity view's absence marker a real assertion.
 */
async function seed(target = dir): Promise<Seeded> {
  const c = Counterpart.open({ dir: target, owner: true });
  const fillerIds: string[] = [];
  for (const body of FILLER) {
    fillerIds.push(
      c.store.put({
        type: "memory",
        kind: "fact",
        body,
        salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
        physics: { birthDay: 0, lastUsedDay: 0 },
      }),
    );
  }

  // A genuine duplicate: an ordinary memory that says exactly what a filler
  // memory already says, so the cycle's dedup has real work to do and the feed
  // holds a real `memory.merged` row. Its id sorts LAST in the group, so the
  // tie-break always archives THIS row and never the filler the other views
  // assert on. Until 2026-09-04 this fixture's only dedup event was the bug —
  // dedup archiving the revision's successor — and the filter test below read
  // that as coverage.
  c.store.put({
    id: "mem_ffffffffffff",
    type: "memory",
    kind: "fact",
    body: FILLER[0] as string,
    salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
    physics: { birthDay: 0, lastUsedDay: 0 },
  });

  const deposit = await c.submitSessionEnd(
    {
      content:
        "The storage split keeps canonical prose in markdown, operational state in one small database, and a rebuildable cache nobody backs up.",
      kind: "fact",
      title: "storage split",
      claimed: 0.8,
      salience: { relevance: 0.8, emotional: 0.6, predictive: 0.7 },
    },
    { session: "s1", scope: "proj" },
  );

  const entityId = c.schemas.mention({
    name: "Ada",
    kind: "person",
    source: "Ada prefers async review",
    chunkRef: "c1",
    day: 0,
  }).id as string;
  const beliefId = c.schemas.addBelief({
    entityId,
    statement: "Ada prefers async review",
    day: 0,
    dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
  }).id as string;
  const protectedId = c.schemas.addBelief({
    entityId,
    statement: "Ada is the owner of this store, and that never gets revised away",
    day: 0,
    protected: true,
    dimensions: { relevance: 0.9, emotional: 0.6, predictive: 0.6 },
  }).id as string;

  let successorId: string | null = null;
  const challengerIds: string[] = [];
  for (let day = 1; day <= CHALLENGES.length; day += 1) {
    c.store.advanceClock(`2026-08-0${day}`);
    const challengerId = c.store.put({
      type: "memory",
      kind: "person",
      body: CHALLENGES[day - 1] ?? "",
      salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
      physics: { birthDay: day, lastUsedDay: day },
    });
    challengerIds.push(challengerId);
    successorId = c.schemas.challengeBelief({ updates: beliefId, challengerId, day }).successorId;
    if (successorId !== null) break;
  }

  await c.sessionEnd({ date: "2026-08-04", budgetBytes: BUDGET_BYTES });
  c.close();

  return {
    authoredId: deposit.memoryId as string,
    entityId,
    beliefId,
    protectedId,
    successorId: successorId as string,
    challengerIds,
    fillerIds,
  };
}

function dash(opts: Parameters<typeof Dashboard.open>[0] = {}): Dashboard {
  const d = Dashboard.open({ dir, ...opts });
  open.push(d);
  return d;
}

/** An initialized-but-EMPTY store. The dashboard no longer mints an absent one
 *  by looking at it (cli INTERFACE-GAPS §7, closed 2026-08-26) — so the tests
 *  about honest emptiness must create the emptiness they read. */
function emptyStore(): void {
  Counterpart.open({ dir, owner: true }).close();
}

// ── the byte-identical protocol ──────────────────────────────────────────────

/**
 * Every file under `root`, relative path → sha256 of contents.
 *
 * `canonicalOnly` drops box 3 (`cache/`), for one measured reason found by this
 * suite: `store/cache.ts`'s `openCache` runs `INSERT OR REPLACE INTO cache_meta`
 * on EVERY open, inside a transaction that is outside `mutate()` and consults no
 * stance — so merely constructing a Store rewrites bytes in `cache.sqlite`
 * before a line of dashboard code runs. It is box 3, it is rebuildable, and
 * nothing canonical moves; but it means "byte-identical directory" is provable
 * strictly for boxes 1 and 2 and provable ACROSS RENDERS for box 3. Both are
 * asserted below, separately, and the finding is filed in
 * `src/adapters/dashboard/INTERFACE-GAPS.md` §1 rather than papered over.
 */
function snapshot(root: string, opts: { canonicalOnly?: boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      const rel = relative(root, full);
      if (opts.canonicalOnly === true && rel.split("/")[0] === "cache") continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      out.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return out;
}

/** Every render this suite exercises, named, so a failure says which one moved. */
function renderings(d: Dashboard, s: Seeded): [string, () => string][] {
  return [
    ["status", () => d.status()],
    ["browse", () => d.browse()],
    ["browse --archived", () => d.browse({ archived: true, limit: 100 })],
    ["browse --id (superseded)", () => d.browse({ id: s.beliefId })],
    ["browse --id (live)", () => d.browse({ id: s.authoredId })],
    ["browse --id (missing)", () => d.browse({ id: "mem_ffffffffffff" })],
    ["stories", () => d.stories()],
    ["stories --id", () => d.stories({ id: s.beliefId })],
    ["identity", () => d.identity()],
    ["activity", () => d.activity()],
    ["all", () => d.all()],
  ];
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

// ── the source scan ──────────────────────────────────────────────────────────

const ADAPTER_DIR = fileURLToPath(new URL("../src/adapters/dashboard", import.meta.url));

interface AdapterSource {
  readonly path: string;
  /** Comments and string literals removed — what the file actually DOES. */
  readonly code: string;
  /** Every module specifier the file imports or requires. */
  readonly imports: string[];
}

/**
 * THE ONE FILE WITH A FILESYSTEM AND A SOCKET, named here rather than waved
 * through by a wildcard.
 *
 * `web/server.ts` serves two static HTML pages that ship beside it, so it needs
 * `node:fs` — and it binds a loopback port, so it needs `node:http`. Neither
 * weakens what the directory-wide ban actually mechanizes ("no memory body text
 * is persisted into any dashboard state file: there IS no state file"), because
 * the exception is read-only: the write-call scan below still applies to this
 * file unchanged, and a second assertion pins the `node:fs` import to
 * `readFileSync` alone. A future `writeFileSync` in the server fails here.
 */
const SERVER_FILE = "web/server.ts";
const SERVER_EXTRA_IMPORTS = ["node:fs", "node:http"];

function adapterSources(): AdapterSource[] {
  const out: AdapterSource[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const raw = readFileSync(full, "utf8");
      const decommented = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
      const imports = [
        ...decommented.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g),
      ].map((m) => m[1] as string);
      out.push({ path: relative(ADAPTER_DIR, full), code: strip(raw), imports });
    }
  };
  walk(ADAPTER_DIR);
  return out;
}

/** Comments and string literals out, `${…}` expressions kept — a call could hide
 *  in one. Lifted from `test/counterpart.test.ts`'s scan of the wiring root. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, (lit) =>
      [...lit.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(";"),
    )
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Observer by construction
// ═══════════════════════════════════════════════════════════════════════════
describe("the dashboard is an OBSERVER by construction, not by good behaviour", () => {
  test("it opens the brain in observer stance, and a caller cannot turn that off", async () => {
    await seed();
    // The option does not exist on `DashboardOptions`, and even smuggled through
    // an `any` it never reaches the Counterpart: the stance is set after spread.
    const d = dash({ observer: false } as unknown as Parameters<typeof Dashboard.open>[0]);
    expect(d.observer).toBe(true);
    expect(d.store.observer).toBe(true);
    expect(d.counterpart.observer).toBe(true);
    expect(d.source.observer).toBe(true);
  });

  test("sourceOf REFUSES a writable brain — the views cannot be handed one", () => {
    const writable = Counterpart.open({ dir, owner: true });
    open.push(writable);
    expect(() => sourceOf(writable)).toThrow(ObserverRequired);
    // And a real observer passes, so the refusal is a stance check, not a wall.
    const instrument = Counterpart.open({ dir, observer: true });
    open.push(instrument);
    expect(sourceOf(instrument).observer).toBe(true);
  });

  test("the CANONICAL boxes are byte-identical across open, every view, and close", async () => {
    const s = await seed();
    // Boxes 1 and 2 — prose and operational. The strict form: hashed before the
    // dashboard exists, and after every single render.
    const before = snapshot(dir, { canonicalOnly: true });
    expect(before.size).toBeGreaterThan(0);

    const d = dash();
    expect(diff(before, snapshot(dir, { canonicalOnly: true }))).toEqual([]);
    for (const [name, render] of renderings(d, s)) {
      const text = render();
      expect(text.length).toBeGreaterThan(0);
      expect(diff(before, snapshot(dir, { canonicalOnly: true })), name).toEqual([]);
    }
    d.close();
    expect(diff(before, snapshot(dir, { canonicalOnly: true }))).toEqual([]);
  });

  test("the WHOLE directory, cache included, is byte-identical after every view renders", async () => {
    const s = await seed();
    const d = dash();
    // Snapshotted after open, because `openCache` writes its schema-version row
    // on every construction (see `snapshot`'s note; INTERFACE-GAPS §1). From
    // here on nothing may move — hashed after EACH render, so a view that wrote
    // and a later view that wrote the same bytes back could not slip through.
    const before = snapshot(dir);
    for (const [name, render] of renderings(d, s)) {
      render();
      expect(diff(before, snapshot(dir)), name).toEqual([]);
    }
    d.close();
    expect(diff(before, snapshot(dir))).toEqual([]);
  });

  test("reading an ARCHIVED memory — the one read that logs — still moves no byte", async () => {
    const s = await seed();
    const d = dash();
    const before = snapshot(dir);
    // `store.read` emits `store.archived.read` for an archived row (§5 G13).
    // That event is a ring entry, never a durable write — this is the proof.
    const text = d.browse({ id: s.beliefId });
    expect(text).toContain(s.successorId);
    expect(diff(before, snapshot(dir))).toEqual([]);
    // Same for a superseded VERSION read, which also logs (§5 G13).
    d.stories({ id: s.beliefId });
    expect(diff(before, snapshot(dir))).toEqual([]);
  });

  test("no source file in the adapter calls a WRITE_METHOD or imports a filesystem", () => {
    const sources = adapterSources();
    expect(sources.length).toBeGreaterThan(5);

    const FS_MODULES = ["node:fs", "fs", "node:fs/promises", "fs/promises"];
    const FS_CALLS = [
      "writeFile",
      "writeFileSync",
      "appendFile",
      "appendFileSync",
      "mkdir",
      "mkdirSync",
      "rmSync",
      "unlink",
      "unlinkSync",
      "renameSync",
      "copyFileSync",
      "createWriteStream",
      "openSync",
    ];

    const offences: string[] = [];
    for (const { path, code, imports } of sources) {
      for (const method of WRITE_METHODS) {
        if (new RegExp(`\\.${method}\\s*\\(`).test(code)) offences.push(`${path}: .${method}()`);
      }
      // No filesystem module, at all. This is also the mechanization of "no
      // memory body text is persisted into any dashboard state file": there IS
      // no state file, because nothing in this directory can open one. The web
      // server is the single named exception, and it is read-only (below).
      for (const module of imports) {
        if (path === SERVER_FILE && module === "node:fs") continue;
        if (FS_MODULES.includes(module)) offences.push(`${path}: imports ${module}`);
      }
      for (const fn of FS_CALLS) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(code)) offences.push(`${path}: ${fn}()`);
      }
    }
    expect(offences).toEqual([]);

    // The scan is only worth something if it can actually see a violation.
    const sentinel = strip('const x = store.put({ body: "// put(" });');
    expect(/\.put\s*\(/.test(sentinel)).toBe(true);
  });

  test("the adapter imports only the core, the standard library it needs, and itself", () => {
    const outside = new Set<string>();
    const serverOnly = new Set<string>();
    for (const { path, imports } of adapterSources()) {
      for (const module of imports) {
        if (module.startsWith(".")) continue;
        if (path === SERVER_FILE && SERVER_EXTRA_IMPORTS.includes(module)) {
          serverOnly.add(module);
          continue;
        }
        outside.add(module);
      }
    }
    // Zero runtime dependencies, and — everywhere but the one named file — no
    // filesystem and no socket (CONTRACT §4/§5).
    expect([...outside].sort()).toEqual(["node:path", "node:url"]);
    // The exception is exactly two modules, in exactly one file.
    expect([...serverOnly].sort()).toEqual(["node:fs", "node:http"]);
  });

  test("the web server's ONE filesystem import binds readFileSync and nothing else", () => {
    const server = adapterSources().find((s) => s.path === SERVER_FILE);
    expect(server).toBeDefined();
    const source = readFileSync(join(ADAPTER_DIR, SERVER_FILE), "utf8");
    // Every `node:fs` import statement in the file, whatever its shape.
    const statements = [...source.matchAll(/^import\s+([^;]*?)\s+from\s+["']node:fs["'];?$/gm)].map(
      (m) => (m[1] ?? "").trim(),
    );
    expect(statements).toEqual(["{ readFileSync }"]);
    // And no dynamic escape hatch back to the rest of the module.
    expect(/require\s*\(\s*["']node:fs["']/.test(source)).toBe(false);
    expect(/import\s*\(\s*["']node:fs["']/.test(source)).toBe(false);
  });

  test("the adapter holds no state of its own — it creates no file anywhere", async () => {
    await seed();
    const home = mkdtempSync(join(tmpdir(), "counterparts-elsewhere-"));
    try {
      const beforeDir = snapshot(dir, { canonicalOnly: true });
      const beforeHome = snapshot(home);
      const d = dash();
      d.all();
      d.close();
      expect(diff(beforeDir, snapshot(dir, { canonicalOnly: true }))).toEqual([]);
      // Nowhere else on disk either: no config, no cache, no state of its own.
      expect(diff(beforeHome, snapshot(home))).toEqual([]);
      expect(readdirSync(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Totality — every registered axis appears, or is marked absent
// ═══════════════════════════════════════════════════════════════════════════
describe("TOTALITY: every axis the registries know is displayed or marked absent", () => {
  test("the registries are DERIVED from the core, so they cannot go stale", () => {
    // Kinds come from the physics table itself, not from a copy here.
    expect([...KINDS].sort().join(",")).toBe(Object.keys(PHYSICS.KINDS).sort().join(","));
    expect(KINDS.length).toBeGreaterThan(0);
    // Bands and durable events are exhaustive BY TYPE (`satisfies`): a new
    // member fails `tsc` in `registries.ts` before it can go missing on screen.
    expect([...BANDS]).toEqual(["episodic", "semantic", "identity"]);
    expect([...DURABLE_EVENT_NAMES].sort().join(",")).toBe(
      Object.keys(DURABLE_EVENTS).sort().join(","),
    );
    expect(CYCLE_PHASES.length).toBeGreaterThan(0);
  });

  test("no event reaches the durable log that the registry does not know about", async () => {
    await seed();
    const d = dash();
    const seen = new Set(d.store.eventLog({ limit: 10_000 }).map((r) => r.name));
    expect(seen.size).toBeGreaterThan(0);
    // The registry is exhaustive by TYPE over the four record interfaces, which
    // cannot catch a writer that appends a raw string name (INTERFACE-GAPS §5).
    // This is the empirical half: whatever the real cycle actually wrote must be
    // a name the activity view is able to name.
    const known: string[] = [...DURABLE_EVENT_NAMES];
    for (const name of seen) expect(known).toContain(name);
  });

  test("status names EVERY kind, and marks the ones with nothing in them absent", async () => {
    await seed();
    const text = stripAnsi(dash().status());
    const lines = text.split("\n");
    for (const kind of KINDS) {
      const line = lines.find((l) => new RegExp(`^\\s+${kind}\\s`).test(l));
      expect(line, `no line for kind ${kind}`).toBeDefined();
      // Either it has a count, or it says so out loud. Never simply missing.
      const count = Number((line ?? "").trim().split(/\s+/)[1]);
      if (count === 0) expect(line).toContain(NONE);
      else expect(count).toBeGreaterThan(0);
    }
    // The fixture promotes nothing and mints no place or skill, so the absence
    // markers are actually exercised rather than merely available.
    expect(text).toContain(NONE);
  });

  test("status names EVERY band, with the same absent-or-counted rule", async () => {
    await seed();
    const lines = stripAnsi(dash().status()).split("\n");
    for (const band of BANDS) {
      const line = lines.find((l) => new RegExp(`^\\s+${band}\\s`).test(l));
      expect(line, `no line for band ${band}`).toBeDefined();
      const count = Number((line ?? "").trim().split(/\s+/)[1]);
      if (count === 0) expect(line).toContain(NONE);
    }
  });

  test("status names EVERY phase of the cycle, and says which lived day it finished", async () => {
    await seed();
    const text = stripAnsi(dash().status());
    for (const phase of CYCLE_PHASES) {
      expect(text, `no line for phase ${phase}`).toContain(phase);
      const line = text.split("\n").find((l) => new RegExp(`^\\s+${phase}\\s`).test(l));
      expect(line).toBeDefined();
      expect(/last finished day \d+|\(never run\)|torn marker/.test(line ?? "")).toBe(true);
    }
  });

  test("a phase that has NEVER run says so — it does not read as quiet", () => {
    // A store that has never slept: no seed, no cycle, every marker unset.
    emptyStore();
    const text = stripAnsi(dash().status());
    for (const phase of CYCLE_PHASES) {
      const line = text.split("\n").find((l) => new RegExp(`^\\s+${phase}\\s`).test(l));
      expect(line, `no line for phase ${phase}`).toBeDefined();
      expect(line).toContain(NEVER);
    }
  });

  test("activity names EVERY durable event it is able to record, fired or not", async () => {
    await seed();
    const text = stripAnsi(dash().activity());
    for (const name of DURABLE_EVENT_NAMES) {
      expect(text, `no line for durable event ${name}`).toContain(name);
      expect(text).toContain(DURABLE_EVENTS[name]);
    }
    // The fixture promotes nothing, so `band.promoted` must SAY it never fired.
    const promoted = text
      .split("\n")
      .find((l) => l.includes("band.promoted") && l.includes("crossed into"));
    expect(promoted).toContain(NEVER);
    // And one that did fire carries a count instead.
    const pressure = text
      .split("\n")
      .find((l) => l.includes("revision.pressure") && l.includes("credited challenge"));
    expect(pressure).not.toContain(NEVER);
  });

  test("the census reads the LIVE band — a semantic-strength row is not filed under its birth column (review F6)", () => {
    const writable = Counterpart.open({ dir, owner: true });
    const id = writable.store.put({
      type: "memory",
      kind: "fact",
      body: "The storage split holds: prose canonical, one operational database, a rebuildable cache.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.8, predictive: 0.9 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    // The column is the birth fossil — nothing ever writes "semantic" to it...
    expect(writable.store.row(id)?.band).toBe("episodic");
    writable.close();
    // ...but the census the owner glances at counts the engine's arithmetic.
    const text = stripAnsi(dash().status());
    expect(text).toMatch(/semantic\s+1\b/);
    expect(text).not.toMatch(/episodic\s+1\b/);
  });

  test("the symmetry tripwire renders by REASON — a starved counter says never-asked, not healthy", () => {
    emptyStore();
    const text = stripAnsi(dash().status());
    expect(text).toContain("Band symmetry");
    // The fixture records no band transitions, so every kind must read
    // never-asked — ok:true must NEVER be rendered as within-expectation here.
    expect(text).toContain("never-asked");
    expect(text.includes("within-expectation")).toBe(false);
  });

  test("every registry axis survives an EMPTY store — five views, no throw", () => {
    emptyStore();
    const d = dash();
    for (const view of VIEWS) {
      const text = stripAnsi(d.render(view));
      expect(text.length).toBeGreaterThan(0);
      // Scar §2.4: an empty store is a displayed absence, never a blank screen.
      expect(text).toMatch(/\(none yet\)|\(never run\)/);
    }
    const status = stripAnsi(d.status());
    for (const axis of [...KINDS, ...BANDS, ...CYCLE_PHASES]) expect(status).toContain(axis);
    for (const name of DURABLE_EVENT_NAMES) expect(stripAnsi(d.activity())).toContain(name);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Render-time id resolution — never baked text
// ═══════════════════════════════════════════════════════════════════════════
describe("RENDER-TIME id resolution: ids in state, text at the moment of printing", () => {
  test("a superseded id renders what it BECAME, and says which address you asked for", async () => {
    const s = await seed();
    const opened = stripAnsi(dash().browse({ id: s.beliefId }));
    // The head, not the dead text.
    expect(opened).toContain(s.successorId);
    expect(opened).toContain("you asked for");
    expect(opened).toContain(s.beliefId);
    expect(opened).not.toContain("Ada prefers async review");
  });

  test("a REMOVED id renders a named absence, immediately, everywhere it appears", async () => {
    const s = await seed();
    // The owner takes one challenger dark. Nothing else changes.
    const writable = Counterpart.open({ dir, owner: true });
    writable.store.appendRemovalRecord({
      memoryId: s.challengerIds[0] as string,
      stage: "dark",
      actor: "owner",
      reason: "test",
    });
    writable.close();

    const d = dash();
    // In the resolver itself …
    const ref = resolveRef(d.store, s.challengerIds[0] as string);
    expect(ref.present).toBe(false);
    expect(ref.state).toBe("removed");
    expect(ref.text).toBe(null);
    expect(ref.label).toContain(ABSENCE.removed);
    // … in the story that quotes it as a challenger …
    const story = stripAnsi(d.stories());
    expect(story).toContain(ABSENCE.removed);
    expect(story).not.toContain("Ada asked for a live walkthrough");
    // … in the activity feed's resolved payload …
    const feed = stripAnsi(d.activity());
    expect(feed).toContain(ABSENCE.removed);
    expect(feed).not.toContain("Ada asked for a live walkthrough");
    // … and in the browse list, which still shows the row rather than dropping it.
    const list = stripAnsi(d.browse({ limit: 100 }));
    expect(list).toContain(ABSENCE.removed);
  });

  test("an id that never existed renders a named absence, not a crash and not a blank", () => {
    emptyStore();
    const d = dash();
    const ref = resolveRef(d.store, "mem_ffffffffffff");
    expect(ref.present).toBe(false);
    expect(ref.state).toBe("unknown");
    expect(ref.label).toContain(ABSENCE.unknown);
    expect(resolveRef(d.store, null).label).toBe(ABSENCE.none);
    expect(resolveRef(d.store, "  ").label).toBe(ABSENCE.none);
  });

  test("the activity feed resolves ids INSIDE payloads — the log carries no text", async () => {
    const s = await seed();
    const d = dash();
    const feed = stripAnsi(d.activity({ name: "revision.pressure" }));
    // The payload holds `challengerId` as a bare id (store §5 G10). The feed
    // shows the challenger's words, which it went and read just now.
    expect(feed).toContain("challengerId");
    // Bounded for the column, so the assertion is on the opening words it went
    // and read — the point is that they came from the memory, not the payload.
    expect(feed).toContain("Ada asked for a live walkthrough");
    // The durable row itself holds no such text — that is the invariant this
    // whole mechanism exists to make survivable.
    const raw = d.store.eventLog({ name: "revision.pressure", limit: 10 });
    expect(raw.length).toBeGreaterThan(0);
    for (const row of raw) expect(row.payload ?? "").not.toContain(CHALLENGES[0] ?? "");
    expect(s.beliefId.length).toBeGreaterThan(0);
  });

  test("`follow: false` reads the retained prose at THAT address, still at render time", async () => {
    const s = await seed();
    const d = dash();
    const followed = resolveRef(d.store, s.beliefId);
    const here = resolveRef(d.store, s.beliefId, { follow: false });
    expect(followed.headId).toBe(s.successorId);
    expect(here.headId).toBe(s.beliefId);
    expect(here.text).toContain("Ada prefers async review");
    expect(followed.text).not.toBe(here.text);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The five views
// ═══════════════════════════════════════════════════════════════════════════
describe("status — the brain at a glance", () => {
  test("it narrates the clock, the counts and the cycle in the first person", async () => {
    await seed();
    const text = stripAnsi(dash().status());
    expect(text).toContain("What I am, right now");
    expect(text).toMatch(/I have lived \d+ days/);
    expect(text).toContain("2026-08-04");
    expect(text).toMatch(/I am holding \d+ memor/);
    expect(text).toContain("By kind");
    expect(text).toContain("By band");
    expect(text).toContain("My last cycle");
    expect(text).toContain("What I have kept, and what I let go");
    expect(text).toContain("What I would say on waking");
    // The fixture ran a real boundary, so a briefing is waiting.
    expect(text).toMatch(/briefing composed and waiting: \d+ bytes/);
  });

  test("the journal is named beside the memories, never counted among them", async () => {
    // The counts are memories; an episode is the source one was made from, and
    // it is outside every sleep phase (`sleep/types.ts#isJournal`). Excluding it
    // silently would be the same census failure with better arithmetic.
    await seed();
    const c = Counterpart.open({ dir, owner: true });
    const before = stripAnsi(dash().status());
    expect(before).not.toContain("journal");
    const held = Number(/I am holding (\d+) memor/.exec(before)?.[1] ?? "0");

    c.store.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nThe account of the day.\n",
      source: "episode",
    });
    c.close();
    const after = stripAnsi(dash().status());
    expect(after).toMatch(new RegExp(`I am holding ${String(held)} memor`));
    expect(after).toContain("1 journal entry that do not decay");
  });

  test("it counts what is protected and what stands under challenge", async () => {
    await seed();
    const text = stripAnsi(dash().status());
    expect(text).toContain("protected");
    expect(text).toMatch(/Nothing has crossed into identity/);
  });

  test("exit counts are labelled SINCE BIRTH — never a per-cycle number it lacks", async () => {
    await seed();
    const text = stripAnsi(dash().status());
    expect(text).toContain("counted since birth");
    expect(text).toContain("pruned");
    expect(text).toContain("merged");
  });

  test("a view function takes a source, not a Dashboard — it is a pure renderer", async () => {
    await seed();
    const d = dash();
    expect(renderStatus(d.source, { style: PLAIN })).toBe(d.status());
  });
});

describe("browse — the memory list, and one memory opened", () => {
  test("the list carries strength and band for every memory, strongest first", async () => {
    const s = await seed();
    const text = stripAnsi(dash().browse({ limit: 100 }));
    expect(text).toContain("The memories I hold");
    expect(text).toContain("strength");
    expect(text).toContain("band");
    expect(text).toContain(s.authoredId);
    const rows = text
      .split("\n")
      .filter((l) => /^\s+\d\.\d\d\s/.test(l))
      .map((l) => Number(l.trim().split(/\s+/)[0]));
    expect(rows.length).toBeGreaterThan(3);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1] ?? 0).toBeGreaterThanOrEqual(rows[i] ?? 0);
    }
    for (const band of new Set(BANDS)) {
      // Every band the list actually shows is one the registry knows.
      expect(BANDS).toContain(band);
    }
  });

  test("the journal is skipped — an episode is not a memory, and the footer knows it", async () => {
    // `store.list()` returns the whole `memories` table, episodes included, and
    // the filter has no way to say "memories only". Left in, an episode renders
    // as `kind self`, `band episodic`, strength 0.00 — and the footer count is
    // off by one per lived day. `status.ts` already skips it; so does this.
    await seed();
    const before = stripAnsi(dash().browse({ limit: 100 }));
    const rowsBefore = before.split("\n").filter((l) => /^\s+\d\.\d\d\s/.test(l)).length;
    const countBefore = Number(/(\d+) memor(?:y|ies) match/.exec(before)?.[1] ?? "-1");
    expect(rowsBefore).toBeGreaterThan(0);
    expect(countBefore).toBe(rowsBefore);

    const c = Counterpart.open({ dir, owner: true });
    const epiId = c.store.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nThe account of the day.\n",
      source: "episode",
    });
    c.close();

    const after = stripAnsi(dash().browse({ limit: 100 }));
    expect(after.split("\n").filter((l) => /^\s+\d\.\d\d\s/.test(l)).length).toBe(rowsBefore);
    expect(Number(/(\d+) memor(?:y|ies) match/.exec(after)?.[1] ?? "-1")).toBe(countBefore);
    expect(after).not.toContain(epiId);
    // The single-episode view still opens: skipping it from the CENSUS is not
    // hiding it from the owner who asks for it by address.
    expect(stripAnsi(dash().browse({ id: epiId }))).toContain("The account of the day");
  });

  test("a filter that matches nothing says so, with the filter named", async () => {
    await seed();
    const text = stripAnsi(dash().browse({ kind: "place" }));
    expect(text).toContain(NONE);
    expect(text).toContain("kind place");
  });

  test("opening a memory names the RECORD it is — id, revision, content hash", async () => {
    const s = await seed();
    const d = dash();
    const row = d.store.row(s.authoredId);
    const text = stripAnsi(d.browse({ id: s.authoredId }));
    const line = text.split("\n").find((l) => l.trim().startsWith("record"));
    expect(line).toBeDefined();
    const said = (line ?? "").trim().replace(/^record\s+/, "");
    expect(said).toBe(`${s.authoredId} · rev ${row?.revision} · ${row?.content_hash}`);
    expect(row?.content_hash).not.toBe("");

    // Constitution line 6: the owner reads the store itself, so the hash printed
    // here has to ADDRESS the text shown below it — not merely equal a column.
    // The old version of this test opened the printed path and compared the file;
    // this is the same assertion without a filesystem in it, which is where the
    // shared store fixture is headed. `content_hash` is `hashText` over the
    // serialized document, so recomputing it from the document proves the pair.
    const doc = d.store.readProse(s.authoredId);
    expect(doc.body).toContain("storage split");
    expect(hashText(serializeProse(doc))).toBe(row?.content_hash as string);
    expect(stripAnsi(text)).toContain("storage split");
  });

  test("an opened memory resolves everything it points at, right now", async () => {
    const s = await seed();
    const text = stripAnsi(dash().browse({ id: s.protectedId }));
    expect(text).toContain("What it points at, resolved just now");
    expect(text).toContain("hangs on");
    // The entity is named by its TEXT, resolved from its id at this moment.
    expect(text).toContain("Ada");
    expect(text).toContain(s.entityId);
    expect(text).toContain("PROTECTED");
  });

  test("opening an id that is gone renders the named absence and nothing else", () => {
    emptyStore();
    const text = stripAnsi(dash().browse({ id: "mem_ffffffffffff" }));
    expect(text).toContain(ABSENCE.unknown);
  });
});

describe("stories — the revision narrative, from the durable log", () => {
  test("the contested belief is found, grouped by its head, and told once", async () => {
    const s = await seed();
    const d = dash();
    const groups = contestedBeliefs(d.source);
    // One belief was argued with, across two generations of the chain. ONE story.
    expect(groups.length).toBe(1);
    expect(groups[0]?.[0]).toBe(s.beliefId);
    expect(groups[0]?.[1]).toBe(s.successorId);
  });

  test("every challenge prints day, challenger, force, bar and verdict", async () => {
    const s = await seed();
    const text = stripAnsi(dash().stories());
    expect(text).toContain("How my beliefs have changed");
    expect(text).toContain("Every credited challenge, in the order it landed");
    const beats = text.split("\n").filter((l) => /^\s+day \d+\s+challenged by/.test(l));
    expect(beats.length).toBe(CHALLENGES.length);
    for (const beat of beats) {
      expect(beat).toMatch(/day \d+/);
      expect(beat).toMatch(/force \d\.\d\d/);
      expect(beat).toMatch(/pressure \d\.\d\d of \d\.\d\d/);
      expect(/held|REVISED|crossed the bar/.test(beat)).toBe(true);
    }
    // The story reads in the order it happened, and ends in the revision.
    expect(beats[0]).toContain("day 1");
    expect(beats[0]).toContain("held");
    expect(beats[beats.length - 1]).toContain("REVISED");
    expect(beats[beats.length - 1]).toContain(s.successorId);
  });

  test("it names what the belief began as and what it now says — both read live", async () => {
    const s = await seed();
    const text = stripAnsi(dash().stories({ id: s.beliefId }));
    expect(text).toContain("it began as");
    expect(text).toContain("Ada prefers async review");
    expect(text).toContain("it now says");
    expect(text).toContain(s.successorId);
    expect(text).toContain("about");
    expect(text).toContain(s.entityId);
    expect(text).toContain("the revision reset it");
  });

  test("the story is rebuilt from box 2, not from the session that made it", async () => {
    const s = await seed();
    // A brand-new process's worth of state: nothing in memory, everything read
    // back from the durable events table (SEAMS item K — v1 kept the pressure
    // number and lost the story).
    const d = dash();
    const story = d.source.schemas.story(s.beliefId);
    expect(story.increments.length).toBe(CHALLENGES.length);
    expect(story.headId).toBe(s.successorId);
    expect(story.lineage.some((l) => l.successorId === s.successorId)).toBe(true);
  });

  test("an episode carrying pressure is not a contested belief", async () => {
    // `contestedBeliefs` unions the durable pressure log with any row still
    // carrying pressure, and that second half walked the whole `memories` table.
    // Nothing argues with the account of a day: an episode admitted here would
    // open a story with no challenge log behind it.
    await seed();
    const c = Counterpart.open({ dir, owner: true });
    const epiId = c.store.put({
      type: "episode",
      kind: "self",
      body: "## chapter 2 — lived day 3\n\nThe account of another day.\n",
      source: "episode",
      physics: { pressure: 1 },
    });
    c.close();

    const d = dash();
    expect(stripAnsi(d.browse({ id: epiId }))).toContain("1.00 standing");
    expect(contestedBeliefs(d.source).flat()).not.toContain(epiId);
    expect(stripAnsi(d.stories())).not.toContain(epiId);
  });

  test("a store where nothing was ever argued with says exactly that", () => {
    emptyStore();
    const text = stripAnsi(dash().stories());
    expect(text).toContain(NONE);
    expect(text).toContain("has never had one");
  });
});

describe("identity — the band and the protected set, side by side", () => {
  test("both lists are rendered, and the empty one is marked absent", async () => {
    const s = await seed();
    const text = stripAnsi(dash().identity());
    expect(text).toContain("What I am made of");
    expect(text).toContain("Identity band");
    expect(text).toContain("Protected");
    // The fixture promotes NOTHING, so the identity band must say so.
    expect(text).toContain("Identity band — what strength earned (0)");
    expect(text).toContain(NONE);
    // And the protected element is enumerated, with its id, at render time.
    expect(text).toContain(s.protectedId);
    expect(text).toContain("Ada is the owner of this store");
  });

  test("it names the two cross-sections that make the pair worth reading together", async () => {
    await seed();
    const text = stripAnsi(dash().identity());
    expect(text).toContain("Both permanent AND constitutive");
    expect(text).toContain("Permanent, but outside the identity band");
    // Nothing is both here; something IS permanent-without-the-band. Scar §2.19.
    expect(text).toContain("nothing is both permanent and constitutive");
  });

  test("a protected element removed since stops resolving — its words are gone at once", async () => {
    const s = await seed();
    const before = stripAnsi(dash().identity());
    expect(before).toContain("Ada is the owner of this store");

    const writable = Counterpart.open({ dir, owner: true });
    writable.store.appendRemovalRecord({
      memoryId: s.protectedId,
      stage: "dark",
      actor: "owner",
      reason: "test",
    });
    writable.close();

    const after = stripAnsi(dash().identity());
    // The rule that matters: the text is gone the moment the memory is, because
    // it was never held here (scar §2.20). The dashboard shows no stale ink.
    expect(after).not.toContain("Ada is the owner of this store");
    // GAP CLOSED 2026-08-25 (BUILD-STATUS 4; scar §2.19 from the other side).
    // `self/enumerate` used to DROP an unreadable row silently, so the protected
    // list could not tell "removed" from "never there", and a permanent element
    // left the permanent list without a trace. It is now a NAMED absence in both
    // halves: still counted, still named by id, carrying the words in place of
    // the ink. This assertion is the one line of this file the removal work
    // changed, and it changed because the behavior it pinned was the bug.
    expect(after).toContain("Protected — permanent ink (1)");
    expect(after).toContain(s.protectedId);
    expect(after).toContain(ABSENCE.removed);
    expect(after).toContain("Identity-band rows I could not read just now");
  });

  test("it says whether the identity core exists, and names it when it does", async () => {
    // The gap this closes (cold-stranger review, 2026-09-04): this view rendered
    // identically for a store whose identity core had been seeded and one whose
    // had not — both show an empty band on day 0 — so a stranger who ran `init`
    // without `--name` had no way to learn that the thing the memory is ABOUT
    // did not exist.
    await seed();
    const unseeded = stripAnsi(dash().identity());
    expect(unseeded).toContain("No identity core yet");
    expect(unseeded).toContain("--name");

    const writable = Counterpart.open({ dir, owner: true, identity: { name: "Ada Lovelace" } });
    writable.close();

    const seededView = stripAnsi(dash().identity());
    expect(seededView).toContain("Identity core: seeded as Ada Lovelace");
    expect(seededView).not.toContain("No identity core yet");
  });

  test("an identity-band row that will not read is named, not silently dropped", async () => {
    const s = await seed();
    // Force the one recoverable half of the gap above: put a row in the identity
    // band, then remove it. `self/enumerate` drops it; the band still lists it.
    const writable = Counterpart.open({ dir, owner: true });
    writable.store.setBand(s.fillerIds[0] as string, "identity", writable.store.livedDay());
    writable.store.appendRemovalRecord({
      memoryId: s.fillerIds[0] as string,
      stage: "dark",
      actor: "owner",
      reason: "test",
    });
    writable.close();

    const text = stripAnsi(dash().identity());
    expect(text).toContain("Identity-band rows I could not read just now");
    expect(text).toContain(s.fillerIds[0] as string);
    expect(text).toContain(ABSENCE.removed);
    expect(text).not.toContain(FILLER[0]);
  });
});

describe("activity — the recent feed, resolved at render", () => {
  test("it shows the newest first, with the subject resolved to its words", async () => {
    await seed();
    const text = stripAnsi(dash().activity());
    expect(text).toContain("What has happened lately");
    expect(text).toMatch(/day \d+\s+\d{4}-\d{2}-\d{2}/);
    expect(text).toContain("revision.pressure");
    expect(text).toContain("The bounds of this feed");
    expect(text).toMatch(/Showing \d+ of \d+ events? I hold/);
  });

  test("it is honest about being bounded telemetry, not canonical memory", async () => {
    await seed();
    const text = stripAnsi(dash().activity());
    expect(text).toMatch(/I keep events for \d+ lived days/);
    expect(text).toContain("not everything that ever happened");
  });

  test("filters narrow it without hiding that they did", async () => {
    await seed();
    const all = stripAnsi(dash().activity()).split("\n").length;
    const some = stripAnsi(dash().activity({ name: "revision.pressure" }));
    expect(some.split("\n").length).toBeLessThan(all);
    expect(some).toContain("revision.pressure");
    expect(some).not.toContain("↳ event memory.merged");
  });

  test("floats are printed as readings, not as raw telemetry", async () => {
    await seed();
    const text = stripAnsi(dash().activity({ name: "revision.pressure" }));
    expect(text).toMatch(/force \d\.\d{3} /);
    expect(text).not.toMatch(/\d\.\d{6,}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The surface: names, dispatch, colour, and the thin entry script
// ═══════════════════════════════════════════════════════════════════════════
describe("the adapter's surface", () => {
  test("there are exactly five views, each with a one-line blurb", () => {
    expect([...VIEWS]).toEqual(["status", "browse", "stories", "identity", "activity"]);
    for (const view of VIEWS) {
      expect(VIEW_BLURB[view].length).toBeGreaterThan(20);
      expect(isViewName(view)).toBe(true);
    }
    expect(isViewName("dashboard")).toBe(false);
  });

  test("render() dispatches to the same string the named method returns", async () => {
    await seed();
    const d = dash();
    expect(d.render("status")).toBe(d.status());
    expect(d.render("browse")).toBe(d.browse());
    expect(d.render("stories")).toBe(d.stories());
    expect(d.render("identity")).toBe(d.identity());
    expect(d.render("activity")).toBe(d.activity());
    expect(d.all()).toContain(d.status());
  });

  test("colour is off by default, and adding it changes nothing but the escapes", async () => {
    await seed();
    const plain = dash().status();
    const coloured = dash({ colour: true }).status();
    expect(plain).not.toBe(coloured);
    expect(stripAnsi(coloured)).toBe(plain);
    expect(makeStyle(false).bold("x")).toBe("x");
    expect(makeStyle(true).bold("x")).not.toBe("x");
  });

  test("the entry script parses flags and renders a string, without a terminal", async () => {
    const s = await seed();
    expect(parseArgv(["status"]).view).toBe("status");
    expect(parseArgv([]).view).toBe("status");
    expect(parseArgv(["nonsense"]).view).toBe("help");
    expect(parseArgv(["browse", "--id", "mem_x"]).args.id).toBe("mem_x");
    expect(parseArgv(["browse", "--limit=5"]).args.limit).toBe(5);
    expect(parseArgv(["browse", "--archived"]).args.archived).toBe(true);

    const out = run(["browse", "--id", s.authoredId, "--dir", dir, "--no-colour"]);
    expect(stripAnsi(out)).toContain("storage split");
    expect(helpText()).toContain("observer mode");
    for (const view of VIEWS) expect(helpText()).toContain(view);
  });

  test("the console and this view agree, number for number, on the same store", async () => {
    // THE THREE-COUNTS BUG (2026-09-05): one demo store reported 143 live here
    // and in the console, 121 in the wake preface, and two different band
    // breakdowns — the console read the stored `band` column, a birth fossil
    // that is never "semantic", while this view computed the band from physics.
    // Both numbers were defensible and the reader had no way to reconcile them.
    // The fix is one arithmetic (`physics/band`) and one vocabulary; this test
    // is what keeps the two surfaces from drifting apart again.
    await seed();
    const c: string[] = [];
    const code = await runCli(["status", "--dir", dir], {
      io: { out: (l) => c.push(l), err: () => undefined },
    });
    expect(code).toBe(0);
    const console_ = c.join("\n");
    const view = stripAnsi(dash().status());

    const cliBands = /by band: episodic (\d+)\s+semantic (\d+)\s+identity (\d+)/.exec(console_);
    expect(cliBands).not.toBe(null);
    const viewBand = (name: string): string =>
      new RegExp(`${name}\\s+(\\d+)`).exec(view)?.[1] ?? "missing";
    expect(viewBand("episodic")).toBe((cliBands as RegExpExecArray)[1] as string);
    expect(viewBand("semantic")).toBe((cliBands as RegExpExecArray)[2] as string);
    expect(viewBand("identity")).toBe((cliBands as RegExpExecArray)[3] as string);

    // And the populations carry the same labels and the same numbers. The
    // console's `Memories:` is the number the wake preface states.
    const counts = /Memories: (\d+)\s+Beliefs and entities: (\d+)\s+Journal: (\d+)/.exec(console_);
    expect(counts).not.toBe(null);
    const [, memories, schemas, journal] = counts as RegExpExecArray;
    expect(view).toContain(`I am holding ${memories as string} memories`);
    expect(view).toContain(`${schemas as string} beliefs and entities`);
    // The journal clause appears only when there is one — this fixture writes no
    // episode, and a view that said "0 journal entries" would be noise. The
    // console prints the zero because its line is a fixed census.
    if (Number(journal) > 0) expect(view).toContain(`${journal as string} journal entries`);
    else expect(view).not.toContain("journal entries");

    // Not vacuous: this fixture really does hold memories AND schemas, which is
    // the split that was being added together and called "memories".
    expect(Number(memories)).toBeGreaterThan(0);
    expect(Number(schemas)).toBeGreaterThan(0);
    // And two different bands are populated, so the band comparison is real.
    expect(Number((cliBands as RegExpExecArray)[1])).toBeGreaterThan(0);
    expect(Number((cliBands as RegExpExecArray)[2])).toBeGreaterThan(0);
  });

  test("asking for help opens NO store — not even the default one", () => {
    // The incident this pins, from a claims audit on 2026-09-04: `--help` is a
    // flag, so it left no positional behind, and "no positional" meant `status`
    // — which opened the DEFAULT data dir, the owner's live memory, and rendered
    // a census of it to somebody who had typed `--help`. An instrument that
    // reads a store to answer "how do I use you" is the wart `status`'s own
    // observer stance exists to prevent, one level up.
    for (const argv of [["--help"], ["-h"], ["help"], ["--help", "--dir", "/nope"], ["serve", "--help"]]) {
      expect(parseArgv(argv).view).toBe("help");
    }

    // And `run()` returns the help text having touched nothing. The proof is a
    // byte-identical scratch directory: no store minted, no file created, no
    // mtime moved.
    const untouched = join(tmpdir(), `counterparts-help-${String(process.pid)}`);
    mkdirSync(untouched, { recursive: true });
    const before = readdirSync(untouched);
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      const out = run([...argv, "--dir", untouched]);
      expect(out).toBe(helpText());
      expect(out).toContain("observer mode");
    }
    expect(readdirSync(untouched)).toEqual(before);
    expect(existsSync(join(untouched, "operational.sqlite"))).toBe(false);
    rmSync(untouched, { recursive: true, force: true });
  });

  test("a store refusal reaches the owner as ONE SENTENCE, never a stack trace", async () => {
    await seed();
    // The exact mistake a stranger makes: the adapter's config written INSIDE
    // the data dir, where the layout check refuses it (§5 G11). Before the fix
    // this escaped `run()` as nine frames and exit 1 (LAUNCH-STATUS §I4).
    writeFileSync(join(dir, "claude-code.json"), "{}");
    const out = run(["status", "--dir", dir, "--no-colour"]);
    expect(out.split("\n").length).toBe(1);
    expect(out).toContain("LAYOUT_UNCLASSIFIED");
    expect(out).toContain("claude-code.json");
    // It teaches the rule the CLI's `init` teaches, in the same words.
    expect(out).toContain("BESIDE the store, never inside it");
    expect(out).toContain("§5 G11");
    expect(out).not.toContain("StoreError:");
    expect(out).not.toContain("    at ");
  });

  test("an absent store still gets its own sentence — the codes are not collapsed", () => {
    const nowhere = mkdtempSync(join(tmpdir(), "counterparts-absent-"));
    try {
      const out = run(["status", "--dir", nowhere, "--no-colour"]);
      expect(out.split("\n").length).toBe(1);
      expect(out).toContain(nowhere);
      expect(out).toContain("counterparts init");
    } finally {
      rmSync(nowhere, { recursive: true, force: true });
    }
  });

  test("a code the entry script has never heard of is still a sentence, not a stack", () => {
    // DATA_DIR_FORBIDDEN has no branch of its own in `describeStoreError`: the
    // default arm is what makes "every StoreError" true rather than "the two
    // codes this file happened to think of". It is also thrown by `dataDir()`
    // itself, so the handler must be able to name a dir without calling it.
    // Nothing is created — `store/paths.ts` refuses on path arithmetic alone,
    // before a directory exists (the guard `test/cli.test.ts` leans on too).
    const forbidden = join(homedir(), ".bansai", "dashboard-test-must-not-exist");
    const viaFlag = run(["status", "--dir", forbidden, "--no-colour"]);
    expect(viaFlag.split("\n").length).toBe(1);
    expect(viaFlag).toContain("DATA_DIR_FORBIDDEN");
    expect(viaFlag).not.toContain("    at ");

    // The other arm, and the one that bites the handler itself: with no `--dir`,
    // `dataDir()` is what throws, so naming the dir in the message cannot be
    // done by calling it.
    process.env[ENV] = forbidden;
    try {
      const viaEnv = run(["status", "--no-colour"]);
      expect(viaEnv.split("\n").length).toBe(1);
      expect(viaEnv).toContain("DATA_DIR_FORBIDDEN");
      expect(viaEnv).not.toContain("    at ");
    } finally {
      process.env[ENV] = dir;
    }
    expect(existsSync(forbidden)).toBe(false);
  });

  test("the explicit-dir guard refuses an unnamed store in ONE sentence naming the guard, the dir and the remedy (I21)", () => {
    // Armed for the suite by `test/preload.ts`. With the variable unset and no
    // `--dir`, `dataDir()` is what throws — so, as above, the handler names the
    // dir from the error's own detail rather than by calling it.
    delete process.env[ENV];
    try {
      const out = run(["status", "--no-colour"]);
      expect(out.split("\n").length).toBe(1);
      expect(out).toContain("refused:");
      expect(out).toContain("COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1");
      expect(out).toContain(join(homedir(), ".counterparts", "store"));
      expect(out).toContain("--dir");
      expect(out).toContain(ENV);
      expect(out).not.toContain("    at ");
      expect(out).not.toContain('{"guard"');

      // A value the guard cannot read: refused in a sentence, never fallen
      // through to the default (the #80 review's fail-open finding).
      process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "yes";
      const typo = run(["status", "--no-colour"]);
      expect(typo.split("\n").length).toBe(1);
      expect(typo).toContain("refused:");
      expect(typo).toContain("'yes'");
      expect(typo).toContain("1, true, on");
      expect(typo).not.toContain("    at ");
    } finally {
      process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
      process.env[ENV] = dir;
    }
    // An instrument that was refused created nothing, not even the parent.
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);
  });

  test("the entry script leaves the canonical boxes byte-identical too", async () => {
    await seed();
    // Canonical only: each `run()` opens its own Store, and `openCache` rewrites
    // box 3's schema-version row per open (INTERFACE-GAPS §1). Boxes 1 and 2 —
    // the prose and the operational database — do not move.
    const before = snapshot(dir, { canonicalOnly: true });
    run(["status", "--dir", dir]);
    run(["activity", "--dir", dir]);
    run(["identity", "--dir", dir]);
    run(["stories", "--dir", dir]);
    run(["browse", "--dir", dir]);
    expect(diff(before, snapshot(dir, { canonicalOnly: true }))).toEqual([]);
  });
});
