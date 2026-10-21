/**
 * HYGIENE ON "THIS REPLACES THAT" (2026-10-11, Group 2; review 10 C5): every
 * settle that moves a memory closes the flags on it, a dream's and a
 * reflection's too; an old flag is asked again once, never settled on its
 * own. Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { MIND_TUNABLES, mindRanked, noteMindShown } from "../src/core/dream/mind.js";
import { flag, settle } from "../src/core/reconsolidation.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-hygiene-"));
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

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.advanceClock(d);
  return s;
}

function put(s: Store, body: string): string {
  const day = s.livedDay();
  return s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
}

describe("hygiene", () => {
  test("a dream's settle closes the other flags on the memory it moves", () => {
    const s = store();
    const a = put(s, "The bakery sign says opening soon.");
    const b = put(s, "The bakery is open on weekdays now.");
    const c = put(s, "The opening-soon sign was replaced by the opening hours.");
    const f = flag(s, { x: a, y: b, source: "dream" });
    const out = settle(s, { holds: c, over: a, how: "changed", actor: "dream", why: "replaced" });
    expect(out.ok && out.closed).toEqual([f.ok ? f.pair : ""]);
    expect(s.contradiction(f.ok ? f.pair : "")?.via).toBe(out.ok ? out.pair : "");
  });

  test("an old flag is asked again once at full weight, then habituates again", () => {
    const c = Counterpart.open({ dir, identity: { name: "Mike" } });
    open.push(c);
    for (const d of ["2026-09-01", "2026-09-02"]) c.store.advanceClock(d);
    const a = put(c.store, "The upkeep is eight food a day.");
    const b = put(c.store, "The upkeep is sixteen food a day.");
    const f = flag(c.store, { x: a, y: b, source: "dream" });
    const read = (): number => {
      const day = c.store.livedDay();
      const m = mindRanked(c.store, { today: "2026-09-30", day, showable: () => true });
      noteMindShown(c.store, m.items, day);
      return JSON.parse(c.store.getMeta(`mind.seen.${f.ok ? f.pair : ""}`) ?? "{}").times as number;
    };
    expect(read()).toBe(1);
    expect(read()).toBe(2);
    expect(read()).toBe(3);
    for (let d = 3; d < 3 + MIND_TUNABLES.REASK_AFTER_DAYS; d += 1) c.store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    // Asked again once: back to its first showing…
    expect(read()).toBe(1);
    expect(JSON.parse(c.store.getMeta(`mind.seen.${f.ok ? f.pair : ""}`) ?? "{}").reasked).toBe(true);
    // …and only once.
    expect(read()).toBe(2);
  });
});
