/**
 * GROUP 1's SIMULATION (2026-10-10): a throwaway store seeded in the shape
 * review 03 described the live store at lived day 19 (§3: 770 live memories,
 * 13 core; 204 silent notes at the 0.25 default and 173 claimed 0.60; ~131
 * work-like items claimed ~0.55 and almost never felt; ~49 readings claimed
 * ~0.39 and mostly felt; 56 weak items at 0.3 or under with no feeling; little
 * use). It is SYNTHETIC — no live data is read; a seeded generator makes the
 * same shape every run — and then the real nightly cycle is run forward with
 * no further use, and the memories in reach are counted at +0, +3, +7 and +30
 * lived days, with the exits (archived at the floor) beside them.
 *
 * The numbers are printed (`bun test test/strength-simulation.test.ts`) and
 * the assertions hold only the shape: reach shrinks, weak routine items leave
 * within days, felt readings and the core stay, something exits by +30.
 *
 * Hermetic: a fresh temp data dir, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { belowReach } from "../src/core/physics/index.js";
import type { Kind } from "../src/core/physics/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
import { addDays } from "../src/core/time.js";

let root: string;
let s: Store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-strength-sim-"));
  s = Store.open({ dir: join(root, "store"), snapshotsDir: join(root, "snaps") });
});

afterEach(() => {
  try {
    s.close();
  } catch {
    /* already closed */
  }
  rmSync(root, { recursive: true, force: true });
});

/** mulberry32: the same store every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Group = "core" | "silent" | "claimed60" | "work" | "reading" | "weak" | "other";

interface Spec {
  readonly group: Group;
  readonly n: number;
  readonly sal: () => number;
  readonly felt: number;
  readonly feel: () => number;
  readonly kinds: readonly Kind[];
}

test("in reach after 3, 7 and 30 lived days on a store shaped like review 03's", () => {
  const r = rng(20261010);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const between = (a: number, b: number) => () => a + (b - a) * r();
  const SPECS: readonly Spec[] = [
    { group: "core", n: 13, sal: between(0.4, 0.8), felt: 0.6, feel: between(0.5, 0.8), kinds: ["self"] },
    { group: "silent", n: 204, sal: () => 0.25, felt: 0.3, feel: between(0.35, 0.55), kinds: ["fact", "fact", "self", "skill", "person"] },
    { group: "claimed60", n: 173, sal: () => 0.6, felt: 0.05, feel: between(0.4, 0.6), kinds: ["fact", "fact", "skill", "self"] },
    { group: "work", n: 131, sal: between(0.45, 0.65), felt: 0.05, feel: between(0.3, 0.5), kinds: ["fact", "skill", "place"] },
    { group: "reading", n: 49, sal: between(0.3, 0.5), felt: 0.78, feel: between(0.4, 0.8), kinds: ["fact", "self"] },
    { group: "weak", n: 56, sal: between(0.1, 0.3), felt: 0, feel: () => 0, kinds: ["fact", "skill", "self"] },
    { group: "other", n: 144, sal: between(0.3, 0.8), felt: 0.25, feel: between(0.4, 0.7), kinds: ["fact", "self", "entity", "person", "skill"] },
  ];
  let date = "2026-09-22";
  runCycle({ store: s, date });
  for (let i = 1; i < 19; i++) {
    date = addDays(date, 1);
    runCycle({ store: s, date });
  }
  const day = s.livedDay();
  const groupOf = new Map<string, Group>();
  for (const spec of SPECS) {
    for (let i = 0; i < spec.n; i++) {
      const birth = 1 + Math.floor(r() * (day - 1));
      const used = r() < 0.15;
      const uses = used ? 1 + Math.floor(r() * 3) : 0;
      const last = used ? Math.min(day, birth + 1 + Math.floor(r() * (day - birth))) : birth;
      const id = s.put({
        type: "memory",
        kind: pick(spec.kinds),
        body: `${spec.group} memory ${String(i)}: synthetic text for the simulation.`,
        salience: { claimed: Number(spec.sal().toFixed(2)) },
        physics: { birthDay: birth, lastUsedDay: last, uses, ...(spec.group === "core" ? { promotedIdentity: true } : {}) },
      });
      if (r() < spec.felt) s.addFeelings(id, [{ whose: "self", emotion: "moved", strength: Number(spec.feel().toFixed(2)) }]);
      groupOf.set(id, spec.group);
    }
  }

  const count = (): { reach: number; exits: number; by: Record<Group, number> } => {
    const by = { core: 0, silent: 0, claimed60: 0, work: 0, reading: 0, weak: 0, other: 0 } as Record<Group, number>;
    let reach = 0;
    let exits = 0;
    for (const [id, g] of groupOf) {
      const row = s.row(id);
      if (row === undefined) continue;
      if (row.archived === 1) {
        exits += 1;
        continue;
      }
      if (!belowReach(rowToPhysics(row), s.livedDay())) {
        reach += 1;
        by[g] += 1;
      }
    }
    return { reach, exits, by };
  };

  const at: Record<string, ReturnType<typeof count>> = {};
  date = addDays(date, 1);
  runCycle({ store: s, date });
  at["+0"] = count();
  // The cache's count, which the dashboard reads, agrees with the exact one.
  expect(s.belowReachCount()).toBe(groupOf.size - at["+0"].reach - at["+0"].exits);
  for (let k = 1; k <= 30; k++) {
    date = addDays(date, 1);
    runCycle({ store: s, date });
    if (k === 3 || k === 7 || k === 30) at[`+${String(k)}`] = count();
  }

  const lines = Object.entries(at).map(
    ([k, v]) =>
      `${k.padEnd(4)} in reach ${String(v.reach).padStart(3)}/${String(groupOf.size)}  exits ${String(v.exits).padStart(3)}  ` +
      Object.entries(v.by)
        .map(([g, n]) => `${g} ${String(n)}`)
        .join(", "),
  );
  console.log(["simulation (synthetic store shaped like review 03 §3, no further use):", ...lines].join("\n"));

  const p0 = at["+0"] as ReturnType<typeof count>;
  const p3 = at["+3"] as ReturnType<typeof count>;
  const p7 = at["+7"] as ReturnType<typeof count>;
  const p30 = at["+30"] as ReturnType<typeof count>;
  // Reach shrinks as lived days pass with no use.
  expect(p3.reach).toBeLessThanOrEqual(p0.reach);
  expect(p7.reach).toBeLessThanOrEqual(p3.reach);
  expect(p30.reach).toBeLessThan(p7.reach);
  // The core never leaves reach.
  expect(p30.by.core).toBe(13);
  // Weak, unfelt items have left within days; most felt readings stay a month.
  expect(p3.by.weak).toBeLessThanOrEqual(5);
  expect(p30.by.reading).toBeGreaterThan(p30.by.weak);
  // Something has exited — archived, never deleted — by +30.
  expect(p30.exits).toBeGreaterThan(0);
}, 120_000);
