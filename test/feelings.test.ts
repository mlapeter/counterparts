/**
 * Feelings on a memory (schema v7, owner-approved 2026-09-25): the wheel's
 * vocabulary, the store's `feelings` table, and the two MCP doors that take
 * them. Nothing here changes salience, decay or recall — that is asserted too.
 *
 * Hermetic: a fresh temp directory per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CORE_EMOTIONS, FEELINGS_WHEEL, resolveEmotion, wheelEntry } from "../src/core/feelings-wheel.js";
import { Store, isStoreError, paths } from "../src/core/store/index.js";
import type { StoreOptions } from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-feelings-"));
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}): Store {
  const s = Store.open({ dir, ...opts });
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

const mem = (s: Store, body = "the afternoon the build went green") => s.put({ type: "memory", kind: "fact", body });

describe("the wheel", () => {
  test("six cores, every middle and outer word, one key each", () => {
    expect(CORE_EMOTIONS).toEqual(["happy", "sad", "fear", "anger", "surprise", "disgust"]);
    const keys = FEELINGS_WHEEL.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 6 cores + 36 middle + 72 outer, less sad's `abandoned` printed twice.
    expect(FEELINGS_WHEEL.length).toBe(6 + 36 + 72 - 1);
    expect(wheelEntry("abandoned")).toMatchObject({ core: "sad", ring: "middle", alsoUnder: "lonely" });
    expect(wheelEntry("furious")).toMatchObject({ core: "anger", ring: "outer", parent: "mad", valence: -1 });
  });

  test("a word under two cores is core-qualified on both sides", () => {
    expect(wheelEntry("insecure")).toBeUndefined();
    expect(wheelEntry("anger.insecure")).toMatchObject({ ring: "outer", parent: "threatened" });
    expect(wheelEntry("fear.insecure")).toMatchObject({ ring: "middle" });
    expect(wheelEntry("sad.inferior")).toMatchObject({ parent: "depressed" });
    expect(wheelEntry("fear.inferior")).toMatchObject({ parent: "fear.insecure" });
    // A bare ambiguous word is qualified by the core it came with.
    const read = resolveEmotion("fear", "Insecure");
    expect(read.kind === "wheel" ? read.entry.key : read.kind).toBe("fear.insecure");
  });

  test("valence: happy up, the four down, surprise's children their own", () => {
    expect(wheelEntry("hopeful")?.valence).toBe(1);
    expect(wheelEntry("worried")?.valence).toBe(-1);
    expect(wheelEntry("surprise")?.valence).toBe(0);
    for (const k of ["amazed", "excited", "eager", "energetic", "awe", "astonished"]) expect(wheelEntry(k)?.valence).toBe(1);
    for (const k of ["startled", "confused", "shocked", "dismayed", "disillusioned", "perplexed"]) {
      expect(wheelEntry(k)?.valence).toBe(-1);
    }
  });
});

describe("the store", () => {
  test("mixed feelings, both people's, one sitting beneath another", () => {
    const s = store({ now: () => Date.parse("2026-09-25T20:00:00Z"), timeZone: "America/Denver" });
    const id = mem(s);
    const added = s.addFeelings(
      id,
      [
        { whose: "owner", core: "fear", emotion: "worried", strength: 0.6, carriedBy: "the deploy failed twice" },
        { whose: "owner", core: "anger", emotion: "frustrated", strength: 0.7, carriedBy: "same error again", beneath: 0 },
        { whose: "self", core: "happy", emotion: "hopeful", strength: 0.4 },
      ],
      { model: "claude-opus-5-5" },
    );
    expect(added.ids.length).toBe(3);
    expect(added.notices).toEqual([]);
    const rows = s.feelingsFor(id);
    expect(rows.map((r) => [r.whose, r.core, r.emotion])).toEqual([
      ["owner", "fear", "worried"],
      ["owner", "anger", "frustrated"],
      ["self", "happy", "hopeful"],
    ]);
    const anger = rows.find((r) => r.emotion === "frustrated");
    expect(anger?.beneath_id).toBe(added.ids[0] as string);
    expect(anger?.model).toBe("claude-opus-5-5");
    expect(anger?.created_at).toBe(Date.parse("2026-09-25T20:00:00Z"));
    // A later call may sit on an existing feeling by id — on this memory only.
    s.addFeelings(id, [{ whose: "owner", core: "sad", emotion: "lonely", strength: 0.3, beneath: added.ids[0] as string }]);
    const other = mem(s, "a different afternoon");
    expect(code(() => s.addFeelings(other, [{ whose: "owner", core: "sad", emotion: "lonely", strength: 0.3, beneath: added.ids[0] as string }]))).toBe(
      "FEELING_INVALID:beneath-not-on-this-memory",
    );
    expect(s.feelingsFor(other)).toEqual([]);
  });

  test("an emotion not on the wheel is kept as other, with its word and the nearest keys", () => {
    const s = store();
    const id = mem(s);
    const added = s.addFeelings(id, [{ whose: "self", core: "happy", emotion: "hopefull", strength: 0.5 }]);
    expect(added.notices.length).toBe(1);
    expect(added.notices[0]?.closest[0]).toBe("hopeful");
    const [row] = s.feelingsFor(id);
    expect([row?.emotion, row?.other_word]).toEqual(["other", "hopefull"]);
  });

  test("refused, and nothing written: unknown core or whose, a strength out of range, a word from another core, a loop", () => {
    const s = store();
    const id = mem(s);
    const ok = { whose: "owner", core: "happy", emotion: "hopeful", strength: 0.5 };
    expect(code(() => s.addFeelings(id, [ok, { ...ok, core: "boredom" }]))).toBe("FEELING_INVALID:core-unknown");
    expect(code(() => s.addFeelings(id, [{ ...ok, whose: "the dog" }]))).toBe("FEELING_INVALID:whose-unknown");
    expect(code(() => s.addFeelings(id, [{ ...ok, strength: 1.5 }]))).toBe("FEELING_INVALID:strength-out-of-range");
    expect(code(() => s.addFeelings(id, [{ ...ok, emotion: "furious" }]))).toBe("FEELING_INVALID:emotion-under-another-core");
    expect(code(() => s.addFeelings(id, [{ ...ok, beneath: 1 }, { ...ok, beneath: 0 }]))).toBe("FEELING_INVALID:beneath-cycle");
    expect(s.feelingsFor(id)).toEqual([]);
  });

  test("counts by whose and core or emotion, over the person's days", () => {
    let at = Date.parse("2026-09-24T18:00:00Z");
    const s = store({ now: () => at, timeZone: "UTC" });
    const id = mem(s);
    s.addFeelings(id, [
      { whose: "owner", core: "fear", emotion: "worried", strength: 0.5 },
      { whose: "owner", core: "fear", emotion: "anxious", strength: 0.5 },
    ]);
    at = Date.parse("2026-09-25T18:00:00Z");
    s.addFeelings(id, [
      { whose: "owner", core: "fear", emotion: "worried", strength: 0.5 },
      { whose: "self", core: "happy", emotion: "hopeful", strength: 0.5 },
    ]);
    expect(s.feelingCounts({ by: "core" })).toEqual([
      { whose: "owner", key: "fear", count: 3 },
      { whose: "self", key: "happy", count: 1 },
    ]);
    expect(s.feelingCounts({ by: "emotion", whose: "owner", from: "2026-09-25" })).toEqual([
      { whose: "owner", key: "worried", count: 1 },
    ]);
    expect(s.feelingCounts({ by: "emotion", whose: "owner", to: "2026-09-24" })).toEqual([
      { whose: "owner", key: "anxious", count: 1 },
      { whose: "owner", key: "worried", count: 1 },
    ]);
  });

  test("the owner's removal takes a memory's feelings with it", () => {
    const s = store();
    const id = mem(s);
    const keep = mem(s, "a memory that stays");
    s.addFeelings(id, [
      { whose: "owner", core: "fear", emotion: "worried", strength: 0.5, carriedBy: "private words" },
      { whose: "owner", core: "anger", emotion: "mad", strength: 0.5, beneath: 0 },
    ]);
    s.addFeelings(keep, [{ whose: "self", core: "happy", emotion: "proud", strength: 0.5 }]);
    s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, id);
    expect(s.feelingsFor(id)).toEqual([]);
    expect(s.feelingsFor(keep).length).toBe(1);
  });

  test("the v6 → v7 migration creates the table on an existing store", () => {
    const s = Store.open({ dir });
    s.put({ type: "memory", kind: "fact", body: "before" });
    s.close();
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE feelings");
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '6')");
    db.close();
    const migrated = store({ snapshotsDir: join(dir, "..", `${dir.split("/").pop() ?? "x"}-snaps`) });
    expect(migrated.getMeta("schemaVersion")).toBe("7");
    const id = mem(migrated);
    expect(migrated.addFeelings(id, [{ whose: "owner", core: "happy", emotion: "relieved", strength: 0.5, carriedBy: "" }]).notices.length).toBe(1);
    rmSync(join(dir, "..", `${dir.split("/").pop() ?? "x"}-snaps`), { recursive: true, force: true });
  });
});

describe("the MCP doors", () => {
  function server(): McpServer {
    const s = openServer({ dir, scope: "/tmp/feelings-project", owner: true });
    open.push({ close: () => s.counterpart.close() });
    return s;
  }
  const payload = (r: { structuredContent?: unknown }): Record<string, unknown> =>
    (r.structuredContent ?? {}) as Record<string, unknown>;

  test("note: feelings land beside the memory, an unknown word comes back as a notice, salience is untouched", async () => {
    const s = server();
    const plain = payload(await s.call("note", { text: "The glaze test cracked on the left shelf of the kiln again." }));
    const out = payload(
      await s.call("note", {
        text: "The second glaze test on the right shelf came out clean after all.",
        feelings: [
          { whose: "owner", core: "fear", emotion: "anxious", strength: 0.5, carried_by: "waiting on the kiln" },
          { whose: "owner", core: "happy", emotion: "relievd", strength: 0.8, beneath: 0 },
        ],
      }),
    );
    expect(out["stored"]).toBe(true);
    const f = out["feelings"] as Record<string, unknown>;
    expect(f["stored"]).toBe(2);
    const notice = (f["other"] as Record<string, unknown>[])[0] ?? {};
    expect(notice["word"]).toBe("relievd");
    expect(String(notice["note"])).toContain("not on the feelings wheel");
    const id = out["id"] as string;
    expect(s.counterpart.store.feelingsFor(id).length).toBe(2);
    // No behaviour change: the same salience dimensions as a note without feelings.
    const a = s.counterpart.store.read(plain["id"] as string).physics.salience;
    const b = s.counterpart.store.read(id).physics.salience;
    expect([b.emotional, b.relevance, b.predictive]).toEqual([a.emotional, a.relevance, a.predictive]);
  });

  test("note: feelings that will not store refuse the note before it mints", async () => {
    const s = server();
    const out = payload(
      await s.call("note", {
        text: "A note whose feelings name a core the wheel does not have.",
        feelings: [{ whose: "owner", core: "boredom", emotion: "bored", strength: 0.5 }],
      }),
    );
    expect(out["stored"]).toBe(false);
    expect(out["reason"]).toBe("feelings-malformed");
    expect(s.counterpart.store.list({ type: "memory" })).toEqual([]);
  });

  test("session_end: per entry — a bad one refuses itself, its sibling lands with its feelings", async () => {
    recordSession(dir, { sessionId: "s-feel", scope: "/tmp/feelings-project", phase: "start", model: "claude-opus-5-5" });
    const s = server();
    const out = payload(
      await s.call("session_end", {
        session: "s-feel",
        memories: [
          { content: "The kiln thermocouple was replaced and the firing held temperature.", feelings: [{ whose: "self", core: "happy", emotion: "proud", strength: 0.6 }] },
          { content: "A second entry whose feeling strength is out of range.", feelings: [{ whose: "self", core: "happy", emotion: "proud", strength: 3 }] },
        ],
      }),
    );
    const [good, bad] = out["outcomes"] as Record<string, unknown>[];
    expect(good?.["stored"]).toBe(true);
    expect((good?.["feelings"] as Record<string, unknown>)["stored"]).toBe(1);
    expect(s.counterpart.store.feelingsFor(good?.["id"] as string)[0]?.model).toBe("claude-opus-5-5");
    expect(bad?.["stored"]).toBe(false);
    expect(bad?.["reason"]).toBe("feelings-malformed");
  });
});
