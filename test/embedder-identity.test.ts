/**
 * The embedder identity tag on box 3 (cache v5, roadmap C1).
 *
 * `cache_meta.embedder = "<model>@<dim>"` says which model wrote the vectors in
 * `embeddings`, and `Store.open` checks it against the configured embedder
 * ONCE, at open:
 *
 *   - match                       → nothing touched (row bytes and rowids identical)
 *   - no embedder configured      → nothing touched
 *   - mismatch, static configured → dropped and rebuilt inline, re-tagged
 *   - mismatch, paid → paid       → HELD: nothing dropped, nothing ranked, nothing written
 *   - a cache from a NEWER build  → left as found (version, rows, tag); vectors off by name
 *
 * Hermetic: every store is a fresh temp dir, and every embedder is a
 * deterministic stub carrying an identity — no table, no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CACHE_SCHEMA_VERSION,
  EMBEDDER_META_KEY,
  EMBEDDER_REBUILD_META_KEY,
  Store,
  hashText,
  identityTag,
  paths,
  parseIdentityTag,
} from "../src/core/store/index.js";
import type { Embedder, EmbedderIdentity, PutInput } from "../src/core/store/index.js";
import { openCache, reconcileEmbedder, resetCache } from "../src/core/store/cache.js";
import { openDb } from "../src/core/store/db.js";

let dir: string;
const open: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-embed-id-"));
});
afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      // already closed by the test
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(embed?: Embedder, observer = false): Store {
  const s = Store.open({ dir, ...(embed === undefined ? {} : { embed }), ...(observer ? { observer: true } : {}) });
  open.push(s);
  return s;
}

function closeAll(): void {
  for (const s of open.splice(0)) s.close();
}

/** A deterministic vector of width `dim`, salted so two "models" disagree. */
function vec(text: string, dim: number, salt: string): number[] {
  const h = hashText(`${salt}:${text}`);
  const out: number[] = [];
  for (let i = 0; i < dim; i++) out.push(parseInt(h.slice((i * 2) % 60, ((i * 2) % 60) + 2), 16) / 255 + 0.01);
  return out;
}

function embedder(identity: EmbedderIdentity | undefined, dim: number, salt = identity?.model ?? "plain"): Embedder {
  const fn = (text: string): number[] | null => vec(text, dim, salt);
  return identity === undefined ? fn : Object.assign(fn, { identity });
}

const STATIC_A: EmbedderIdentity = { model: "static-a", dim: 4, rebuild: "inline" };
const STATIC_B: EmbedderIdentity = { model: "static-b", dim: 4, rebuild: "inline" };
const PAID_A: EmbedderIdentity = { model: "paid-a", dim: null, rebuild: "external" };
const PAID_B: EmbedderIdentity = { model: "paid-b", dim: null, rebuild: "external" };

function mem(body: string, extra: Partial<PutInput> = {}): PutInput {
  return { type: "memory", kind: "fact", body, ...extra };
}

/** Box 3 read directly, without a Store: every row, byte-exact, with its rowid. */
function rows(): { rowid: number; memory_id: string; dim: number; hex: string }[] {
  const db = openDb(paths.cache(dir));
  try {
    return db
      .all<{ rowid: number; memory_id: string; dim: number; vec: Uint8Array }>(
        "SELECT rowid, memory_id, dim, vec FROM embeddings ORDER BY memory_id",
      )
      .map((r) => ({ rowid: r.rowid, memory_id: r.memory_id, dim: r.dim, hex: Buffer.from(r.vec).toString("hex") }));
  } finally {
    db.close();
  }
}

function meta(): Record<string, string> {
  const db = openDb(paths.cache(dir));
  try {
    return Object.fromEntries(
      db.all<{ key: string; value: string }>("SELECT key, value FROM cache_meta").map((r) => [r.key, r.value]),
    );
  } finally {
    db.close();
  }
}

function seed(embed: Embedder | undefined, bodies = ["cold brew ratios", "the ward rota", "sourdough starter"]): string[] {
  const s = store(embed);
  const ids = bodies.map((b) => s.put(mem(b)));
  closeAll();
  return ids;
}

describe("the tag format", () => {
  test("<model>@<dim>, split on the LAST @", () => {
    expect(identityTag("potion-base-8M", 256)).toBe("potion-base-8M@256");
    expect(identityTag("voyage-3-large", null)).toBe("voyage-3-large");
    expect(parseIdentityTag("potion-base-8M@256")).toEqual({ model: "potion-base-8M", dim: 256 });
    expect(parseIdentityTag("org@model@1024")).toEqual({ model: "org@model", dim: 1024 });
    expect(parseIdentityTag("no-dim")).toEqual({ model: "no-dim", dim: null });
  });

  test("the cache schema is v5", () => {
    expect(CACHE_SCHEMA_VERSION).toBe(5);
  });
});

describe("a fresh store", () => {
  test("a static embedder tags it at open and its writes carry vectors", () => {
    const s = store(embedder(STATIC_A, 4));
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: "static-a@4", adopted: 0 });
    s.put(mem("cold brew ratios"));
    closeAll();
    expect(meta()[EMBEDDER_META_KEY]).toBe("static-a@4");
    expect(meta()[EMBEDDER_REBUILD_META_KEY]).toBe("inline");
    expect(rows()).toHaveLength(1);
  });

  test("a paid seat (width unknown until its first vector) is tagged by that first write", () => {
    const s = store(embedder(PAID_A, 6));
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: null, adopted: 0 });
    expect(meta()[EMBEDDER_META_KEY]).toBeUndefined();
    s.put(mem("cold brew ratios"));
    closeAll();
    expect(meta()[EMBEDDER_META_KEY]).toBe("paid-a@6");
    expect(meta()[EMBEDDER_REBUILD_META_KEY]).toBe("external");
  });
});

describe("match → untouched", () => {
  test("the same identity reopens with the row bytes, the rowids and cache_meta identical", () => {
    seed(embedder(STATIC_A, 4));
    const beforeRows = rows();
    const beforeMeta = meta();
    expect(beforeRows).toHaveLength(3);
    const s = store(embedder(STATIC_A, 4));
    expect(s.embedderVerdict).toEqual({ kind: "match", tag: "static-a@4" });
    closeAll();
    expect(rows()).toEqual(beforeRows);
    expect(meta()).toEqual(beforeMeta);
  });

  test("a paid seat matching on the model alone (its width learned from the rows) is a match", () => {
    seed(embedder(PAID_A, 6));
    const before = rows();
    expect(store(embedder(PAID_A, 6)).embedderVerdict).toEqual({ kind: "match", tag: "paid-a@6" });
    closeAll();
    expect(rows()).toEqual(before);
  });
});

describe("no embedder configured → untouched", () => {
  test("a recorded identity with no embedder: rows, tag and bytes stay exactly as they were", () => {
    seed(embedder(STATIC_A, 4));
    const beforeRows = rows();
    const beforeMeta = meta();
    const s = store();
    expect(s.embedderVerdict).toEqual({ kind: "none" });
    expect(s.nearestTo(vec("cold brew ratios", 4, "static-a"), 3)).toHaveLength(3);
    closeAll();
    expect(rows()).toEqual(beforeRows);
    expect(meta()).toEqual(beforeMeta);
  });

  test("a plain function embedder (no identity) is never checked against the tag", () => {
    seed(embedder(STATIC_A, 4));
    const before = rows();
    expect(store(embedder(undefined, 4)).embedderVerdict).toEqual({ kind: "none" });
    closeAll();
    expect(rows()).toEqual(before);
  });

  test("an observer never reconciles, whatever it is handed", () => {
    seed(embedder(STATIC_A, 4));
    const before = rows();
    const beforeMeta = meta();
    expect(store(embedder(STATIC_B, 4), true).embedderVerdict).toEqual({ kind: "none" });
    closeAll();
    expect(rows()).toEqual(before);
    expect(meta()).toEqual(beforeMeta);
  });
});

describe("mismatch → rebuilt and re-tagged (static)", () => {
  test("static → another static: every vector dropped, rebuilt INLINE at open, re-tagged", () => {
    const ids = seed(embedder(STATIC_A, 4));
    const before = rows();
    const s = store(embedder(STATIC_B, 4));
    expect(s.embedderVerdict).toEqual({ kind: "reset", from: "static-a@4", to: "static-b@4", dropped: 3 });
    // Rebuilt before the constructor returned: every live memory, the new model's vectors.
    expect(s.unembeddedCount()).toBe(0);
    expect(s.events("cache.embedder.refilled")[0]?.data).toMatchObject({ embedded: 3, remaining: 0 });
    const top = s.nearestTo(vec(`${"\n"}cold brew ratios`, 4, "static-b"), 1);
    expect(top[0]?.id).toBe(ids[0]);
    closeAll();
    const after = rows();
    expect(after.map((r) => r.memory_id)).toEqual(before.map((r) => r.memory_id));
    expect(after.map((r) => r.hex)).not.toEqual(before.map((r) => r.hex));
    expect(meta()[EMBEDDER_META_KEY]).toBe("static-b@4");
  });

  test("paid rows → static: dropped (a static query cannot use them) and rebuilt inline", () => {
    seed(embedder(PAID_A, 6));
    const s = store(embedder(STATIC_A, 4));
    expect(s.embedderVerdict).toEqual({ kind: "reset", from: "paid-a@6", to: "static-a@4", dropped: 3 });
    expect(s.unembeddedCount()).toBe(0);
    closeAll();
    expect(rows().every((r) => r.dim === 4)).toBe(true);
    expect(meta()[EMBEDDER_REBUILD_META_KEY]).toBe("inline");
  });

  test("static rows → a paid seat: the free rows go, the paid backfill refills, the first write tags", () => {
    seed(embedder(STATIC_A, 4));
    const s = store(embedder(PAID_A, 6));
    expect(s.embedderVerdict).toEqual({ kind: "reset", from: "static-a@4", to: null, dropped: 3 });
    // Nothing is embedded inline for a paid seat — never a silent paid call.
    expect(s.unembeddedCount()).toBe(3);
    expect(meta()[EMBEDDER_META_KEY]).toBeUndefined();
    const [id] = s.missingVectors(1);
    expect(s.embedOne(id ?? "").vector).toBe(true);
    closeAll();
    expect(meta()[EMBEDDER_META_KEY]).toBe("paid-a@6");
  });
});

describe("mismatch between two paid identities → HELD", () => {
  test("nothing dropped, nothing tagged, nothing ranked, nothing written", () => {
    seed(embedder(PAID_A, 6));
    const beforeRows = rows();
    const beforeMeta = meta();
    const s = store(embedder(PAID_B, 6));
    expect(s.embedderVerdict).toEqual({ kind: "held", recorded: "paid-a@6", configured: "paid-b", rows: 3 });
    expect(s.events("cache.embedder.reconciled")[0]?.data).toMatchObject({ kind: "held", recorded: "paid-a@6" });
    // Same width, other model: a cosine would be a number that means nothing.
    expect(s.nearestTo(vec("cold brew ratios", 6, "paid-b"), 3)).toEqual([]);
    expect(s.neighbourVectors(vec("cold brew ratios", 6, "paid-b"), 3)).toEqual([]);
    const fresh = s.put(mem("a new memory under the new seat"));
    expect(s.embedOne(fresh).vector).toBe(false);
    closeAll();
    expect(rows()).toEqual(beforeRows);
    expect(meta()).toEqual(beforeMeta);
  });
});

describe("legacy (v4, untagged) rows", () => {
  test("adopted by a paid seat when every row has one width that agrees", () => {
    seed(embedder(undefined, 6));
    const before = rows();
    expect(meta()[EMBEDDER_META_KEY]).toBeUndefined();
    const s = store(embedder({ model: "paid-a", dim: 6, rebuild: "external" }, 6));
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: "paid-a@6", adopted: 3 });
    closeAll();
    expect(rows()).toEqual(before);
    expect(meta()[EMBEDDER_META_KEY]).toBe("paid-a@6");
  });

  test("held by a paid seat whose declared width disagrees with the rows", () => {
    seed(embedder(undefined, 6));
    const before = rows();
    const s = store(embedder({ model: "paid-a", dim: 1024, rebuild: "external" }, 1024));
    expect(s.embedderVerdict).toMatchObject({ kind: "held", recorded: null, rows: 3 });
    closeAll();
    expect(rows()).toEqual(before);
  });

  test("dropped and rebuilt by a static embedder", () => {
    seed(embedder(undefined, 6));
    const s = store(embedder(STATIC_A, 4));
    expect(s.embedderVerdict).toEqual({ kind: "reset", from: null, to: "static-a@4", dropped: 3 });
    expect(s.unembeddedCount()).toBe(0);
  });

  test("a store with memories and NO vectors meets a static embedder: tagged, then every memory embedded inline", () => {
    seed(undefined);
    expect(rows()).toHaveLength(0);
    const s = store(embedder(STATIC_A, 4));
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: "static-a@4", adopted: 0 });
    expect(s.unembeddedCount()).toBe(0);
    closeAll();
    expect(rows()).toHaveLength(3);
  });
});

describe("the v4 → v5 migration, and the rest of box 3's lifecycle", () => {
  test("a tag on a cache stamped below v5 is erased at open — it is not evidence", () => {
    seed(embedder(STATIC_A, 4));
    const db = openDb(paths.cache(dir));
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', '4')");
    db.close();
    const cache = openCache(paths.cache(dir));
    cache.close();
    expect(meta()[EMBEDDER_META_KEY]).toBeUndefined();
    expect(meta()["schemaVersion"]).toBe("5");
    expect(rows()).toHaveLength(3); // the rows stay; the next open with an embedder decides
  });

  test("resetCache({ keepEmbeddings }) keeps the tag with the vectors", () => {
    seed(embedder(STATIC_A, 4));
    const db = openCache(paths.cache(dir));
    resetCache(db, { keepEmbeddings: true });
    db.close();
    expect(meta()[EMBEDDER_META_KEY]).toBe("static-a@4");
    expect(rows()).toHaveLength(3);
  });

  test("a plain rebuildCache() under a static embedder re-tags as it re-embeds", () => {
    seed(embedder(STATIC_A, 4));
    const s = store(embedder(STATIC_A, 4));
    const report = s.rebuildCache();
    expect(report.unrecomputed).toBe(0);
    closeAll();
    expect(meta()[EMBEDDER_META_KEY]).toBe("static-a@4");
    expect(rows()).toHaveLength(3);
  });

  test("two opens racing to reconcile agree on one outcome", () => {
    seed(undefined);
    const a = openCache(paths.cache(dir));
    const b = openCache(paths.cache(dir));
    const first = reconcileEmbedder(a, STATIC_A);
    const second = reconcileEmbedder(b, STATIC_A);
    a.close();
    b.close();
    expect(first.kind).toBe("tagged");
    expect(second).toEqual({ kind: "match", tag: "static-a@4" });
  });

  test("the scan never scores a row of another width", () => {
    // Held-state tables are where two widths can coexist; a no-embedder handle reads them.
    seed(embedder(undefined, 6), ["one", "two"]);
    const s = store(embedder(undefined, 4));
    s.put(mem("three"));
    const hits = s.nearestTo(vec("three", 4, "plain"), 10);
    expect(hits).toHaveLength(1);
  });
});

describe("a cache from a NEWER build is left exactly as it is (roadmap E's rule)", () => {
  function stampVersion(v: string): void {
    const db = openDb(paths.cache(dir));
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", v);
    db.close();
  }

  test("v6 opened by v5 code: version still 6, no row dropped, the vector channel off by name, lexical still works", () => {
    const [first] = seed(embedder(STATIC_A, 4));
    stampVersion("6");
    const beforeRows = rows();
    const beforeMeta = meta();

    // Even a MISMATCHED static embedder — which would otherwise drop and
    // rebuild every vector — touches nothing here.
    const s = store(embedder(STATIC_B, 4));
    expect(s.embedderVerdict).toEqual({ kind: "cache-ahead", found: "6", expected: CACHE_SCHEMA_VERSION });
    expect(s.events("cache.schema.ahead")[0]?.data).toEqual({ kind: "cache-ahead", found: "6", expected: 5 });
    expect(s.nearestTo(vec("cold brew ratios", 4, "static-a"), 3)).toEqual([]);
    expect(s.neighbourVectors(vec("cold brew ratios", 4, "static-a"), 3)).toEqual([]);
    // Lexical: still read, and a new memory is still findable.
    expect(s.search("brew", 5).map((h) => h.id)).toContain(first ?? "");
    const fresh = s.put(mem("a kettle descaling schedule"));
    expect(s.search("descaling", 5).map((h) => h.id)).toContain(fresh);
    expect(s.embedOne(fresh).vector).toBe(false);
    // A rebuild would re-stamp the version: refused by the code box 2 uses.
    let code: string | null = null;
    try {
      s.rebuildCache();
    } catch (err) {
      code = (err as { code?: string }).code ?? "OTHER";
    }
    expect(code).toBe("SCHEMA_AHEAD");
    closeAll();

    expect(meta()["schemaVersion"]).toBe("6");
    expect(meta()[EMBEDDER_META_KEY]).toBe(beforeMeta[EMBEDDER_META_KEY]);
    expect(rows()).toEqual(beforeRows);
  });

  test("openCache alone never stamps a newer version down", () => {
    seed(undefined);
    stampVersion("7");
    openCache(paths.cache(dir)).close();
    expect(meta()["schemaVersion"]).toBe("7");
  });

  test("an OLDER cache is still migrated up, as before", () => {
    seed(undefined);
    stampVersion("4");
    openCache(paths.cache(dir)).close();
    expect(meta()["schemaVersion"]).toBe(String(CACHE_SCHEMA_VERSION));
  });
});
