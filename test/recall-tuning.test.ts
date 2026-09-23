/**
 * Per-embedder, per-path semantic calibration (keyless/recall-tune, 2026-09-23).
 *
 * `SEMANTIC_BY_IDENTITY` is keyed by the identity box 3 RECORDS for its
 * vectors; `activate` looks it up at query time from the store it ranks
 * against, on the path the semantic input came by (`vector` → inline, `hits` →
 * lagged). An identity with no entry — or none at all — gets the defaults
 * every store had before the table existed.
 *
 * Hermetic: a fresh temp store per test, deterministic stub embedders carrying
 * the identities under test. No table, no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Recall,
  TUNABLES,
  activate,
  loadGateState,
  loadSessionSemantic,
  recordedIdentity,
  saveSessionSemantic,
  semanticTuning,
  withTunables,
} from "../src/core/recall/index.js";
import type { RecallTunables } from "../src/core/recall/index.js";
import { Store, paths } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
import type { Embedder, EmbedderIdentity } from "../src/core/store/index.js";

let dir: string;
const opened: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-recall-tuning-"));
});
afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      // closed
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

const POTION: EmbedderIdentity = { model: "potion-base-8M", dim: 256, rebuild: "inline" };

function embedder(identity: EmbedderIdentity | undefined, dim: number): Embedder {
  const fn = (text: string): number[] | null => {
    const v = new Array<number>(dim).fill(0);
    for (let i = 0; i < text.length; i++) v[i % dim] = (v[i % dim] ?? 0) + text.charCodeAt(i);
    return v;
  };
  return identity === undefined ? fn : Object.assign(fn, { identity });
}

function store(embed?: Embedder): Store {
  const s = Store.open({ dir, ...(embed === undefined ? {} : { embed }) });
  opened.push(s);
  return s;
}

describe("semanticTuning — the lookup", () => {
  const t = TUNABLES;
  const defaults = { floor: t.SEMANTIC_SEED_FLOOR, weight: t.SEMANTIC_WEIGHT };

  test("the exact tag wins; each path has its own pair", () => {
    expect(semanticTuning(t, "potion-base-8M@256", "inline")).toEqual({ floor: 0.15, weight: 6 });
    expect(semanticTuning(t, "potion-base-8M@256", "lagged")).toEqual({ floor: 0.05, weight: 1 });
  });

  test("the model alone answers a tag with a width (a paid seat's `voyage-3-large@1024`)", () => {
    expect(semanticTuning(t, "voyage-3-large@1024", "inline")).toEqual({ floor: 0.45, weight: 1.0 });
    expect(semanticTuning(t, "voyage-3-large", "lagged")).toEqual({ floor: 0.45, weight: 1.0 });
  });

  test("no identity, an unknown one, another width of a known table, or a prototype key: the defaults", () => {
    expect(semanticTuning(t, null, "inline")).toEqual(defaults);
    expect(semanticTuning(t, "static-3805f5047473@256", "lagged")).toEqual(defaults);
    expect(semanticTuning(t, "potion-base-8M@128", "inline")).toEqual(defaults);
    expect(semanticTuning(t, "toString", "inline")).toEqual(defaults);
  });

  test("the model part is split like the store splits a tag: only an integer after the last `@`", () => {
    const withOdd: RecallTunables = withTunables({
      SEMANTIC_BY_IDENTITY: { "org@model": { inline: { floor: 0.2, weight: 3 }, lagged: { floor: 0.3, weight: 2 } } },
    });
    // `org@model` is a model id containing `@`, not model `org` at width `model`.
    expect(semanticTuning(withOdd, "org@model", "inline")).toEqual({ floor: 0.2, weight: 3 });
    expect(semanticTuning(withOdd, "org@model@256", "lagged")).toEqual({ floor: 0.3, weight: 2 });
    expect(semanticTuning(TUNABLES, "voyage-3-large@beta", "inline")).toEqual(defaults);
  });

  test("an emptied table sends every identity to the defaults (how the bench sweeps)", () => {
    const swept: RecallTunables = withTunables({ SEMANTIC_BY_IDENTITY: {}, SEMANTIC_SEED_FLOOR: 0.3, SEMANTIC_WEIGHT: 2 });
    expect(semanticTuning(swept, "potion-base-8M@256", "inline")).toEqual({ floor: 0.3, weight: 2 });
  });
});

describe("recordedIdentity — what box 3 records, read fresh at every activation", () => {
  test("tagged, then match: the table's own tag", () => {
    expect(recordedIdentity(store(embedder(POTION, 256)))).toBe("potion-base-8M@256");
    opened.splice(0).forEach((s) => s.close());
    expect(recordedIdentity(store(embedder(POTION, 256)))).toBe("potion-base-8M@256");
  });

  test("reset: the NEW identity", () => {
    store(embedder({ model: "static-old", dim: 256, rebuild: "inline" }, 256)).put({ type: "memory", kind: "fact", body: "a memory" });
    opened.splice(0).forEach((s) => s.close());
    const s = store(embedder(POTION, 256));
    expect(s.embedderVerdict.kind).toBe("reset");
    expect(recordedIdentity(s)).toBe("potion-base-8M@256");
  });

  test("no embedder, or a plain-function one: null (the defaults apply)", () => {
    expect(recordedIdentity(store())).toBeNull();
    opened.splice(0).forEach((s) => s.close());
    expect(recordedIdentity(store(embedder(undefined, 8)))).toBeNull();
  });

  test("a hold: null — and the ranking is empty anyway", () => {
    const paidA: EmbedderIdentity = { model: "paid-a", dim: null, rebuild: "external" };
    store(embedder(paidA, 8)).put({ type: "memory", kind: "fact", body: "a memory" });
    opened.splice(0).forEach((s) => s.close());
    const s = store(embedder({ model: "paid-b", dim: null, rebuild: "external" }, 8));
    expect(s.embedderVerdict.kind).toBe("held");
    expect(recordedIdentity(s)).toBeNull();
  });
});

describe("activate — the store's recorded identity and the path choose the calibration", () => {
  function fixture(embed?: Embedder): { s: Store; id: string } {
    const s = store(embed);
    const id = s.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    for (let i = 0; i < 6; i++) s.put({ type: "memory", kind: "fact", body: `filler memory number ${i} about something else` });
    return { s, id };
  }

  const base = (s: Store) => ({
    text: "what did the survey find",
    day: s.livedDay(),
    selfFelt: false,
    maxCandidates: 100,
    storeSize: s.list({ archived: false }).length,
  });

  test("a potion store: `hits` run the LAGGED pair, a `vector` the INLINE pair — and the same hit scores differently", () => {
    const { s, id } = fixture(embedder(POTION, 256));
    const hits = [{ id, score: 0.5 }];
    const lagged = activate(s, { ...base(s), hits }, TUNABLES);
    expect(lagged.semantic).toEqual({ identity: "potion-base-8M@256", path: "lagged", floor: 0.05, weight: 1 });
    const lag = lagged.candidates.find((c) => c.id === id)?.semantic ?? 0;
    expect(lag).toBeCloseTo((1 * (0.5 - 0.05)) / (1 - 0.05), 6);

    const vector = embedder(POTION, 256)("\nThe otter holt is by the river.") ?? [];
    const inline = activate(s, { ...base(s), vector }, TUNABLES);
    expect(inline.semantic).toEqual({ identity: "potion-base-8M@256", path: "inline", floor: 0.15, weight: 6 });
    // The same hit under the inline pair would weigh 6·(0.5−0.15)/0.85 ≈ 2.47 against the lag's ≈ 0.47.
    const same = activate(s, { ...base(s), hits }, withTunables({ SEMANTIC_BY_IDENTITY: { "potion-base-8M@256": { inline: { floor: 0.15, weight: 6 }, lagged: { floor: 0.15, weight: 6 } } } }));
    expect(same.candidates.find((c) => c.id === id)?.semantic ?? 0).toBeCloseTo((6 * (0.5 - 0.15)) / 0.85, 6);
  });

  test("a store with no identity keeps TODAY's numbers exactly (floor 0.45, weight 1)", () => {
    const { s, id } = fixture(embedder(undefined, 8));
    const got = activate(s, { ...base(s), hits: [{ id, score: 0.5 }] }, TUNABLES);
    expect(got.semantic).toEqual({ identity: null, path: "lagged", floor: 0.45, weight: 1.0 });
    expect(got.candidates.find((c) => c.id === id)?.semantic ?? 0).toBeCloseTo((0.5 - 0.45) / (1 - 0.45), 6);
  });

  test("no semantic input at all: nothing is chosen, nothing is reported", () => {
    const { s } = fixture(embedder(POTION, 256));
    expect(activate(s, base(s), TUNABLES).semantic).toBeNull();
  });
});

describe("review of #193 — the fixes, pinned", () => {
  test("MINOR 1: a lag row ranked under ANOTHER table is dropped (`other-model`), never scaled by potion's pair", () => {
    const other: EmbedderIdentity = { model: "static-other", dim: 256, rebuild: "inline" };
    const s0 = store(embedder(other, 256));
    const ids = ["The otter holt is by the river.", "The survey resumes after the flood.", "The ward rota changes weekly."].map(
      (body) => s0.put({ type: "memory", kind: "fact", body }),
    );
    // The worker ranked the last exchange under static-other and stamped it for the next turn.
    saveSessionSemantic(s0, {
      sessionId: "s-other",
      turn: loadGateState(s0, "s-other").state.turn,
      lastDay: s0.livedDay(),
      reason: "ok",
      model: "static-other",
      dim: 256,
      hits: ids.map((id) => ({ id, score: 0.4 })),
    });
    expect(loadSessionSemantic(s0, "s-other").source).toBe("lagged");
    opened.splice(0).forEach((x) => x.close());
    // The next hook opens under potion: the store resets.
    const s1 = store(embedder(POTION, 256));
    expect(s1.embedderVerdict.kind).toBe("reset");
    const lag = loadSessionSemantic(s1, "s-other");
    expect(lag.source).toBe("other-model");
    expect(lag.hits).toBeNull();
    // Through the real recording path: no candidate carries another model's cosine.
    const got = new Recall({ store: s1, owner: true }).recall({ sessionId: "s-other", text: "what did we note", owner: true });
    expect(got.decision.semanticUsed).toBe(false);
    // A row ranked under the model the file records now is used as before.
    saveSessionSemantic(s1, {
      sessionId: "s-same",
      turn: loadGateState(s1, "s-same").state.turn,
      lastDay: s1.livedDay(),
      reason: "ok",
      model: "potion-base-8M",
      dim: 256,
      hits: ids.map((id) => ({ id, score: 0.4 })),
    });
    expect(loadSessionSemantic(s1, "s-same").source).toBe("lagged");
  });

  test(
    "MINOR 2: a `deferred` open still gets the file's calibration once the file is tagged (5 s lock)",
    () => {
      // A fresh store needs its cache file first.
      store().close();
      opened.length = 0;
      const lock = openDb(paths.cache(dir));
      lock.exec("BEGIN IMMEDIATE");
      let h: Store;
      try {
        h = store(embedder(POTION, 256));
      } finally {
        lock.exec("ROLLBACK");
        lock.close();
      }
      expect(h.embedderVerdict).toEqual({ kind: "deferred", reason: "locked" });
      // Another handle settles the tag and writes real vectors.
      const w = Store.open({ dir, embed: embedder(POTION, 256) });
      const id = w.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
      for (let i = 0; i < 4; i++) w.put({ type: "memory", kind: "fact", body: `filler ${i}` });
      w.close();
      expect(recordedIdentity(h)).toBe("potion-base-8M@256");
      const vector = embedder(POTION, 256)("\nThe otter holt is by the river.") ?? [];
      const act = activate(
        h,
        { text: "otter", day: h.livedDay(), selfFelt: false, maxCandidates: 100, storeSize: 5, vector },
        TUNABLES,
      );
      expect(act.semantic).toEqual({ identity: "potion-base-8M@256", path: "inline", floor: 0.15, weight: 6 });
      expect(act.candidates.some((c) => c.id === id && c.semantic > 0)).toBe(true);
    },
    20_000,
  );

  test("MINOR 2: the recording path puts WHICH pair ran on the telemetry ring", () => {
    const s = store(embedder(POTION, 256));
    s.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    const events: { name: string; data?: Record<string, unknown> }[] = [];
    const r = new Recall({ store: s, owner: true, onEvent: (e) => events.push(e) });
    const vector = embedder(POTION, 256)("\nThe otter holt is by the river.") ?? [];
    r.recall({ sessionId: "s-tel", text: "otter holt", owner: true, vector });
    const ev = events.find((e) => e.name === "recall.semantic.tuning");
    expect(ev?.data).toMatchObject({ identity: "potion-base-8M@256", path: "inline", floor: 0.15, weight: 6, source: "in-line" });
  });

  test("a VOYAGE-tagged store through activate is exactly the defaults", () => {
    const voyage: EmbedderIdentity = { model: "voyage-3-large", dim: 1024, rebuild: "external" };
    const s = store(embedder(voyage, 8));
    const ids = ["The otter holt is by the river.", "The survey resumes after the flood.", "filler a", "filler b"].map((body) =>
      s.put({ type: "memory", kind: "fact", body }),
    );
    const hits = ids.map((id, i) => ({ id, score: 0.9 - i * 0.15 }));
    const input = { text: "otter survey", day: s.livedDay(), selfFelt: false, maxCandidates: 100, storeSize: ids.length, hits };
    const tagged = activate(s, input, TUNABLES);
    expect(tagged.semantic?.identity).toMatch(/^voyage-3-large/);
    expect(tagged.semantic).toMatchObject({ floor: 0.45, weight: 1.0 });
    const defaults = activate(s, input, withTunables({ SEMANTIC_BY_IDENTITY: {} }));
    const score = (a: typeof tagged): Record<string, number> =>
      Object.fromEntries(a.candidates.map((c) => [c.id, c.semantic]));
    expect(score(tagged)).toEqual(score(defaults));
  });
});

