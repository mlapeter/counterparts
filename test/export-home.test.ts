/**
 * TAKING A HOSTED MEMORY HOME (EX1, 2026-11-04; evidence: the G2 check, a
 * hosted "Download my memory" file opened by a local install).
 *
 * The file is made the way hosted makes it: a store opened by the memory
 * server as claude.ai's host opens it (`toldSurface: "hosted"`), its starter
 * memories planted in hosted's words (`tenants.ts#startNewStore`), memories
 * written through `remember`, then the core's plaintext export
 * (`cli/export.ts#exportStore`, what `hosted/src/app.ts` calls). Only the
 * `.sqlite` travels, as in the download: no `cache/`.
 *
 * Then it is opened the way a person would: the console, as a child, in a
 * scratch HOME with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`. Checked:
 *   1. a question finds its memory with no `verify --rebuild` (the open
 *      rebuilt the empty word index, `Store#reindexIfEmpty`), and `doctor`
 *      ambers the index while only an observer has seen the file;
 *   2. the starter notes read as local, an edited one stays as written;
 *   3. the worker's embedding backfill gives the imported rows vectors, and a
 *      meaning-only question then finds its memory;
 *   4. the reverse (a local store opened by hosted's door), and a door that
 *      names no surface (the worker) switching nothing.
 *
 * Hermetic (CLAUDE.md): one temp dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LiveEmbedder } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { exportStore } from "../src/adapters/cli/export.js";
import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { INDEX_REBUILT_AT_OPEN_EVENT, Store } from "../src/core/store/index.js";
import { TOLD_SET_KEY, TOLD_SET_VERSION, TOLD_SURFACE_KEY, TOLD_SURFACE_REASON, plantTold, toldSet } from "../src/core/told.js";

const CLI = resolve(import.meta.dir, "../src/adapters/cli/bin/counterparts.ts");
const SERVE = resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts");
const SEEING = 3; // index in the set of #4 "show memory, don't announce it": the same on both surfaces
const NINE = 8; // "seeing and changing what I keep": differs by surface
const SEVEN = 6; // "turning memory on or off…": its TITLE differs by surface

let root = "";

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cp-export-home-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Three topics, one axis each; the sync face computes any text, as the live table does. */
function topic(t: string): number[] {
  const l = t.toLowerCase();
  if (l.includes("otter")) return [1, 0, 0];
  if (l.includes("kayak")) return [0, 1, 0];
  return [0, 0, 1];
}

function embedder(): LiveEmbedder {
  return {
    model: "test-embed-1",
    embed: (t: string) => topic(t),
    vector: async (t: string) => topic(t),
    warm: async (texts: readonly string[]) => texts.length,
    stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/** A question the embedder sends to the otter memory, sharing no content word with it. */
const MEANING_ONLY = "Hotter or warmer near the water, remind me?";

interface Exported {
  readonly file: string;
  readonly kayak: string;
  readonly otter: string;
  /** The starter #9 the person edited on hosted: it must stay theirs. */
  readonly edited: string;
}

/** A hosted store, written through the memory server as claude.ai's host opens it, then downloaded. */
async function hostedDownload(): Promise<Exported> {
  const dir = join(root, "hosted", "store");
  const server = openServer({
    dir,
    host: CLAUDE_AI_HOST,
    env: {},
    toldSurface: "hosted",
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
    manifestVersion: () => null,
  });
  try {
    const store = server.counterpart.store;
    plantTold(store, "hosted");
    const id = (r: { structuredContent?: unknown }): string => String((r.structuredContent as Record<string, unknown>)["id"]);
    const kayak = id(await server.call("remember", { session: "h1", title: "The blue kayak", text: "The owner keeps a blue kayak in the boathouse by the lake." }));
    const otter = id(await server.call("remember", { session: "h1", title: "The otter survey", text: "The otter survey on the river counted eleven holts this spring." }));
    expect(kayak).toMatch(/^mem_/);
    expect(otter).toMatch(/^mem_/);
    // The person corrected one starter note on hosted: it is theirs now.
    const nine = store.toldIds().map((i) => store.row(i)!).find((r) => r.title === toldSet("hosted")[NINE]!.title)!;
    store.revise(nine.id, { body: `${nine.body} (And I keep a list.)`, reason: "corrected" });
    const target = join(root, "hosted", "out");
    const report = exportStore(store, { target, plaintext: true });
    expect(report.ok).toBe(true);
    const name = readdirSync(target).find((n) => n.endsWith(".sqlite"));
    expect(name).toBeDefined();
    return { file: join(target, name!), kayak, otter, edited: nine.id };
  } finally {
    server.counterpart.close();
  }
}

/** The download put in place: a store folder holding the one file, nothing else. */
function putInPlace(file: string): string {
  const store = join(root, "local", "store");
  mkdirSync(store, { recursive: true });
  copyFileSync(file, join(store, "counterparts.sqlite"));
  return store;
}

/** The console, as a child, in a scratch HOME. */
function cli(args: string[]): { status: number | null; out: string } {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const r = spawnSync(process.execPath, ["run", CLI, ...args], {
    cwd: root,
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      COUNTERPARTS_UPDATE_CHECK: "off",
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/**
 * A Claude Code session's memory server: `mcp/bin/serve.ts` over stdio, as the
 * install registers it, with the install's config. It answers `initialize` and
 * exits when stdin closes. Its open is the first writable one the file sees.
 */
function session(store: string): string {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const config = join(root, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000, snapshots: { daily: false } }), "utf8");
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  const r = spawnSync(process.execPath, ["run", SERVE], {
    cwd: root,
    input: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      COUNTERPARTS_UPDATE_CHECK: "off",
      COUNTERPARTS_DATA_DIR: store,
      COUNTERPARTS_CONFIG: config,
      CLAUDE_PROJECT_DIR: root,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(r.stdout).toContain('"id":2');
  return r.stdout;
}

describe("a hosted download opened by a local install", () => {
  test("the first session's open rebuilds the empty word index: the console's question then finds its memory with no verify --rebuild; until then ask and doctor say why", async () => {
    const ex = await hostedDownload();
    const store = putInPlace(ex.file);

    // Only an observer has seen it: the index is empty, and doctor says so.
    const observed = Store.open({ dir: store, observer: true });
    try {
      expect(observed.wordIndexEmpty()).toBe(true);
    } finally {
      observed.close();
    }
    const doctor = cli(["doctor", "--dir", store, "--json"]);
    const findings = JSON.parse(doctor.out.slice(doctor.out.indexOf("{"), doctor.out.lastIndexOf("}") + 1)) as { findings: { key: string; severity: string; fix: string }[] };
    const index = findings.findings.find((f) => f.key === "word-index");
    expect(index?.severity).toBe("amber");
    expect(index?.fix).toContain("counterparts verify --rebuild");

    // `ask` only looks (owner, 2026-09-25): before any writable open it says why nothing came.
    const early = cli(["ask", "what kayak does the owner keep", "--dir", store]);
    expect(early.out).toContain("Nothing found");
    expect(early.out).toContain("word index is empty");

    // The first Claude Code session opens it (writable): then the answer is there at once.
    session(store);
    const asked = cli(["ask", "what kayak does the owner keep", "--dir", store]);
    expect(asked.out).not.toContain("Nothing found");
    expect(asked.out).toContain(ex.kayak);

    const s = Store.open({ dir: store, observer: true });
    try {
      expect(s.wordIndexEmpty()).toBe(false);
      const rows = s.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT });
      expect(rows).toHaveLength(1);
      // Every live row: 2 lived + 11 starters (+ whatever the server's open made).
      expect(Number(JSON.parse(rows[0]!.payload ?? "{}")["indexed"])).toBeGreaterThanOrEqual(13);
    } finally {
      s.close();
    }
    // Once rebuilt, a second open writes no second row.
    session(store);
    const again = Store.open({ dir: store, observer: true });
    try {
      expect(again.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT })).toHaveLength(1);
    } finally {
      again.close();
    }
  }, 60_000);

  test("the starter notes read as local after that open: same ids, the hosted words kept as a version; the one the person edited stays", async () => {
    const ex = await hostedDownload();
    const store = putInPlace(ex.file);
    const before = Store.open({ dir: store, observer: true });
    const ids = before.toldIds();
    before.close();
    expect(ids).toHaveLength(11);

    session(store);

    const s = Store.open({ dir: store, observer: true });
    try {
      expect(s.getMeta(TOLD_SURFACE_KEY)).toBe("local");
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
      expect(s.toldIds().sort()).toEqual([...ids].sort());
      const local = toldSet("local");
      const hosted = toldSet("hosted");
      const rows = s.toldIds().map((i) => s.row(i)!);
      for (const [i, m] of local.entries()) {
        if (i === NINE) continue;
        const row = rows.find((r) => r.title === m.title);
        expect(row?.body).toBe(m.body);
        expect(row?.source).toBe("told");
      }
      // #7's title changed with its words; the hosted ones are a version behind it.
      const seven = rows.find((r) => r.title === local[SEVEN]!.title)!;
      expect(s.versions(seven.id).map((v) => v.reason)).toContain(TOLD_SURFACE_REASON);
      expect(s.versions(seven.id).some((v) => v.body === hosted[SEVEN]!.body)).toBe(true);
      // One that read the same on both surfaces was not touched.
      const same = rows.find((r) => r.title === local[SEEING]!.title)!;
      expect(s.versions(same.id).map((v) => v.reason)).not.toContain(TOLD_SURFACE_REASON);
      // The person's edit stays: hosted's words and theirs, not local's.
      const edited = s.row(ex.edited)!;
      expect(edited.body).toContain("(And I keep a list.)");
      expect(edited.body).not.toBe(local[NINE]!.body);
    } finally {
      s.close();
    }
  }, 60_000);

  test("the worker's backfill gives the imported rows vectors, then a meaning-only question finds its memory", async () => {
    const ex = await hostedDownload();
    const store = putInPlace(ex.file);
    // The file carries no vector: box 3 never travels.
    const s0 = Store.open({ dir: store, observer: true });
    const missing = s0.unembeddedCount();
    s0.close();
    expect(missing).toBeGreaterThanOrEqual(13);

    // The worker, as a boundary spawns it, with the embedder injected, is the
    // first writable open here: its open rebuilds the words (and computes no
    // vector), then its bounded backfill gives every row one.
    const emb = embedder();
    const report = await runOnce({ config: { dataDir: store, snapshots: { daily: false } }, embedder: emb });
    expect(report.backfill?.embedded ?? 0).toBe(missing);
    expect(report.backfill?.remaining).toBe(0);
    const s1 = Store.open({ dir: store, observer: true });
    try {
      expect(s1.wordIndexEmpty()).toBe(false);
      expect(s1.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT })).toHaveLength(1);
      // The worker names no surface: the starters keep hosted's words until a local door opens it.
      expect(s1.getMeta(TOLD_SURFACE_KEY)).toBe("hosted");
    } finally {
      s1.close();
    }

    const c = Counterpart.open({ dir: store, embed: emb.embed, toldSurface: "local" });
    try {
      const server = new McpServer({ counterpart: c, session: "s-home", scope: root, registryDir: store, embedder: emb });
      const r = await server.call("recall", { session: "s-home", question: MEANING_ONLY, mode: "meaning" });
      expect(r.isError).not.toBe(true);
      expect(JSON.stringify(r.structuredContent)).toContain(ex.otter);
    } finally {
      c.close();
    }
  }, 60_000);
});

describe("the surface a door names", () => {
  test("a local store opened by hosted's door reads as hosted; a door that names none (the worker) switches nothing", () => {
    const dir = join(root, "store");
    const made = Store.open({ dir });
    plantTold(made, "local");
    made.close();

    // The worker names no surface: the local words stay.
    Counterpart.open({ dir }).close();
    const kept = Store.open({ dir, observer: true });
    try {
      expect(kept.getMeta(TOLD_SURFACE_KEY)).toBe("local");
    } finally {
      kept.close();
    }

    const server = openServer({ dir, host: CLAUDE_AI_HOST, env: {}, toldSurface: "hosted", lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 1 }) }, manifestVersion: () => null });
    server.counterpart.close();
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.getMeta(TOLD_SURFACE_KEY)).toBe("hosted");
      const bodies = s.toldIds().map((i) => s.row(i)!.body).sort();
      expect(bodies).toEqual(toldSet("hosted").map((m) => m.body).sort());
    } finally {
      s.close();
    }
  });

  test("an observer open of the other surface's store writes nothing, and the word index stays as it was", () => {
    const dir = join(root, "store");
    const made = Store.open({ dir });
    plantTold(made, "hosted");
    made.close();
    rmSync(join(dir, "cache"), { recursive: true, force: true });
    Counterpart.open({ dir, observer: true, toldSurface: "local" }).close();
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.getMeta(TOLD_SURFACE_KEY)).toBe("hosted");
      expect(s.wordIndexEmpty()).toBe(true);
    } finally {
      s.close();
    }
  });

  test("the at-open rebuild indexes words only: a vector the cache already holds is kept, none is computed", () => {
    const dir = join(root, "store");
    const emb = embedder();
    const made = Store.open({ dir, embed: emb.embed });
    const otter = made.put({ type: "memory", kind: "fact", title: "The otter survey", body: "The otter survey on the river counted eleven holts this spring." });
    made.put({ type: "memory", kind: "fact", body: "A second memory about the kayak." });
    // The words gone, the vectors kept: the index alone is empty.
    (made as unknown as { cache: { exec: (sql: string) => void } }).cache.exec("DELETE FROM doc_tokens; DELETE FROM doc_lens;");
    const vectors = made.embeddingCount();
    made.close();
    expect(vectors).toBe(2);

    let calls = 0;
    const s = Store.open({ dir, embed: (t: string) => ((calls += 1), topic(t)) });
    try {
      expect(s.wordIndexEmpty()).toBe(false);
      expect(calls).toBe(0);
      expect(s.embeddingCount()).toBe(2);
      expect(s.search("otter survey").map((h) => h.id)).toContain(otter);
    } finally {
      s.close();
    }
  });
});

describe("the word index of another file, and one with nothing to index", () => {
  test("a download dropped over an EXISTING local store's database (the old cache left beside it): the next writable open rebuilds from this file", async () => {
    const ex = await hostedDownload();
    // An existing local install, used: its cache is full of its own ids.
    const dir = join(root, "local", "store");
    const l = Store.open({ dir });
    plantTold(l, "local");
    const garden = l.put({ type: "memory", kind: "fact", title: "Garden", body: "The tomatoes went in on Saturday." });
    expect(l.search("tomatoes").map((h) => h.id)).toContain(garden);
    l.close();
    // The old way: only the database replaced.
    copyFileSync(ex.file, join(dir, "counterparts.sqlite"));

    session(dir);
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.search("kayak").map((h) => h.id)).toContain(ex.kayak);
      expect(s.search("tomatoes")).toEqual([]);
      const rows = s.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT });
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.payload ?? "{}")["foreign"]).toBe(true);
    } finally {
      s.close();
    }
    // Once rebuilt it is this file's: the next open writes nothing.
    session(dir);
    const again = Store.open({ dir, observer: true });
    try {
      expect(again.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT })).toHaveLength(1);
    } finally {
      again.close();
    }
  }, 60_000);

  test("a store whose live rows give the index nothing (CJK only), opened 4 times: one rebuild attempt at most, no event, and doctor isn't amber", () => {
    const dir = join(root, "store");
    const made = Store.open({ dir });
    made.put({ type: "memory", kind: "fact", body: "東京で会議がありました。" });
    made.put({ type: "memory", kind: "fact", body: "明日は雨です。" });
    made.close();
    rmSync(join(dir, "cache"), { recursive: true, force: true });
    for (let i = 0; i < 4; i += 1) Store.open({ dir }).close();
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.eventLog({ name: INDEX_REBUILT_AT_OPEN_EVENT }).length).toBeLessThanOrEqual(1);
      expect(s.wordIndexEmpty()).toBe(false);
    } finally {
      s.close();
    }
  });
});

describe("the two surfaces' starter sets", () => {
  test("are the same length, with the same titles in the same places, but #7", () => {
    const local = toldSet("local");
    const hosted = toldSet("hosted");
    expect(local.length).toBe(hosted.length);
    for (let i = 0; i < local.length; i += 1) {
      if (i === SEVEN) expect(local[i]!.title).not.toBe(hosted[i]!.title);
      else expect(local[i]!.title).toBe(hosted[i]!.title);
    }
  });
});
