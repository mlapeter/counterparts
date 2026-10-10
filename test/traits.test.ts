/**
 * Trait nudges on a memory (folded into the unreleased schema v9, 2026-09-27;
 * the owner's design, held lightly): the seven-axis vocabulary, the store's
 * `traits` table and its read-only readers, the three write doors (`note`,
 * `session_end` entries, the reflection's `finish`), removal, a dream's merge,
 * the export, the fired row — and that nothing else moves: traits are display
 * only.
 *
 * Hermetic: a fresh temp root per test (the store in `root/store`, snapshots
 * beside it), removed after.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { firedReport } from "../src/adapters/fired.js";
import { TOOLS, openServer, renderDescription } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { SCHEMA_VERSION, Store, TRAIT_AXES, isStoreError, paths } from "../src/core/store/index.js";
import type { PutInput, StoreOptions } from "../src/core/store/index.js";
import { CREATED_TABLES, DDL, DDL_AFTER_COLUMNS } from "../src/core/store/operational.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

let root: string;
let dir: string;
let snaps: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-traits-"));
  dir = join(root, "store");
  snaps = join(root, "snaps");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}): Store {
  const s = Store.open({ dir, snapshotsDir: snaps, ...opts });
  open.push(s);
  return s;
}

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return isStoreError(err) ? `${err.code}:${String(err.detail["reason"] ?? "")}` : String(err);
  }
}

const mem = (s: Store, body = "I told him the plan had a hole in it before he shipped it.", over: Partial<PutInput> = {}) =>
  s.put({ type: "memory", kind: "self", body, ...over });

const candid = { axis: "agreeable-candid", toward: "candid", strength: 0.6, carriedBy: "said the plan had a hole" };

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

describe("the vocabulary: seven axes, each between two good things", () => {
  test("seven fixed axes, the first pole roughly where training puts me", () => {
    expect(TRAIT_AXES.map((a) => a.poles.join("↔"))).toEqual([
      "careful↔bold",
      "agreeable↔candid",
      "guarded↔open",
      "focused↔curious",
      "following↔initiating",
      "inward↔outward",
      "serious↔playful",
    ]);
    expect(TRAIT_AXES.map((a): string => a.id)).toEqual(TRAIT_AXES.map((a) => a.poles.join("-")));
  });

  test("the tool schemas name the same seven axes and fourteen poles as the store", () => {
    const note = TOOLS.find((t) => t.name === "remember")?.inputSchema as {
      properties: { traits: { items: { properties: { axis: { enum: string[] }; toward: { enum: string[] } } } } };
    };
    expect(note.properties.traits.items.properties.axis.enum).toEqual(TRAIT_AXES.map((a): string => a.id));
    expect(note.properties.traits.items.properties.toward.enum).toEqual(TRAIT_AXES.flatMap((a) => [...a.poles]));
    for (const name of ["remember", "session_end"]) {
      const spec = TOOLS.find((t) => t.name === name);
      const text = JSON.stringify(spec?.inputSchema);
      for (const a of TRAIT_AXES) expect(text).toContain(a.id);
      expect(text).toContain("most carry none");
      expect(text).toContain("Don't make up depth");
      expect(renderDescription(spec!).length).toBeGreaterThan(0);
    }
    const reflect = JSON.stringify(TOOLS.find((t) => t.name === "reflect")?.inputSchema);
    expect(reflect).toContain("serious-playful");
  });

  test("an unknown axis or pole is refused by name, with what is allowed; the call writes nothing", () => {
    const s = store();
    const id = mem(s);
    expect(code(() => s.addTraits(id, [{ ...candid, axis: "bravery" }]))).toBe("TRAIT_INVALID:axis-unknown");
    expect(code(() => s.addTraits(id, [{ ...candid, axis: "candid" }]))).toBe("TRAIT_INVALID:axis-is-a-pole");
    expect(code(() => s.addTraits(id, [{ ...candid, toward: "bold" }]))).toBe("TRAIT_INVALID:toward-on-another-axis");
    expect(code(() => s.addTraits(id, [{ ...candid, toward: "blunt" }]))).toBe("TRAIT_INVALID:toward-unknown");
    expect(code(() => s.addTraits(id, [{ ...candid, strength: 1.5 }]))).toBe("TRAIT_INVALID:strength-out-of-range");
    // An over-long carried_by is kept to its length and said, never refused (2026-09-28).
    const long = mem(s);
    const kept = s.addTraits(long, [{ ...candid, carriedBy: "x".repeat(1_001) }]);
    expect(kept.repairs.map((r) => r.field)).toEqual(["carried_by"]);
    expect(s.traitsFor(long)[0]?.carried_by.length).toBe(1_000);
    // All or none: a good nudge beside a bad one is not stored either.
    expect(code(() => s.addTraits(id, [candid, { ...candid, axis: "bravery" }]))).toBe("TRAIT_INVALID:axis-unknown");
    expect(s.traitsFor(id)).toEqual([]);
    try {
      s.addTraits(id, [{ ...candid, toward: "bold" }]);
    } catch (err) {
      expect(isStoreError(err) ? err.detail : {}).toMatchObject({ allowed: "agreeable|candid", axisOfPole: "careful-bold" });
    }
  });
});

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

describe("the store: recorded once, read by the dashboard, feeding nothing", () => {
  test("addTraits stores each nudge with its source and model; the readers return them with memory ids", () => {
    let at = Date.parse("2026-09-27T12:00:00Z");
    const s = store({ now: () => at });
    const a = mem(s);
    const b = mem(s, "I asked to try the migration myself before he wrote it.");
    const out = s.addTraits(a, [candid], { model: "claude-opus-5-5" });
    expect(out.ids.length).toBe(1);
    at += 60_000;
    s.addTraits(b, [{ axis: "following-initiating", toward: "initiating", strength: 0.4 }], { source: "reflection" });
    expect(s.traitsFor(a)).toEqual([
      expect.objectContaining({
        memory_id: a,
        axis: "agreeable-candid",
        toward: "candid",
        strength: 0.6,
        carried_by: "said the plan had a hole",
        source: "session",
        model: "claude-opus-5-5",
        confidential: false,
        withheld: false,
      }),
    ]);
    expect(s.traitsFor(b)[0]?.source).toBe("reflection");
    const on = s.traitsOn([a, b, "mem_none"]);
    expect([...on.keys()].sort()).toEqual([a, b].sort());
    expect(s.traitsAll().map((t) => t.memory_id)).toEqual([a, b]);
    expect(s.traitsAll({ sinceMs: at }).map((t) => t.memory_id)).toEqual([b]);
    expect(s.traitCensus()).toEqual({ memories: 2, nudges: 2 });
    expect(s.traitCensus({ sinceMs: at })).toEqual({ memories: 1, nudges: 1 });
  });

  test("display only: a nudge moves no salience, no physics, no feeling peak", () => {
    const s = store();
    const plain = mem(s, "A memory with no nudge on it at all, for comparison.");
    const nudged = mem(s, "A memory with three strong nudges on it, for comparison.");
    s.addTraits(nudged, [
      { axis: "careful-bold", toward: "bold", strength: 1 },
      { axis: "guarded-open", toward: "open", strength: 1 },
      { axis: "serious-playful", toward: "playful", strength: 1 },
    ]);
    const { id: _p, ...p } = s.physicsOf(plain) as unknown as Record<string, unknown>;
    const { id: _n, ...n } = s.physicsOf(nudged) as unknown as Record<string, unknown>;
    expect(n).toEqual(p);
    expect(s.row(nudged)?.feeling_peak ?? null).toBe(null);
  });

  test("a confidential memory's nudge keeps its numbers and withholds its words, unless asked", () => {
    const s = store();
    const secret = mem(s, "The private thing he told me, which I answered honestly.", { meta: { confidential: true } });
    s.addTraits(secret, [candid]);
    const [t] = s.traitsFor(secret);
    expect(t).toMatchObject({ axis: "agreeable-candid", toward: "candid", strength: 0.6, carried_by: "", confidential: true, withheld: true });
    expect(s.traitsAll()[0]?.carried_by).toBe("");
    expect(s.traitsOn([secret]).get(secret)?.[0]?.carried_by).toBe("");
    expect(s.traitsFor(secret, { includeConfidential: true })[0]).toMatchObject({ carried_by: "said the plan had a hole", withheld: false });
  });

  test("an archived or superseded memory's nudges leave the all-read (unless asked) and the census", () => {
    const s = store();
    const a = mem(s);
    s.addTraits(a, [candid]);
    s.archive(a, "faded");
    expect(s.traitsAll()).toEqual([]);
    expect(s.traitsAll({ live: false }).length).toBe(1);
    expect(s.traitCensus()).toEqual({ memories: 0, nudges: 0 });
  });

  test("the owner's removal takes a memory's nudges with it", () => {
    const s = store();
    const id = mem(s);
    const keep = mem(s, "A memory that stays, with its own nudge.");
    s.addTraits(id, [{ ...candid, carriedBy: "private words" }]);
    s.addTraits(keep, [candid]);
    s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, id);
    expect(s.traitsFor(id)).toEqual([]);
    expect(s.traitsFor(keep).length).toBe(1);
    const db = new Database(paths.operational(dir), { readonly: true });
    expect(db.query("SELECT COUNT(*) AS n FROM traits WHERE memory_id = ?").get(id)).toEqual({ n: 0 });
    db.close();
  });

  test("under observer: the readers work, the write is refused", () => {
    const w = store();
    const id = mem(w);
    w.addTraits(id, [candid]);
    w.close();
    open.splice(0);
    const o = store({ observer: true });
    expect(o.traitsFor(id).length).toBe(1);
    expect(o.traitCensus()).toEqual({ memories: 1, nudges: 1 });
    expect(code(() => o.addTraits(id, [candid]))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the schema: folded into v9, no v10
// ---------------------------------------------------------------------------

describe("the schema: folded into the unreleased v9", () => {
  test("the version is v9 or later (v10 added contradictions beside it)", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
  });

  test("a development store stamped v9 before the table existed gains it at its next writer open; an observer reads it as empty until then", () => {
    const s = store();
    const id = mem(s);
    s.close();
    open.splice(0);
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE traits");
    db.close();
    // An observer does not write: it reads the missing table as empty.
    const o = store({ observer: true });
    expect(o.traitsFor(id)).toEqual([]);
    expect(o.traitsAll()).toEqual([]);
    expect(o.traitsOn([id]).size).toBe(0);
    expect(o.traitCensus()).toEqual({ memories: 0, nudges: 0 });
    o.close();
    open.splice(0);
    // A writer adds it, with no copy taken (nothing that exists changes shape).
    const w = store();
    expect(w.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    w.addTraits(id, [candid]);
    expect(w.traitsFor(id).length).toBe(1);
    const check = new Database(paths.operational(dir), { readonly: true });
    expect(check.query("SELECT name FROM sqlite_master WHERE name = 'traits_memory'").get()).toEqual({ name: "traits_memory" });
    check.close();
  });

  test("a v8 store gains the table at the upgrade, every memory untagged", () => {
    const s = store();
    const id = mem(s);
    s.close();
    open.splice(0);
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE traits");
    db.run("UPDATE meta SET value = '8' WHERE key = 'schemaVersion'");
    db.close();
    const after = store();
    expect(after.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(after.traitsFor(id)).toEqual([]);
    expect(after.traitCensus()).toEqual({ memories: 0, nudges: 0 });
    after.addTraits(id, [candid]);
    expect(after.traitsFor(id).length).toBe(1);
  });

  test("every schema statement is idempotent: CREATE … IF NOT EXISTS and nothing else (ensureCurrentTables re-runs them on current stores)", () => {
    const all = [...DDL, ...DDL_AFTER_COLUMNS];
    expect(all.length).toBeGreaterThan(0);
    for (const sql of all) {
      // SQL comments may say anything (two carry a semicolon in their prose).
      const text = sql
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/--[^\n]*/g, " ")
        .trim()
        .replace(/;\s*$/, "")
        // A trigger's body (v13, 2026-10-10) is part of its one statement.
        .replace(/\bBEGIN\b[\s\S]*\bEND$/i, "BEGIN END");
      // One statement each: no second statement hiding after a semicolon.
      expect({ sql: text.slice(0, 80), single: !text.includes(";") }).toEqual({ sql: text.slice(0, 80), single: true });
      expect({
        sql: text.slice(0, 80),
        idempotent: /^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s/i.test(text),
      }).toEqual({ sql: text.slice(0, 80), idempotent: true });
    }
    // And in fact: running everything twice over one database is a no-op the second time.
    const db = new Database(":memory:");
    try {
      for (const pass of [1, 2]) {
        for (const sql of all) {
          expect({ pass, ok: (() => { db.run(sql); return true; })() }).toEqual({ pass, ok: true });
        }
      }
    } finally {
      db.close();
    }
  });

  test("CREATED_TABLES names every table DDL creates — read off the text loosely, and off what SQLite actually made", () => {
    const loose = DDL.flatMap((sql) => {
      const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?(\w+)/i.exec(sql);
      return m === null ? [] : [m[1] as string];
    });
    expect([...CREATED_TABLES].sort()).toEqual([...loose].sort());
    const db = new Database(":memory:");
    try {
      for (const sql of DDL) db.run(sql);
      const made = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
      expect([...CREATED_TABLES].sort()).toEqual(made.sort());
    } finally {
      db.close();
    }
    expect(CREATED_TABLES).toContain("traits");
  });

  test("a fresh store and a store that gained the table later have the same table shape", () => {
    const s = store();
    s.close();
    open.splice(0);
    const shape = (): unknown => {
      const db = new Database(paths.operational(dir), { readonly: true });
      const cols = db.query("PRAGMA table_info(traits)").all();
      db.close();
      return cols;
    };
    const fresh = shape();
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE traits");
    db.close();
    store().close();
    open.splice(0);
    expect(shape()).toEqual(fresh);
  });
});

// ---------------------------------------------------------------------------
// the MCP doors
// ---------------------------------------------------------------------------

describe("the MCP doors: note and session_end", () => {
  function server(): McpServer {
    const s = openServer({ dir, scope: "/tmp/traits-project", owner: true, bundlesAsOwner: true });
    open.push({ close: () => s.counterpart.close() });
    return s;
  }
  const payload = (r: { structuredContent?: unknown }): Record<string, unknown> =>
    (r.structuredContent ?? {}) as Record<string, unknown>;

  test("note: nudges land beside the memory, secrets scrubbed from what carried them", async () => {
    const s = server();
    const out = payload(
      await s.call("remember", {
        text: "I pushed back on the release plan and said the migration had to go first.",
        traits: [
          { axis: "agreeable-candid", toward: "candid", strength: 0.7, carried_by: "pushed back, key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
          { axis: "following-initiating", toward: "initiating", strength: 0.3 },
        ],
      }),
    );
    expect(out["stored"]).toBe(true);
    expect(out["traits"]).toEqual({ stored: 2 });
    const rows = s.counterpart.store.traitsFor(out["id"] as string);
    expect(rows.map((r) => r.toward)).toEqual(["candid", "initiating"]);
    expect(rows[0]?.carried_by).not.toContain("sk-ant-api03");
    expect(rows[0]?.source).toBe("session");
  });

  test("note: an unknown axis or a pole on the wrong axis refuses the note before it mints, and says what is allowed", async () => {
    const s = server();
    const bad = payload(
      await s.call("remember", {
        text: "A note whose nudge names an axis that is not one of the seven.",
        traits: [{ axis: "bravery", toward: "bold", strength: 0.5 }],
      }),
    );
    expect([bad["stored"], bad["reason"]]).toEqual([false, "traits-malformed"]);
    expect(String(bad["detail"])).toContain("axis-unknown");
    expect(String(bad["detail"])).toContain("careful-bold");
    const wrong = payload(
      await s.call("remember", {
        text: "A note whose nudge names a pole from another axis.",
        traits: [{ axis: "careful-bold", toward: "candid", strength: 0.5 }],
      }),
    );
    expect(wrong["reason"]).toBe("traits-malformed");
    expect(String(wrong["detail"])).toContain("careful|bold");
    expect(String(wrong["detail"])).toContain("agreeable-candid");
    for (const traits of ["candid", [null], [{ axis: 1, toward: "bold", strength: 0.5 }], [{ axis: "careful-bold", toward: "bold", strength: 0.5, carried_by: {} }]]) {
      const out = payload(await s.call("remember", { text: `A note with malformed traits: ${JSON.stringify(traits)}.`, traits }));
      expect(out["reason"]).toBe("traits-malformed");
    }
    expect(s.counterpart.store.list({ type: "memory" })).toEqual([]);
  });

  test("a duplicate note says its nudges were not stored", async () => {
    const s = server();
    const text = "I chose to say I did not know rather than guess at the kiln's temperature.";
    await s.call("remember", { text });
    const again = payload(await s.call("remember", { text, traits: [{ axis: "careful-bold", toward: "careful", strength: 0.4 }] }));
    expect(again["stored"]).toBe(false);
    expect((again["traits"] as Record<string, unknown>)["reason"]).toBe("memory-not-stored");
  });

  test("session_end: per entry — a bad nudge refuses its own entry, its sibling lands with its nudge and the session's model", async () => {
    recordSession(dir, { sessionId: "s-traits", scope: "/tmp/traits-project", phase: "start", model: "claude-opus-5-5" });
    const s = server();
    const out = payload(
      await s.call("session_end", {
        session: "s-traits",
        memories: [
          {
            content: "I suggested we stop and write the test first, and he agreed.",
            traits: [{ axis: "following-initiating", toward: "initiating", strength: 0.5, carried_by: "suggested stopping" }],
          },
          { content: "A second entry whose nudge is out of range.", traits: [{ axis: "careful-bold", toward: "bold", strength: 3 }] },
        ],
      }),
    );
    const [good, bad] = out["outcomes"] as Record<string, unknown>[];
    expect(good?.["stored"]).toBe(true);
    expect(good?.["traits"]).toEqual({ stored: 1 });
    expect(s.counterpart.store.traitsFor(good?.["id"] as string)[0]?.model).toBe("claude-opus-5-5");
    expect([bad?.["stored"], bad?.["reason"]]).toEqual([false, "traits-malformed"]);
  });
});

// ---------------------------------------------------------------------------
// the reflection
// ---------------------------------------------------------------------------

describe("the reflection: writes nudges on what it was shown, is shown no balance", () => {
  const SESSION = "s-traits-reflect";
  function brain(): Counterpart {
    const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" }, snapshotsDir: snaps });
    open.push(c);
    return c;
  }
  function lived(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
    const day = c.store.livedDay();
    return c.store.put({
      type: "memory",
      kind: "person",
      about: "us",
      body,
      salience: { relevance: 0.7, emotional: 0.4, predictive: 0.5 },
      physics: { birthDay: day, lastUsedDay: day },
      ...over,
    });
  }

  test("finish records a nudge of source reflection on a shown memory; refuses the unshown, the unknown and its own writing", () => {
    const c = brain();
    c.store.advanceClock("2026-09-20");
    const id = lived(c, "When Mike asked for a quick fix I said the design was wrong and proposed another.");
    const dreamed = lived(c, "A dream's gist about pushing back.", { source: "dreamed" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    // No balance, no totals — nothing it is shown carries a trait; only the
    // limit on how many it may write is said.
    const { limits, ...rest } = begun.bundle as unknown as { limits: Record<string, number> } & Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain("trait");
    expect(limits["traits"]).toBe(REFLECT_TUNABLES.LIMITS.traits);
    expect(begun.instructions).toContain("traits (optional");
    expect(begun.instructions).toContain("careful-bold");
    const shown = new Set(JSON.parse(c.store.reflections({ limit: 1 })[0]?.shown ?? "[]") as string[]);
    expect(shown.has(id)).toBe(true);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "I acted less agreeably than my page says, and I think it was right.",
      cites: [id],
      traits: [
        { id, axis: "agreeable-candid", toward: "candid", strength: 0.7, carried_by: "said the design was wrong" },
        { id: "mem_not_shown", axis: "careful-bold", toward: "bold", strength: 0.5 },
        { id, axis: "bravery", toward: "bold", strength: 0.5 },
        ...(shown.has(dreamed) ? [{ id: dreamed, axis: "careful-bold", toward: "bold", strength: 0.5 }] : []),
      ],
    });
    if (!done.ok) throw new Error(done.reason);
    const t = done.outcome.traits;
    expect(t[0]).toEqual({ id, ok: true, reason: "recorded" });
    expect(t[1]).toMatchObject({ id: "mem_not_shown", ok: false, reason: "not-shown-or-gone" });
    expect(t[2]?.ok).toBe(false);
    expect(t[2]?.reason).toContain("trait-invalid:axis-unknown");
    if (shown.has(dreamed)) expect(t[3]).toMatchObject({ id: dreamed, ok: false, reason: "dreamed-is-a-suggestion" });
    const [row] = c.store.traitsFor(id);
    expect(row).toMatchObject({ source: "reflection", axis: "agreeable-candid", toward: "candid", strength: 0.7 });
    expect(row?.carried_by.startsWith("on reflection,")).toBe(true);
    expect(c.store.traitsFor(dreamed)).toEqual([]);
    expect(REFLECT_TUNABLES.LIMITS.traits).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// a dream's merge
// ---------------------------------------------------------------------------

describe("a dream's merge carries the originals' nudges, as it carries their feelings", () => {
  test("each nudge keeps its source, model and moment; a confidential original's are withheld on the merged memory", () => {
    const at = Date.parse("2026-09-27T12:00:00Z");
    let now = at;
    const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" }, snapshotsDir: snaps, now: () => now });
    open.push(c);
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 26; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const put = (body: string, over: Partial<PutInput> = {}) =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
    const a = put("The migration step must run before the container boots, or it boots empty.");
    const b = put("Run the migration before starting the container, otherwise the container starts empty.", { meta: { confidential: true } });
    c.store.addTraits(a, [{ axis: "careful-bold", toward: "careful", strength: 0.5, carriedBy: "checked twice" }], { model: "claude-opus-5-5" });
    c.store.addTraits(b, [{ axis: "agreeable-candid", toward: "candid", strength: 0.4, carriedBy: "told him plainly" }], { source: "reflection" });
    now = at + 3_600_000;
    const begun = c.dreams.begin({ session: "s-dream", scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: "s-dream",
      changes: [{ action: "merge", ids: [a, b], text: "Run the migration before the container boots, or it boots empty." }],
    });
    if (!out.ok) throw new Error(out.reason);
    const merged = out.results[0]?.id as string;
    expect(c.store.row(merged)?.confidential).toBe(1);
    const carried = c.store.traitsFor(merged, { includeConfidential: true });
    expect(carried.map((t) => [t.axis, t.toward, t.source, t.model, t.created_at, t.carried_by])).toEqual([
      ["careful-bold", "careful", "session", "claude-opus-5-5", at, "checked twice"],
      ["agreeable-candid", "candid", "reflection", null, at, "told him plainly"],
    ]);
    // Read without asking: the merged memory is confidential, so its words are withheld.
    expect(c.store.traitsFor(merged).every((t) => t.withheld && t.carried_by === "")).toBe(true);
    // The originals keep theirs, superseded — and the all-read counts the moment once.
    expect(c.store.traitsFor(a).length).toBe(1);
    expect(c.store.traitsAll().map((t) => t.memory_id)).toEqual([merged, merged]);
  });
});

// ---------------------------------------------------------------------------
// the console
// ---------------------------------------------------------------------------

describe("the console", () => {
  function io(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  }

  test("markdown export carries a memory's nudges after its words", async () => {
    const s = Store.open({ dir });
    const id = s.put({ type: "memory", kind: "self", body: "I told him the estimate was too low." });
    s.addTraits(id, [candid]);
    s.close();
    const target = join(root, "export");
    const c = io();
    expect(await run(["export", "--out", join(target, "tree"), "--markdown", "--plaintext", "--dir", dir], { io: c.io })).toBe(0);
    const text = readFileSync(join(target, "tree", "memories", "self", `${id}.md`), "utf8");
    expect(text).toContain("## Traits");
    expect(text).toContain("1. agreeable-candid → candid · 0.6 — carried by: said the plan had a hole");
  });

  test("the fired report counts memories carrying a nudge", () => {
    const s = store({ timeZone: "UTC", now: () => Date.parse("2026-09-27T12:00:00Z") });
    const id = mem(s);
    mem(s, "A memory with no nudge.");
    s.addTraits(id, [candid]);
    const row = firedReport(s, "2026-09-27").rows.find((r) => r.id === "traits");
    expect(row?.total).toBe(1);
    expect(row?.firedInWindow).toBe(1);
  });
});
