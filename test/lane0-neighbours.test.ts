/**
 * Lane 0 (2026-10-10), scale review C1: neighbours stored at write, read by the
 * dream. Box 3's `neighbours` table (cache v6) holds each memory's nearest
 * vectors as they stood when it was written; the dream's `begin` reads them
 * instead of re-scanning the embedding table once per queued memory.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { CACHE_SCHEMA_VERSION, NEIGHBOURS_KEPT } from "../src/core/store/cache.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-neighbours-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A deterministic 8-d vector from the words: memories sharing words sit near each other. */
function embed(text: string): number[] {
  const v = new Array<number>(8).fill(0);
  for (const w of text.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2)) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 8] = (v[h % 8] ?? 0) + 1;
  }
  return v.map((x) => x + 0.01);
}

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" }, embed });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

type CacheDb = { all<T>(sql: string, ...p: unknown[]): T[]; get<T>(sql: string, ...p: unknown[]): T | undefined; run(sql: string, ...p: unknown[]): void };
const cacheOf = (c: Counterpart): CacheDb => (c.store as unknown as { cache: CacheDb }).cache;
const listOf = (c: Counterpart, id: string): string[] =>
  cacheOf(c)
    .all<{ neighbour_id: string }>("SELECT neighbour_id FROM neighbours WHERE memory_id = ? ORDER BY rank", id)
    .map((r) => r.neighbour_id);

const BODIES = [
  "The deploy script runs the migration before the container starts.",
  "Mike walks the dog along the river most mornings.",
  "The migration must run before the container boots or it boots empty.",
  "Sourdough wants a warm kitchen and a slow overnight rise.",
  "A container that starts before its migration serves an empty database.",
];

describe("Lane 0 C1: neighbours at write", () => {
  test("the cache is v6 and has the table", () => {
    const c = brain();
    expect(CACHE_SCHEMA_VERSION).toBe(6);
    expect(cacheOf(c).get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value).toBe("6");
    expect(cacheOf(c).get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'neighbours'")?.n).toBe(1);
  });

  test("a written memory keeps its nearest OLDER memories, nearest first, never itself", () => {
    const c = brain();
    c.store.advanceClock("2026-10-01");
    const ids = BODIES.map((b) => mem(c, b));
    // The first had no memory to be near (the store's own rows — the self
    // page — may be on it); the later ones none of the memories after them.
    const mine = (l: string[]): string[] => l.filter((x) => ids.includes(x));
    expect(mine(listOf(c, ids[0] as string))).toEqual([]);
    expect(mine(listOf(c, ids[2] as string)).sort()).toEqual(ids.slice(0, 2).sort());
    const last = ids[4] as string;
    const list = listOf(c, last);
    expect(list).not.toContain(last);
    expect(new Set(mine(list))).toEqual(new Set(ids.slice(0, 4)));
    // Same order a full scan gives, minus itself.
    const vec = c.store.vectorOf(last) as number[];
    const scan = c.store.nearestTo(vec, 10).map((h) => h.id).filter((x) => x !== last);
    expect(list).toEqual(scan);
    // Bounded.
    expect(list.length).toBeLessThanOrEqual(NEIGHBOURS_KEPT);
  });

  test("an archived memory leaves every list, and its own", () => {
    const c = brain();
    c.store.advanceClock("2026-10-01");
    const ids = BODIES.map((b) => mem(c, b));
    const gone = ids[2] as string;
    c.store.archive(gone);
    expect(listOf(c, gone)).toEqual([]);
    for (const id of ids) expect(listOf(c, id)).not.toContain(gone);
  });

  test("the reader computes a missing list from one read of the table, writes it back, and agrees with a scan", () => {
    const c = brain();
    c.store.advanceClock("2026-10-01");
    const ids = BODIES.map((b) => mem(c, b));
    const target = ids[4] as string;
    cacheOf(c).run("DELETE FROM neighbours");
    const read = c.store.neighbourReader();
    const got = read(target, 3);
    const vec = c.store.vectorOf(target) as number[];
    expect(got).toEqual(c.store.nearestTo(vec, 10).map((h) => h.id).filter((x) => x !== target).slice(0, 3));
    // Written back: the next reader reads it.
    expect(listOf(c, target).slice(0, 3)).toEqual(got as string[]);
    // A memory with no vector: null (the dream falls back to words).
    expect(read("mem_nosuchthing", 3)).toBeNull();
  });

  test("the dream shows the same neighbours whether the lists were stored at write or computed at begin", () => {
    const run = (wipe: boolean): { id: string; neighbours: string[] }[] => {
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-neighbours-"));
      const c = brain();
      c.store.advanceClock("2026-09-20");
      for (const b of BODIES.slice(0, 3)) mem(c, `${b} (older)`);
      for (let d = 21; d <= 30; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
      for (const b of BODIES) mem(c, b);
      if (wipe) cacheOf(c).run("DELETE FROM neighbours");
      const out = c.dreams.begin({ session: "s-lane0", scope: "/proj" });
      if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
      const fresh = out.bundle.fresh.map((f) => ({ id: f.id, neighbours: [...f.neighbours] }));
      c.close();
      open.splice(0);
      return fresh;
    };
    const stored = run(false);
    const computed = run(true);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((f) => f.neighbours.length > 0)).toBe(true);
    // Ids differ between the two stores; the SHAPE (how many neighbours each
    // fresh memory got, in priority order) must not.
    expect(stored.map((f) => f.neighbours.length)).toEqual(computed.map((f) => f.neighbours.length));
  });
});
