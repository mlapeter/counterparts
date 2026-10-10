/**
 * Lane 0 (2026-10-10), scale review C4: a cue word in almost every memory is
 * not looked up in the index (its postings are the whole store, its weight
 * near zero) — counted, never named — and the store's size is a count, not a
 * list of every live id.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { activate } from "../src/core/recall/activate.js";
import { informativeness } from "../src/core/recall/cues.js";
import { TUNABLES } from "../src/core/recall/tunables.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
let s: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-cues-"));
  s = Store.open({ dir });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

test("the floor ships off: every cue is looked up, as before Lane 0", () => {
  // Decided by b2 (review of #368): skipping a common word's postings changed
  // the gate's background, and so what surfaced on small stores.
  expect(TUNABLES.CUE_FETCH_MIN_IDF).toBe(0);
  for (let i = 0; i < 30; i += 1) s.put({ type: "memory", kind: "fact", body: `lantern note ${String(i)}` });
  s.put({ type: "memory", kind: "fact", body: "the harbor ferry leaves at noon" });
  const storeSize = s.countMemories({ archived: false });
  const out = activate(s, { text: "lantern harbor", day: s.livedDay(), selfFelt: false, maxCandidates: 50, storeSize }, TUNABLES);
  expect(out.unfetched).toBe(0);
  expect(out.candidates.length).toBeGreaterThan(1);
});

test("with the floor on, a word in nearly every memory fetches nothing; a rare word still finds its memory", () => {
  const on = { ...TUNABLES, CUE_FETCH_MIN_IDF: 0.1 };
  const ids: string[] = [];
  for (let i = 0; i < 30; i += 1) ids.push(s.put({ type: "memory", kind: "fact", body: `lantern note ${String(i)} about the ${["orchard", "granite", "meadow"][i % 3] as string}` }));
  const harbor = s.put({ type: "memory", kind: "fact", body: "the harbor ferry leaves at noon" });
  const storeSize = s.countMemories({ archived: false });
  expect(storeSize).toBe(s.list({ archived: false }).length);
  // `lantern` is in 30 of 31: under the floor. `harbor` is in one.
  expect(informativeness(30, storeSize)).toBeLessThan(on.CUE_FETCH_MIN_IDF);
  const out = activate(s, { text: "lantern harbor", day: s.livedDay(), selfFelt: false, maxCandidates: 50, storeSize }, on);
  expect(out.unfetched).toBe(1);
  expect(out.cues.map((c) => c.token)).toContain("lantern");
  const found = out.candidates.map((c) => c.id);
  expect(found).toContain(harbor);
  for (const id of ids) expect(found).not.toContain(id);
  // With the floor off, the common word is fetched again.
  const off = activate(s, { text: "lantern harbor", day: s.livedDay(), selfFelt: false, maxCandidates: 50, storeSize }, { ...TUNABLES, CUE_FETCH_MIN_IDF: 0 });
  expect(off.unfetched).toBe(0);
  expect(off.candidates.length).toBeGreaterThan(1);
});
