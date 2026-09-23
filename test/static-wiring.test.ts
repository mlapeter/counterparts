/**
 * The static tier, wired: `embedder.kind` in the strict config reader, the
 * static table behind the same `LiveEmbedder` seat the paid client fills, and
 * the two worker jobs (`vectors.ts`) that must not ask a table for a Voyage key.
 *
 * Hermetic: a synthetic eight-row table in a fresh temp dir, a fresh temp store
 * per test, no network, no environment read (every resolution is handed its
 * directory or an empty env).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { EMBEDDER_KINDS, embedderKind, loadConfig } from "../src/adapters/claude-code/config.js";
import { STATIC_BACKFILL_LIMIT, backfillVectors, laggedSemantic } from "../src/adapters/claude-code/vectors.js";
import { createEmbedder, createStaticEmbedder, openEmbedder, openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { loadStaticModel } from "../src/core/embed/static.js";
import { EMBEDDER_META_KEY, EMBED_SKIP_AFTER, Store, paths } from "../src/core/store/index.js";
import type { LiveEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { openDb } from "../src/core/store/db.js";

const VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "otter", "river", "holt", "survey", "rota", "ward", "shift"];

function writeTable(dir: string): void {
  const width = 4;
  const rows = VOCAB.map((_, i) => [Math.cos(i), Math.sin(i), (i % 3) - 1, 1]);
  const bytes = new Uint8Array(new Float32Array(rows.flat()).buffer);
  let header = JSON.stringify({ embeddings: { dtype: "F32", shape: [VOCAB.length, width], data_offsets: [0, bytes.byteLength] } });
  while ((8 + header.length) % 8 !== 0) header += " ";
  const h = new TextEncoder().encode(header);
  const out = new Uint8Array(8 + h.byteLength + bytes.byteLength);
  new DataView(out.buffer).setBigUint64(0, BigInt(h.byteLength), true);
  out.set(h, 8);
  out.set(bytes, 8 + h.byteLength);
  writeFileSync(join(dir, "model.safetensors"), out);
  writeFileSync(join(dir, "vocab.txt"), `${VOCAB.join("\n")}\n`);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", counterparts: { model: "tiny-static" } }));
}

let weights: string;
let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  weights = mkdtempSync(join(tmpdir(), "cp-weights-"));
  dir = mkdtempSync(join(tmpdir(), "cp-static-store-"));
  writeTable(weights);
});
afterEach(() => {
  for (const o of opened.splice(0)) {
    try {
      o.close();
    } catch {
      // closed already
    }
  }
  rmSync(weights, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe("embedder.kind — the strict reader", () => {
  test("static and voyage are read; absent kind is today's behaviour (voyage)", () => {
    expect(EMBEDDER_KINDS).toEqual(["static", "voyage"]);
    const s = loadConfig({ embedder: { enabled: true, kind: "static" } });
    expect(s.ok).toBe(true);
    expect(s.config.embedder).toEqual({ enabled: true, kind: "static" });
    expect(embedderKind(s.config)).toBe("static");
    const v = loadConfig({ embedder: { enabled: true, kind: "voyage" } });
    expect(embedderKind(v.config)).toBe("voyage");
    const old = loadConfig({ embedder: { enabled: true } });
    expect(old.config.embedder).toEqual({ enabled: true });
    expect(embedderKind(old.config)).toBe("voyage");
    expect(embedderKind(loadConfig({}).config)).toBe("voyage");
  });

  test("a kind that is present and not one of the two stands the configuration down", () => {
    for (const kind of ["potion", "Static", "", 3, null, true]) {
      const got = loadConfig({ dataDir: "/tmp/x", embedder: { enabled: true, kind } });
      expect(got.ok).toBe(false);
      expect(got.reason).toBe("unreadable");
      expect(got.config.observer).toBe(true);
    }
  });
});

describe("openEmbedder — which embedder the knob switches on", () => {
  test("kind static: the table, in the paid seat's shape, needing no key", () => {
    const e = openEmbedder({ embedder: { enabled: true, kind: "static" } }, { weightsDir: weights });
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("static");
    expect(e?.needsCredential).toBe(false);
    expect(e?.model).toBe("tiny-static");
    expect(e?.embed.identity).toEqual({ model: "tiny-static", dim: 4, rebuild: "inline" });
    // The SYNC face computes — that is the whole of "in-process embedding".
    expect(e?.embed("the otter survey")?.length).toBe(4);
  });

  test("kind absent: the paid seat, unchanged, now carrying its identity", () => {
    const e = openEmbedder({ embedder: { enabled: true } });
    expect(e?.kind).toBe("voyage");
    expect(e?.needsCredential).toBe(true);
    expect(e?.embed.identity).toEqual({ model: "voyage-3-large", dim: null, rebuild: "external" });
    // Cache only: a miss is null, never a socket.
    expect(e?.embed("anything")).toBeNull();
  });

  test("disabled or observer: no embedder of either kind", () => {
    expect(openEmbedder({ embedder: { enabled: false, kind: "static" } }, { weightsDir: weights })).toBeNull();
    expect(openEmbedder({ observer: true, embedder: { enabled: true, kind: "static" } }, { weightsDir: weights })).toBeNull();
  });

  test("a table that will not load is a named refusal and no embedder — never a failed hook", () => {
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const e = openStaticEmbedder({
      weightsDir: join(weights, "nope"),
      onEvent: (name, data) => events.push({ name, data }),
    });
    expect(e).toBeNull();
    expect(events).toEqual([{ name: "embed.refused", data: { code: "MISSING_FILE", kind: "static", source: "option" } }]);
  });

  test("the loaded event names the model, width, source and load time — never a path", () => {
    const events: { name: string; data: Record<string, unknown> }[] = [];
    openStaticEmbedder({ env: { COUNTERPARTS_STATIC_WEIGHTS_DIR: weights }, onEvent: (name, data) => events.push({ name, data }) });
    expect(events[0]?.name).toBe("embed.static.loaded");
    expect(events[0]?.data).toMatchObject({ model: "tiny-static", dim: 4, source: "env" });
    expect(JSON.stringify(events)).not.toContain(weights);
  });

  test("the static vector() and warm() never throw and never fetch", async () => {
    const e = createStaticEmbedder(loadStaticModel({ dir: weights }));
    expect(await e.vector("")).toBeNull();
    expect(await e.vector("zzz")).toBeNull(); // no known token → null, counted
    expect((await e.vector("river holt"))?.length).toBe(4);
    expect(await e.warm(["otter", "", "rota"])).toBe(2);
    expect(e.stats()).toMatchObject({ fetched: 0, failed: 0, lastFailures: [] });
    expect(e.stats().misses).toBe(1);
  });
});

describe("in-process embedding: a memory has its vector in the process that wrote it", () => {
  test("a memory lands with its vector at write time, and box 3 is tagged — no worker ran", () => {
    const e = createStaticEmbedder(loadStaticModel({ dir: weights }));
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    const s = c.store;
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: "tiny-static@4", adopted: 0 });
    const id = s.put({ type: "memory", kind: "fact", body: "The otter survey found eleven holts on the river." });
    expect(s.unembeddedCount()).toBe(0);
    expect(s.nearestTo(e.embed("otter holt river") ?? [], 1)[0]?.id).toBe(id);
    c.close();
    opened.length = 0;
    const db = openDb(paths.cache(dir));
    const tag = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = ?", EMBEDDER_META_KEY)?.value;
    db.close();
    expect(tag).toBe("tiny-static@4");
  });
});

describe("vectors.ts — the worker's two jobs never ask a table for a Voyage key", () => {
  test("backfill: rows written by a process with no embedder are filled, with no credential", async () => {
    // A process with no embedder (the MCP server's `note`, today) writes two memories.
    const bare = Store.open({ dir });
    bare.put({ type: "memory", kind: "fact", body: "The ward rota changes every shift." });
    bare.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    bare.close();
    const e = createStaticEmbedder(loadStaticModel({ dir: weights }));
    // Opening with the table tags box 3 and refills inline at open...
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    expect(c.store.unembeddedCount()).toBe(0);
    // ...and a row written afterwards by a bare process is the backfill's.
    const bare2 = Store.open({ dir });
    bare2.put({ type: "memory", kind: "fact", body: "The survey resumes after the flood." });
    bare2.close();
    const report = await backfillVectors({ counterpart: c, embedder: e, hasCredential: false });
    expect(report.reason).toBe("ran");
    expect(report.embedded).toBe(1);
    expect(report.remaining).toBe(0);
  });

  test("the static bound is its own: larger than the paid one", () => {
    expect(STATIC_BACKFILL_LIMIT).toBeGreaterThan(64);
  });

  test("the lagged cue computes with no credential for the table — and still refuses for the paid seat", async () => {
    const e = createStaticEmbedder(loadStaticModel({ dir: weights }));
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    c.store.put({ type: "memory", kind: "fact", body: "The otter survey found eleven holts." });
    c.captureSpans({
      session: "s1",
      scope: "proj",
      turns: [
        { role: "user", text: "How many holts did the otter survey find on the river?" },
        { role: "assistant", text: "Eleven." },
      ],
    });
    const lag = await laggedSemantic({ counterpart: c, sessionId: "s1", scope: "proj", embedder: e, hasCredential: false });
    expect(lag.reason).toBe("ok");
    expect(lag.hits).toBeGreaterThan(0);
    const paid = createEmbedder({ client: async () => ({ model: "m", vectors: [], requested: 0, returned: 0, chunks: 0, failures: [] }) });
    const refused = await laggedSemantic({ counterpart: c, sessionId: "s1", scope: "proj", embedder: paid, hasCredential: false });
    expect(refused.reason).toBe("no-credentials");
  });
});

describe("a withdrawn vector channel costs no call (held / cache-ahead)", () => {
  /** A paid-shaped embedder whose every network half throws if touched. */
  function tripwire(model: string): LiveEmbedder {
    const identity = { model, dim: null, rebuild: "external" as const };
    return {
      model,
      kind: "voyage",
      needsCredential: true,
      embed: Object.assign((): number[] | null => null, { identity }),
      vector: async (): Promise<number[] | null> => {
        throw new Error("PAID CALL: vector() on a withdrawn channel");
      },
      warm: async (): Promise<number> => {
        throw new Error("PAID CALL: warm() on a withdrawn channel");
      },
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
    };
  }

  function heldCounterpart(): Counterpart {
    // Paid model A wrote the vectors; the config now names paid model B.
    const a = Object.assign((t: string): number[] | null => [t.length, 1, 2], {
      identity: { model: "paid-a", dim: null, rebuild: "external" as const },
    });
    const s = Store.open({ dir, embed: a });
    s.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    s.close();
    const b = tripwire("paid-b");
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: b.embed, vectors: b });
    opened.push(c);
    expect(c.store.embedderVerdict.kind).toBe("held");
    c.store.put({ type: "memory", kind: "fact", body: "A second memory, written while held." });
    return c;
  }

  test("backfill: no warm(), reason vectors-withdrawn, the verdict named in codes", async () => {
    const c = heldCounterpart();
    const report = await backfillVectors({ counterpart: c, embedder: tripwire("paid-b"), hasCredential: true });
    expect(report.reason).toBe("vectors-withdrawn");
    expect(report.codes).toBe("held");
    expect(report.attempted).toBe(0);
  });

  test("lagged cue: no vector(), recorded embed-failed with the verdict beside it", async () => {
    const c = heldCounterpart();
    c.captureSpans({
      session: "s1",
      scope: "proj",
      turns: [
        { role: "user", text: "Where is the otter holt?" },
        { role: "assistant", text: "By the river." },
      ],
    });
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s1",
      scope: "proj",
      embedder: tripwire("paid-b"),
      hasCredential: true,
      onEvent: (name, data) => events.push({ name, data }),
    });
    expect(lag.reason).toBe("embed-failed");
    expect(events.find((e) => e.name === "vectors.lag")?.data).toMatchObject({ withdrawn: "held" });
  });
});

describe("a static table's null is the item's, so the backfill retires it", () => {
  test("a memory with no known token is skip-listed after EMBED_SKIP_AFTER runs and stops being offered", async () => {
    const bare = Store.open({ dir });
    const unknown = bare.put({ type: "memory", kind: "fact", body: "🙂🙂 ¿¿ zzqx" });
    bare.close();
    const e = createStaticEmbedder(loadStaticModel({ dir: weights }));
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    // The at-open refill could not embed it either — it has no token the table knows.
    expect(c.store.missingVectors(10)).toEqual([unknown]);
    for (let run = 0; run < EMBED_SKIP_AFTER; run++) {
      await backfillVectors({ counterpart: c, embedder: e, hasCredential: false });
    }
    expect(c.store.skippedVectorIds()).toEqual([unknown]);
    expect(c.store.unembeddedCount()).toBe(0);
    const after = await backfillVectors({ counterpart: c, embedder: e, hasCredential: false });
    expect(after.reason).toBe("nothing-missing");
    expect(after.skipped).toBe(1);
  });
});
