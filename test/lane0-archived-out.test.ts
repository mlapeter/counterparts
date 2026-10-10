/**
 * Lane 0 (2026-10-10), scale review C3: archived rows leave the census, dedup
 * and decay scans — in SQL, not by reading each row to skip it. The counts
 * those phases report do not change: decay still names its archived skips, and
 * the census still counts a memory born and archived today.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { census, runDecay, runDedup } from "../src/core/sleep/index.js";
import type { PhaseCtx, SleepStore } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
let s: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-archived-"));
  s = Store.open({ dir });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

function put(body: string, day: number, over: Partial<PutInput> = {}): string {
  return s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

/** The store, with every `row()` read written down, and the methods in `hide` absent (a port without them). */
function watched(reads: string[], hide: readonly string[] = []): SleepStore {
  return new Proxy(s, {
    get(target, key) {
      if (typeof key === "string" && hide.includes(key)) return undefined;
      if (key === "row") return (id: string) => (reads.push(id), target.row(id));
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as SleepStore;
}

function ctx(store: SleepStore, day: number): PhaseCtx {
  return { store, day, apply: false, budget: 1000, step: () => {}, event: () => {} } as PhaseCtx;
}

function world(): { old: string[]; archived: string[]; today: string; todayArchived: string } {
  s.advanceClock("2026-09-01");
  for (let d = 2; d <= 5; d += 1) s.advanceClock(`2026-09-0${String(d)}`);
  const day = s.livedDay();
  const old = Array.from({ length: 6 }, (_, i) => put(`an older note number ${String(i)} about lanterns`, 1));
  const archived = old.slice(0, 3);
  for (const id of archived) s.archive(id, "test");
  const today = put("a note born today about harbors", day);
  const todayArchived = put("a note born and archived today about quarries", day);
  s.archive(todayArchived, "test");
  return { old, archived, today, todayArchived };
}

test("the census reads only today's births — archived ones included — and nothing older", () => {
  const w = world();
  // Group 1's grouped count (`Store#bornOn`, review 13 C2) reads no row at all.
  const grouped: string[] = [];
  expect(census(watched(grouped), s.livedDay(), [], []).fact.created).toBe(2);
  expect(grouped).toEqual([]);
  // A port without it lists today's births in SQL and reads only those.
  const reads: string[] = [];
  const out = census(watched(reads, ["bornOn"]), s.livedDay(), [], []);
  expect(new Set(reads)).toEqual(new Set([w.today, w.todayArchived]));
  expect(out.fact.created).toBe(2);
});

test("decay reads no archived row, and still counts them by name", () => {
  const w = world();
  const reads: string[] = [];
  const out = runDecay(ctx(watched(reads), s.livedDay()), null);
  for (const id of [...w.archived, w.todayArchived]) expect(reads).not.toContain(id);
  expect(out.skipped["archived"]).toBe(w.archived.length + 1);
});

test("dedup reads no archived row", () => {
  const w = world();
  const reads: string[] = [];
  runDedup(ctx(watched(reads), s.livedDay()));
  for (const id of [...w.archived, w.todayArchived]) expect(reads).not.toContain(id);
});
