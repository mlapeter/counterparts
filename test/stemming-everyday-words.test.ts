/**
 * Light stemming in the word index and the everyday-word discount on cue
 * weights — an EXPERIMENT (2026-10-19, first-prompt recall diagnosis Bug 2;
 * check ~10-22). What is pinned here is behaviour, never a tunable's value:
 *
 *   - bake / bakes / baked / baking meet, in the index and in a lookup;
 *   - ids, numbers, versions and names still match exactly, and stemming
 *     never touches a token holding a digit or shorter than four letters;
 *   - a cache migrated from v6 keeps its rows as they were at open, loses no
 *     word recall while MIXED, and the worker's re-stem finishes it, in
 *     resumable batches, without touching a vector;
 *   - cues are grouped by stem (one word said twice is one cue), and the
 *     discount scales a word by the embedder's table weight, with no table
 *     meaning no change.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { factsRecall } from "../src/adapters/mcp/facts.js";
import { Counterpart } from "../src/core/counterpart.js";
import { activate } from "../src/core/recall/activate.js";
import { buildCues, everydayFactor } from "../src/core/recall/cues.js";
import { TUNABLES } from "../src/core/recall/tunables.js";
import { openDb } from "../src/core/store/db.js";
import {
  CACHE_SCHEMA_VERSION,
  Store,
  TERMS_CURSOR_META_KEY,
  TERMS_META_KEY,
  WRITE_METHODS,
  paths,
  stemTerm,
  tokenize,
} from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-stemming-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function open(opts: Parameters<typeof Store.open>[0] = {}): Store {
  return findable(Store.open({ dir, ...opts }));
}

describe("stemTerm", () => {
  test("bake, bakes, baked and baking are one term; so are cookie and cookies", () => {
    const one = new Set(["bake", "bakes", "baked", "baking"].map(stemTerm));
    expect(one.size).toBe(1);
    expect(stemTerm("cookie")).toBe(stemTerm("cookies"));
    expect(stemTerm("invite")).toBe(stemTerm("inviting"));
    expect(stemTerm("party")).toBe(stemTerm("parties"));
  });

  test("a token holding a digit, or shorter than four letters, is never touched", () => {
    for (const t of ["v13", "26", "0", "251c2ccb8a01", "2023", "mp3s", "bus", "gas", "his", "mem", "abc", "ids"]) {
      expect(stemTerm(t)).toBe(t);
    }
  });

  test("-ss, -us and -is keep their s", () => {
    for (const t of ["glass", "bonus", "paris", "this", "dennis", "business"]) expect(stemTerm(t)).toBe(t);
    // Porter2's exceptions: "news" is not the plural of "new".
    expect(stemTerm("news")).not.toBe(stemTerm("new"));
  });

  test("idempotent, and never shorter than three letters", () => {
    const roots = ["bake", "cook", "invite", "gather", "party", "study", "hope", "run", "play", "agree", "need", "horse",
      "promise", "use", "add", "sing", "string", "cocktail", "guitar", "photograph", "classes", "zumba", "james", "williams"];
    const suffixes = ["", "s", "es", "ed", "ing", "ies", "er", "ers", "y", "ly", "ings", "eds"];
    for (const r of roots) {
      for (const s of suffixes) {
        const w = `${r}${s}`;
        const once = stemTerm(w);
        expect(stemTerm(once)).toBe(once);
        if (w.length >= 4) expect(once.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("the stemmed index", () => {
  test("a question that says bake reaches a memory that says baking, and the other way round", () => {
    const s = open();
    const baking = s.put({ type: "memory", kind: "fact", body: "Birthday baking plans for the weekend" });
    const baked = s.put({ type: "memory", kind: "fact", body: "Baked a lemon pound cake for Sam" });
    s.put({ type: "memory", kind: "fact", body: "The harbor ferry leaves at noon" });
    expect(s.termIndex().ready).toBe(true); // a fresh cache is stemmed from the start
    expect(s.search("bake", 10).map((h) => h.id).sort()).toEqual([baking, baked].sort());
    expect(s.search("bakes", 10).map((h) => h.id).sort()).toEqual([baking, baked].sort());
    expect(s.docFrequency(["bake", "baking"]).get("bake")).toBe(2);
    expect(s.docFrequency(["bake", "baking"]).get("baking")).toBe(2);
    s.close();
  });

  test("ids, versions, numbers and names still match exactly", () => {
    const s = open();
    const release = s.put({ type: "memory", kind: "fact", body: "Released 0.3.26 on Saturday night" });
    const other = s.put({ type: "memory", kind: "fact", body: "Released 0.3.25 the week before" });
    const id = s.put({ type: "memory", kind: "fact", body: "The bench row mem_abc123 failed twice" });
    const v13 = s.put({ type: "memory", kind: "fact", body: "The v13 migration ran clean" });
    const james = s.put({ type: "memory", kind: "fact", body: "James flew to Paris for the conference" });
    const jam = s.put({ type: "memory", kind: "fact", body: "Made strawberry jam with Robin" });
    const ids = (q: string): string[] => s.search(q, 10).map((h) => h.id);
    expect(ids("0.3.26")).toEqual([release]); // "26" is the token; "25" is not
    expect(ids("0.3.25")).toEqual([other]);
    expect(ids("abc123")).toEqual([id]);
    expect(ids("mem_abc123")).toContain(id);
    expect(ids("v13")).toEqual([v13]);
    expect(ids("James")).toEqual([james]);
    expect(ids("Paris")).toEqual([james]);
    expect(ids("jam")).toEqual([jam]); // "james" is not "jam"
    // What the index holds for those words is the word itself.
    for (const t of tokenize("0.3.26 mem_abc123 v13 Paris")) expect(stemTerm(t)).toBe(t);
    s.close();
  });
});

describe("a cache migrated from v6", () => {
  /** Make the cache look as a v6 build left it: surface words, no marker, stamped 6. */
  function asV6(): void {
    const db = openDb(paths.cache(dir), { wal: true });
    db.transaction(() => {
      const docs = db.all<{ memory_id: string }>("SELECT memory_id FROM doc_lens");
      db.run("DELETE FROM doc_tokens");
      const ops = openDb(paths.operational(dir), { wal: true });
      for (const { memory_id } of docs) {
        const row = ops.get<{ title: string | null; body: string }>("SELECT title, body FROM memories WHERE id = ?", memory_id);
        const counts = new Map<string, number>();
        for (const t of tokenize(`${row?.title ?? ""}\n${row?.body ?? ""}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
        for (const [t, tf] of counts) db.run("INSERT INTO doc_tokens (memory_id, token, tf) VALUES (?, ?, ?)", memory_id, t, tf);
      }
      ops.close();
      db.run("DELETE FROM cache_meta WHERE key IN (?, ?)", TERMS_META_KEY, TERMS_CURSOR_META_KEY);
      db.run("UPDATE cache_meta SET value = '6' WHERE key = 'schemaVersion'");
    });
    db.close();
  }
  function embeddingRows(): { memory_id: string; vec: unknown }[] {
    const db = openDb(paths.cache(dir), { wal: true });
    const rows = db.all<{ memory_id: string; vec: unknown }>("SELECT memory_id, vec FROM embeddings ORDER BY memory_id");
    db.close();
    return rows;
  }
  function tokenRows(): { memory_id: string; token: string; tf: number }[] {
    const db = openDb(paths.cache(dir), { wal: true });
    const rows = db.all<{ memory_id: string; token: string; tf: number }>("SELECT memory_id, token, tf FROM doc_tokens ORDER BY memory_id, token");
    db.close();
    return rows;
  }

  test("the open migrates without re-stemming; nothing is lost while mixed; the worker's re-stem finishes it", () => {
    const vec = (text: string): number[] => [text.length % 7, 1, 0.5];
    const embed = Object.assign(vec, {});
    let s = open({ embed });
    const baking = s.put({ type: "memory", kind: "fact", body: "Birthday baking plans for the weekend" });
    const bake = s.put({ type: "memory", kind: "fact", body: "Wants to bake sourdough with rye" });
    s.put({ type: "memory", kind: "fact", body: "The harbor ferry leaves at noon" });
    s.close();
    asV6();
    const before = tokenRows();

    s = open({ embed });
    // The open stamps v7 and leaves every row as it was.
    expect(tokenRows()).toEqual(before);
    expect(s.termIndex().ready).toBe(false);
    {
      const db = openDb(paths.cache(dir), { wal: true });
      expect(db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value).toBe(String(CACHE_SCHEMA_VERSION));
      db.close();
    }
    // MIXED: every surface form still finds what it found before — and a
    // form's stem may find more ("baking" asks for "bake" too), never less.
    expect(s.search("baking", 10).map((h) => h.id).sort()).toEqual([baking, bake].sort());
    expect(s.search("bake", 10).map((h) => h.id)).toEqual([bake]);
    expect(s.docFrequency(["baking"]).get("baking")).toBe(2);
    // A write since the migration is stemmed, and found by either form.
    const baked = s.put({ type: "memory", kind: "fact", body: "Baked bread for the neighbours" });
    expect(s.search("baked", 10).map((h) => h.id)).toContain(baked);
    expect(s.search("bake", 10).map((h) => h.id)).toContain(baked);

    // The worker's step: one document per batch, no time to spare — it resumes.
    const vectorsBefore = embeddingRows();
    let r = s.restemIndex({ batch: 1, budgetMs: 0 });
    expect(r.ready).toBe(false);
    expect(r.examined).toBe(1);
    for (let i = 0; i < 10 && !r.ready; i++) r = s.restemIndex({ batch: 1, budgetMs: 0 });
    expect(r.ready).toBe(true);
    expect(s.termIndex().ready).toBe(true);
    expect(s.search("bake", 10).map((h) => h.id).sort()).toEqual([baking, bake, baked].sort());
    // Idempotent: a ready index is left alone.
    expect(s.restemIndex()).toEqual({ ready: true, examined: 0, changed: 0, ms: 0 });
    // Lengths and vectors are untouched by the re-stem.
    expect(embeddingRows()).toEqual(vectorsBefore);
    s.close();
  });

  test("rebuildCache({ keepVectors }) is the other path to a stemmed index: marked, re-indexed, vectors kept", () => {
    const vec = (text: string): number[] => [text.length % 7, 1, 0.5];
    let s = open({ embed: Object.assign(vec, {}) });
    const baking = s.put({ type: "memory", kind: "fact", body: "Birthday baking plans for the weekend" });
    s.put({ type: "memory", kind: "fact", body: "The harbor ferry leaves at noon" });
    s.close();
    asV6();
    const vectorsBefore = embeddingRows();
    s = open();
    expect(s.termIndex().ready).toBe(false);
    s.rebuildCache({ keepVectors: true });
    expect(s.termIndex().ready).toBe(true);
    expect(s.search("bake", 10).map((h) => h.id)).toEqual([baking]);
    expect(tokenRows().some((r) => r.token === "baking")).toBe(false);
    expect(embeddingRows()).toEqual(vectorsBefore);
    s.close();
  });

  test("the re-stem is a write: an observer cannot run it", () => {
    expect(WRITE_METHODS).toContain("restemIndex");
  });
});

describe("cues", () => {
  test("words sharing a stem are one cue, asked over all its forms", () => {
    const s = open();
    const baking = s.put({ type: "memory", kind: "fact", body: "Birthday baking plans for the weekend" });
    s.put({ type: "memory", kind: "fact", body: "The harbor ferry leaves at noon" });
    s.put({ type: "memory", kind: "fact", body: "Sourdough starter needs feeding" });
    const storeSize = s.countMemories({ archived: false });
    const out = activate(s, { text: "bake or baking?", day: s.livedDay(), selfFelt: false, maxCandidates: 10, storeSize }, TUNABLES);
    const bakeCues = out.cues.filter((c) => stemTerm(c.token) === stemTerm("bake"));
    expect(bakeCues.length).toBe(1);
    expect(bakeCues[0]?.forms).toEqual(["bake", "baking"]);
    expect(bakeCues[0]?.tf).toBe(2);
    expect(out.candidates.map((c) => c.id)).toContain(baking);
    s.close();
  });

  test("everydayFactor: no table is no change; the ramp runs from nothing to all; a ramp of no width is off", () => {
    const t = TUNABLES;
    expect(everydayFactor(null, t)).toBe(1);
    expect(everydayFactor(t.EVERYDAY_NORM_LOW, t)).toBe(0);
    expect(everydayFactor(t.EVERYDAY_NORM_HIGH, t)).toBe(1);
    const mid = everydayFactor((t.EVERYDAY_NORM_LOW + t.EVERYDAY_NORM_HIGH) / 2, t);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(everydayFactor(0, { EVERYDAY_NORM_LOW: 50, EVERYDAY_NORM_HIGH: 50 })).toBe(1);
  });

  test("an everyday word's weight is scaled down; a topic word's is not; with no table the weights are as before", () => {
    const input = { text: "any tips on what to bake", storeSize: 300, df: new Map([["any", 7], ["tips", 56], ["what", 27], ["bake", 6]]) };
    const plain = buildCues(input, TUNABLES);
    const weightOf = (cues: ReturnType<typeof buildCues>, tok: string): number => cues.find((c) => c.token === tok)?.weight ?? 0;
    // A table that knows "any" and "what" as everyday words and nothing else.
    const norms = new Map([["any", TUNABLES.EVERYDAY_NORM_LOW], ["what", TUNABLES.EVERYDAY_NORM_LOW]]);
    const scaled = buildCues({ ...input, wordNorm: (w) => norms.get(w) ?? null }, TUNABLES);
    expect(weightOf(scaled, "bake")).toBe(weightOf(plain, "bake"));
    expect(weightOf(scaled, "tips")).toBe(weightOf(plain, "tips"));
    expect(weightOf(plain, "any")).toBeGreaterThan(0);
    expect(weightOf(scaled, "any")).toBe(0);
    expect(weightOf(scaled, "what")).toBe(0);
    // No table at all: exactly the old weights.
    expect(buildCues({ ...input, wordNorm: () => null }, TUNABLES)).toEqual(plain);
  });
});

describe("facts mode", () => {
  test("a question that says baking finds the memory that says bake", () => {
    const c = Counterpart.open({ dir: join(dir, "store"), owner: true, timeZone: "UTC" });
    findable(c.store);
    const id = c.store.put({ type: "memory", kind: "fact", body: "Wants to bake sourdough with rye flour" });
    for (const body of ["The harbor ferry leaves at noon", "Prefers espresso over filter coffee", "The library closes early on Sundays"]) {
      c.store.put({ type: "memory", kind: "fact", body });
    }
    const r = factsRecall({ counterpart: c, sessionId: "s-facts", owner: true, vector: null, semantic: "embedder-off" }, "what was I baking?");
    expect(r.memories.map((m) => m.id)).toContain(id);
    c.close();
  });
});
