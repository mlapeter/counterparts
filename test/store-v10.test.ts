/**
 * Schema v10 (2026-09-29, contradictions): two new tables, `contradictions`
 * and `contradiction_settles`, and the upgrade that carries every open dream
 * flag onto a pair — with the latch that said it was raised awake and the
 * habituation "my mind" kept for it — after the copy taken before migrating.
 *
 * The v9 fixture is a v10 store with the two tables dropped and its stamp set
 * back, the pattern `test/traits.test.ts` uses. Hermetic: a temp dir per test.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { settle } from "../src/core/reconsolidation.js";
import { MIND_SEEN_PREFIX, mindRanked } from "../src/core/dream/mind.js";
import { OBSERVER_READ_FLOOR, SCHEMA_VERSION, Store, V10_UPGRADE_KEY, carriedPairId, isStoreError, paths } from "../src/core/store/index.js";
import type { StoreOptions } from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

let root: string;
let dir: string;
const open: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-v10-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}): Store {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps"), ...opts });
  open.push(s);
  return s;
}

function put(s: Store, body: string): string {
  const day = s.livedDay();
  return s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
}

/** A dream that flagged `pairs`, journaled (or undone). Returns its id. */
function dreamed(s: Store, id: string, pairs: readonly (readonly [string, string])[], state = "journaled"): string {
  s.openDream({ id, day: s.livedDay(), date: "2026-09-04" });
  for (const [a, b] of pairs) s.recordDreamChange(id, { action: "contradiction", ref: a, ref2: b });
  s.updateDream(id, { state: state as "journaled" });
  return id;
}

/** Turn this (closed) store back into a v9 one: the v10 tables gone, the stamp set back. */
function backToV9(): void {
  const db = new Database(paths.operational(dir));
  db.run("DROP TABLE contradictions");
  db.run("DROP TABLE contradiction_settles");
  db.run("ALTER TABLE memories DROP COLUMN fade");
  db.run("UPDATE meta SET value = '9' WHERE key = 'schemaVersion'");
  db.close();
}

describe("schema v10", () => {
  test("the version and the observer floor are 10 or later", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
    expect(OBSERVER_READ_FLOOR).toBeGreaterThanOrEqual(10);
  });

  test("a v9 store with dream flags: every open flag becomes one unsettled pair, raised and habituated as it was, after a copy", () => {
    const s = store();
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) s.advanceClock(d);
    const a = put(s, "Tiny Castles upkeep is 8 food a day per spearman.");
    const b = put(s, "Tiny Castles upkeep is 16 food a day per spearman.");
    const c = put(s, "The migration runs before the container boots.");
    const d = put(s, "The container boots before the migration runs.");
    const e = put(s, "Standup is at nine.");
    const f = put(s, "Standup is at ten.");
    const d1 = dreamed(s, "drm_one", [[b, a], [c, d]]);
    // The same pair flagged again by a later dream is ONE pair.
    dreamed(s, "drm_two", [[a, b]]);
    // An undone dream's flag is not carried.
    dreamed(s, "drm_undone", [[e, f]], "undone");
    s.setMeta(`dream.raised.${d1}.1`, "3");
    s.setMeta(`${MIND_SEEN_PREFIX}${d1}.2`, JSON.stringify({ times: 2, day: 3 }));
    s.close();
    open.splice(0);
    backToV9();

    const after = store();
    expect(after.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    const pairs = after.contradictions();
    expect(pairs).toHaveLength(2);
    const ab = after.contradictionBetween(a, b);
    expect(ab?.id).toBe(carriedPairId(d1, 1));
    expect(ab?.state).toBe("unsettled");
    expect(ab?.a).toBe(a);
    expect(ab?.b).toBe(b);
    expect(ab?.source).toBe("dream");
    expect(ab?.dream_id).toBe(d1);
    expect(ab?.raised_day).toBe(3);
    const cd = after.contradictionBetween(c, d);
    expect(cd?.raised_day).toBeNull();
    expect(after.getMeta(`${MIND_SEEN_PREFIX}${cd?.id as string}`)).toBe(JSON.stringify({ times: 2, day: 3 }));
    expect(after.contradictionBetween(e, f)).toBeUndefined();
    const note = JSON.parse(after.getMeta(V10_UPGRADE_KEY) ?? "{}") as Record<string, number | string>;
    expect(note["from"]).toBe("9");
    expect(note["flags"]).toBe(3);
    expect(note["pairs"]).toBe(2);
    expect(note["raised"]).toBe(1);
    expect(note["standing"]).toBe(2);
    // The carried pairs are what "my mind" reads now, habituation and all.
    const mind = mindRanked(after, { today: "2026-09-04", day: after.livedDay(), showable: () => true });
    expect(mind.items.filter((i) => i.kind === "unsettled").map((i) => i.pair).sort()).toEqual([ab?.id, cd?.id].sort());
  });

  test("the copy before migrating is taken", () => {
    const s = store();
    put(s, "A memory so the store is not empty.");
    s.close();
    open.splice(0);
    backToV9();
    expect(existsSync(join(root, "snaps"))).toBe(false);
    const after = store();
    expect(after.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(readdirSync(join(root, "snaps")).some((n) => n.includes("v9"))).toBe(true);
  });

  test("an observer refuses a v9 store until a writer migrates it", () => {
    const s = store();
    put(s, "Something.");
    s.close();
    open.splice(0);
    backToV9();
    let code: string | null = null;
    try {
      store({ observer: true });
    } catch (err) {
      code = isStoreError(err) ? err.code : "other";
    }
    expect(code).toBe("STORE_UNINITIALIZED");
  });

  test("the owner's removal takes a removed memory's pairs and their trail with it", () => {
    const s = store();
    for (const d of ["2026-09-01", "2026-09-02"]) s.advanceClock(d);
    const a = put(s, "The router password rotates weekly.");
    const b = put(s, "The router password rotates monthly.");
    const out = settle(s, { holds: b, over: a, how: "corrected", why: "the sticker says monthly", actor: "owner" });
    expect(out.ok).toBe(true);
    expect(s.contradictionSettles()).toHaveLength(1);
    s.appendRemovalRecord({ memoryId: a, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: a, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, a);
    expect(s.contradictions()).toHaveLength(0);
    expect(s.contradictionSettles()).toHaveLength(0);
  });
});
