/**
 * The static tier, wired: `embedder.kind` in the strict config reader, the
 * static table behind the `LiveEmbedder` seat, and the two worker jobs
 * (`vectors.ts`). Since 2026-09-24 it is the only embedder there is; the paid
 * shapes below are local fakes that exercise the store's identity rules.
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
import { EMBEDDER_KINDS, loadConfig } from "../src/adapters/claude-code/config.js";
import { STATIC_BACKFILL_LIMIT, backfillVectors, laggedSemantic } from "../src/adapters/claude-code/vectors.js";
import { createStaticEmbedder, openEmbedder, openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { loadStaticModel } from "../src/core/embed/static.js";
import { openServer } from "../src/adapters/mcp/index.js";
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
  test("static is the one kind; voyage (removed 2026-09-24) reads as static; absent kind is static", () => {
    expect(EMBEDDER_KINDS).toEqual(["static"]);
    const s = loadConfig({ embedder: { enabled: true, kind: "static" } });
    expect(s.ok).toBe(true);
    expect(s.config.embedder).toEqual({ enabled: true, kind: "static" });
    const v = loadConfig({ embedder: { enabled: true, kind: "voyage" } });
    expect(v.ok).toBe(true);
    expect(v.config.embedder).toEqual({ enabled: true, kind: "static" });
    const old = loadConfig({ embedder: { enabled: true } });
    expect(old.config.embedder).toEqual({ enabled: true });
  });

  test("a kind that is present and not one this build knows stands the configuration down", () => {
    for (const kind of ["potion", "Static", "", 3, null, true]) {
      const got = loadConfig({ dataDir: "/tmp/x", embedder: { enabled: true, kind } });
      expect(got.ok).toBe(false);
      expect(got.reason).toBe("unreadable");
      expect(got.config.observer).toBe(true);
    }
  });
});

describe("openEmbedder — which embedder the knob switches on", () => {
  test("kind static: the table", () => {
    const e = openEmbedder({ embedder: { enabled: true, kind: "static" } }, { weightsDir: weights });
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("static");
    expect(e?.model).toMatch(/^static-[0-9a-f]{12}$/); // from the bytes; the package label is display only
    expect(e?.weights).toBe("option");
    expect(e?.embed.identity).toEqual({ model: e?.model ?? "", dim: 4, rebuild: "inline" });
    // The SYNC face computes — that is the whole of "in-process embedding".
    expect(e?.embed("the otter survey")?.length).toBe(4);
  });

  test("kind absent: the table too — there is no other embedder", () => {
    const e = openEmbedder({ embedder: { enabled: true } }, { weightsDir: weights });
    expect(e?.kind).toBe("static");
    expect(e?.embed.identity?.rebuild).toBe("inline");
  });

  test("disabled or observer: no embedder of either kind", () => {
    expect(openEmbedder({ embedder: { enabled: false, kind: "static" } }, { weightsDir: weights })).toBeNull();
    expect(openEmbedder({ observer: true, embedder: { enabled: true, kind: "static" } }, { weightsDir: weights })).toBeNull();
  });

  test("a table that will not load: a named refusal, and an UNAVAILABLE embedder carrying the code — never a failed hook", () => {
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const e = openStaticEmbedder({
      weightsDir: join(weights, "nope"),
      onEvent: (name, data) => events.push({ name, data }),
    });
    expect(events).toEqual([{ name: "embed.refused", data: { code: "MISSING_FILE", kind: "static", source: "option" } }]);
    expect(e.unavailable).toBe("MISSING_FILE");
    expect(e.embed("the otter survey")).toBeNull();
    expect(e.embed.identity).toBeUndefined(); // the store never reconciles against it
  });

  test("the loaded event names the model, width, source and load time — never a path", () => {
    const events: { name: string; data: Record<string, unknown> }[] = [];
    openStaticEmbedder({ env: { COUNTERPARTS_STATIC_WEIGHTS_DIR: weights }, onEvent: (name, data) => events.push({ name, data }) });
    expect(events[0]?.name).toBe("embed.static.loaded");
    expect(events[0]?.data).toMatchObject({ dim: 4, source: "env" });
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
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: `${e.model}@4`, adopted: 0 });
    const id = s.put({ type: "memory", kind: "fact", body: "The otter survey found eleven holts on the river." });
    expect(s.unembeddedCount()).toBe(0);
    expect(s.nearestTo(e.embed("otter holt river") ?? [], 1)[0]?.id).toBe(id);
    c.close();
    opened.length = 0;
    const db = openDb(paths.cache(dir));
    const tag = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = ?", EMBEDDER_META_KEY)?.value;
    db.close();
    expect(tag).toBe(`${e.model}@4`);
  });
});

describe("vectors.ts — the worker's two jobs, on the table", () => {
  test("backfill: rows written by a process with no embedder are filled", async () => {
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
    const report = await backfillVectors({ counterpart: c, embedder: e });
    expect(report.reason).toBe("ran");
    expect(report.embedded).toBe(1);
    expect(report.remaining).toBe(0);
  });

  test("the static bound is its own: larger than the paid one", () => {
    expect(STATIC_BACKFILL_LIMIT).toBeGreaterThan(64);
  });

  test("the lagged cue computes on the table", async () => {
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
    const lag = await laggedSemantic({ counterpart: c, sessionId: "s1", scope: "proj", embedder: e });
    expect(lag.reason).toBe("ok");
    expect(lag.hits).toBeGreaterThan(0);
  });
});

describe("a withdrawn vector channel costs no call (held / cache-ahead)", () => {
  /** A paid-shaped embedder whose every live half throws if touched. */
  function tripwire(model: string): LiveEmbedder {
    const identity = { model, dim: null, rebuild: "external" as const };
    return {
      model,
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
    const report = await backfillVectors({ counterpart: c, embedder: tripwire("paid-b") });
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
      await backfillVectors({ counterpart: c, embedder: e });
    }
    expect(c.store.skippedVectorIds()).toEqual([unknown]);
    expect(c.store.unembeddedCount()).toBe(0);
    const after = await backfillVectors({ counterpart: c, embedder: e });
    expect(after.reason).toBe("nothing-missing");
    expect(after.skipped).toBe(1);
  });
});

describe("an embedder that was asked for and is not here reaches a DURABLE row (review MAJOR 3)", () => {
  test("backfill: reason embedder-unavailable, the code in codes, kind static — in box 2's event log", async () => {
    const e = openStaticEmbedder({ weightsDir: join(weights, "nope") });
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    c.store.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    expect(c.store.embedderVerdict).toEqual({ kind: "none" }); // no identity, nothing reconciled
    const report = await backfillVectors({ counterpart: c, embedder: e });
    expect(report).toMatchObject({ reason: "embedder-unavailable", codes: "MISSING_FILE", kind: "static", attempted: 0 });
    const row = c.store.eventLog({ name: "adapter.embed.backfill" }).at(-1);
    expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({ reason: "embedder-unavailable", codes: "MISSING_FILE" });
  });

  test("a working table's row says which rule found its weights and which model ran", async () => {
    const e = openStaticEmbedder({ weightsDir: weights });
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    const report = await backfillVectors({ counterpart: c, embedder: e });
    expect(report).toMatchObject({ kind: "static", weights: "option", model: e.model });
  });

  test("the lagged cue records embed-failed with the refusal beside it", async () => {
    const e = openStaticEmbedder({ weightsDir: join(weights, "nope") });
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, embed: e.embed, vectors: e });
    opened.push(c);
    c.captureSpans({ session: "s1", scope: "proj", turns: [{ role: "user", text: "Where is the otter holt?" }] });
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s1",
      scope: "proj",
      embedder: e,
      onEvent: (name, data) => events.push({ name, data }),
    });
    expect(lag.reason).toBe("embed-failed");
    expect(events.find((x) => x.name === "vectors.lag")?.data).toMatchObject({ unavailable: "MISSING_FILE" });
  });
});

describe("embedder.kind is ignored while the embedder is OFF (review MINOR 5)", () => {
  test("a typo in a switched-off knob does not stand memory down", () => {
    for (const kind of ["static ", "Static", "potion"]) {
      const got = loadConfig({ dataDir: "/tmp/x", embedder: { enabled: false, kind } });
      expect(got.ok).toBe(true);
      expect(got.config.observer).toBeUndefined();
      expect(got.config.embedder).toEqual({ enabled: false });
    }
    expect(loadConfig({ embedder: { enabled: false, kind: "static" } }).config.embedder).toEqual({ enabled: false, kind: "static" });
  });

  test("switched ON, the bad key is named in the unreadable reason", () => {
    const got = loadConfig({ dataDir: "/tmp/x", embedder: { enabled: true, kind: "potion" } });
    expect(got.reason).toBe("unreadable");
    expect(got.unreadableKeys).toEqual(["embedder.kind"]);
    expect(loadConfig({ embedder: { enabled: "yes" } }).unreadableKeys).toEqual(["embedder.enabled"]);
  });
});

describe("the MCP server's store reconciles like a hook's (review MAJOR 1)", () => {
  test("openServer hands the embedder's identity to its store: tagged, and a note gets its vector at write time", () => {
    const e = openStaticEmbedder({ weightsDir: weights });
    const server = openServer({ dir, owner: true, embedder: e });
    opened.push({ close: () => server.counterpart.close() });
    const s = server.counterpart.store;
    expect(s.embedderVerdict).toEqual({ kind: "tagged", tag: `${e.model}@4`, adopted: 0 });
    s.put({ type: "memory", kind: "fact", body: "The otter survey found eleven holts." });
    expect(s.unembeddedCount()).toBe(0);
  });

  test("a held box 3 answers the server's ranking with nothing", () => {
    const paidA = Object.assign((t: string): number[] | null => [t.length, 1, 2, 3], {
      identity: { model: "voyage-3-large", dim: null, rebuild: "external" as const },
    });
    const seedStore = Store.open({ dir, embed: paidA });
    seedStore.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    seedStore.close();
    const paidB = Object.assign((): number[] | null => null, {
      identity: { model: "voyage-3.5", dim: null, rebuild: "external" as const },
    });
    Store.open({ dir, embed: paidB }).close();
    // The server with NO embedder at all still sees the hold.
    const server = openServer({ dir, owner: true });
    opened.push({ close: () => server.counterpart.close() });
    expect(server.counterpart.store.embedderVerdict.kind).toBe("held");
    expect(server.counterpart.store.nearestTo([10, 1, 2, 3], 3)).toEqual([]);
  });
});


describe("MAJOR A of the re-review, through the real chain: the session-long MCP server after a hook flips the store", () => {
  test("server under the static table, a hook resets the store to the paid seat, `note` files NO vector under the paid tag and the question ranks nothing", async () => {
    const e = openStaticEmbedder({ weightsDir: weights });
    const server = openServer({ dir, session: "s-mcp", scope: "/scope/one", owner: true, embedder: e });
    opened.push({ close: () => server.counterpart.close() });
    server.counterpart.store.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    expect(server.counterpart.store.embedderVerdict.kind).toBe("tagged");
    // A hook opens with a paid-shaped seat (the shape the removed Voyage seat
    // had: a cache that misses, a known width, rebuilt externally).
    const paid = {
      embed: Object.assign((): number[] | null => null, {
        identity: { model: "voyage-3-large", dim: 1024, rebuild: "external" as const },
      }),
    };
    const hook = Store.open({ dir, embed: paid.embed });
    expect(hook.embedderVerdict).toMatchObject({ kind: "reset", to: "voyage-3-large" });
    hook.close();
    const result = await server.call("note", { text: "The survey resumes after the flood on the river." });
    expect(result.structuredContent["stored"]).toBe(true);
    const id = result.structuredContent["id"] as string;
    const db = openDb(paths.cache(dir));
    const widths = db.all<{ dim: number }>("SELECT dim FROM embeddings").map((r) => r.dim);
    const tag = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = ?", EMBEDDER_META_KEY)?.value;
    db.close();
    expect(widths).toEqual([]); // nothing 4-wide filed under the paid tag
    expect(tag).toBe("voyage-3-large");
    // The note waits for the paid seat's backfill, which will see it.
    const owner = Store.open({ dir, embed: paid.embed });
    expect(owner.missingVectors(10)).toContain(id);
    owner.close();
    // And the stale server's question ranks nothing (identity-changed), by name.
    const q = e.embed("otter river") ?? [];
    expect(server.counterpart.store.nearestTo(q, 3)).toEqual([]);
  });
});

describe("`\"embedder\": null` is an unreadable configuration, never a throw (re-review MINOR A)", () => {
  test("the reader returns observer with the key named", () => {
    for (const bad of [null, "on", [], 3]) {
      const got = loadConfig({ dataDir: "/tmp/x", embedder: bad });
      expect(got.reason).toBe("unreadable");
      expect(got.config.observer).toBe(true);
      expect(got.unreadableKeys).toEqual(["embedder"]);
    }
  });
});

describe("the two per-write checks compose in one MCP server: #187's schema guard and #190's identity check", () => {
  test("an identity change refuses the VECTOR (words still land); a schema stamped ahead refuses the WHOLE write", async () => {
    const e = openStaticEmbedder({ weightsDir: weights });
    const server = openServer({ dir, session: "s-both", scope: "/scope/one", owner: true, embedder: e });
    opened.push({ close: () => server.counterpart.close() });
    const store = server.counterpart.store;
    store.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });

    // 1. #190's check, inside the vector's own transaction: a hook takes the file for another identity.
    const other = Object.assign((): number[] | null => [1, 0, 0, 0], {
      identity: { model: "another-static", dim: 4, rebuild: "inline" as const },
    });
    Store.open({ dir, embed: other }).close();
    const noted = await server.call("note", { text: "The survey resumes after the flood on the river." });
    expect(noted.structuredContent["stored"]).toBe(true); // #187's guard let the write through
    const id = noted.structuredContent["id"] as string;
    expect(store.events("cache.vector.refused").some((ev) => ev.ref === id && ev.data?.["reason"] === "identity-changed")).toBe(true);

    // 2. #187's guard, before any transaction: box 2's stamp moves ahead under the server.
    const before = store.list({ archived: false }).length;
    const db2 = openDb(paths.operational(dir));
    const stamp = db2.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? "0";
    db2.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(Number(stamp) + 1));
    db2.close();
    let code: string | null = null;
    let by: unknown = null;
    try {
      store.put({ type: "memory", kind: "fact", body: "A write the guard must refuse." });
    } catch (err) {
      code = (err as { code?: string }).code ?? "OTHER";
      by = (err as { detail?: Record<string, unknown> }).detail?.["refusedBy"];
    }
    expect(code).toBe("SCHEMA_AHEAD");
    expect(by).toBe("mcp-write-guard");
    expect(store.list({ archived: false }).length).toBe(before);
    // And the tool itself refuses at entry, by name.
    const refused = await server.call("note", { text: "Refused before anything is touched." });
    expect(JSON.stringify(refused.structuredContent)).toContain("schema-ahead");
  });
});
