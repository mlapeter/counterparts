/**
 * THE WAIT UNDER THE FLOOR (2026-10-14; decided by Mike, lightly held, review
 * 2026-10-18). A memory exits after `D_FLOOR_DAYS` lived days UNDER the
 * floor — counted from the day its curve went under it (`physics#floorDay`),
 * and never from before the day a new curve first read the store
 * (`sleep/decay.ts#curveSinceDay`). Until then the count ran from the last
 * use, so a long-unused memory left the night it crossed the floor.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES, decayAnchor, floorDay, pruneVerdict, strength } from "../src/core/physics/index.js";
import type { MemoryPhysics, Salience } from "../src/core/types.js";
import { Store } from "../src/core/store/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
import { runDecay, runPrune } from "../src/core/sleep/index.js";
import type { PhaseCtx, SleepStore } from "../src/core/sleep/index.js";
import { CURVE_META_KEY, CURVE_SINCE_KEY, curveSignature, curveSinceDay } from "../src/core/sleep/decay.js";

function sal(claimed: number): Salience {
  return { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed };
}

function mem(p: Partial<MemoryPhysics> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: sal(0.3),
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    consolidated: false,
    promotedIdentity: false,
    protected: false,
    pressure: 0,
    lastChallengedDay: null,
    reinforcedDays: 0,
    ...p,
  };
}

const NO_CHAIN = { inLiveRevisionChain: false };

describe("physics: the wait counts lived days under the floor", () => {
  const m = mem();
  const F = floorDay(m) as number;

  test("floorDay is the first lived day under the floor", () => {
    expect(F).toBeGreaterThan(decayAnchor(m) + TUNABLES.D_FLOOR_DAYS);
    expect(strength(m, F - 1)).toBeGreaterThanOrEqual(TUNABLES.PHI_PRUNE);
    expect(strength(m, F)).toBeLessThan(TUNABLES.PHI_PRUNE);
  });

  test("a long-unused memory that just crossed the floor is not let go that night", () => {
    const v = pruneVerdict(m, F, NO_CHAIN);
    // The old rule (dwell from the anchor) would have let it go: unused for months.
    expect(v.dwellDays).toBeGreaterThanOrEqual(TUNABLES.D_FLOOR_DAYS);
    expect(v.belowFloorDays).toBe(0);
    expect(v.prune).toBe(false);
    expect(v.blockedBy).toEqual(["dwell-too-short"]);
  });

  test("under the floor 13 lived days: kept; 14: let go", () => {
    const at13 = pruneVerdict(m, F + 13, NO_CHAIN);
    expect(at13.belowFloorDays).toBe(13);
    expect(at13.prune).toBe(false);
    expect(at13.blockedBy).toEqual(["dwell-too-short"]);
    // The old rule would already have said yes at 13 (and at 0).
    expect(F + 13 - decayAnchor(m)).toBeGreaterThanOrEqual(TUNABLES.D_FLOOR_DAYS);
    const at14 = pruneVerdict(m, F + 14, NO_CHAIN);
    expect(at14.belowFloorDays).toBe(14);
    expect(at14.prune).toBe(true);
    expect(at14.record).not.toBeNull();
  });

  test("a use moves the anchor, and the wait with it", () => {
    const used = { ...m, lastUsedDay: F + 10, uses: 1 };
    expect(pruneVerdict(used, F + 14, NO_CHAIN).prune).toBe(false);
    const F2 = floorDay(used) as number;
    expect(F2).toBeGreaterThan(F + 10);
    expect(pruneVerdict(used, F2 + 13, NO_CHAIN).prune).toBe(false);
    expect(pruneVerdict(used, F2 + 14, NO_CHAIN).prune).toBe(true);
  });

  test("a memory under the floor from its anchor waits 14 lived days from the anchor, as before", () => {
    const low = mem({ salience: sal(0.01), birthDay: 5, lastUsedDay: 5 });
    expect(floorDay(low)).toBe(5);
    expect(pruneVerdict(low, 18, NO_CHAIN).prune).toBe(false);
    expect(pruneVerdict(low, 19, NO_CHAIN).prune).toBe(true);
  });

  test("curveSince: the wait never starts before a new curve arrived", () => {
    const since = F + 30;
    expect(pruneVerdict(m, F + 40, { ...NO_CHAIN, curveSince: since }).prune).toBe(false);
    expect(pruneVerdict(m, F + 40, { ...NO_CHAIN, curveSince: since }).belowFloorDays).toBe(10);
    expect(pruneVerdict(m, since + 13, { ...NO_CHAIN, curveSince: since }).prune).toBe(false);
    expect(pruneVerdict(m, since + 14, { ...NO_CHAIN, curveSince: since }).prune).toBe(true);
    // A curve older than the crossing changes nothing.
    expect(pruneVerdict(m, F + 14, { ...NO_CHAIN, curveSince: F - 50 }).prune).toBe(true);
    // Null reads as no curve change.
    expect(pruneVerdict(m, F + 14, { ...NO_CHAIN, curveSince: null }).prune).toBe(true);
  });

  test("the core never goes under the floor", () => {
    expect(floorDay(mem({ promotedIdentity: true }))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The store: a new curve cannot empty the store the night it lands
// ═══════════════════════════════════════════════════════════════════════════

let dir: string;
const open: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-prune-wait-"));
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

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

let seq = 0;
function put(s: Store, physics: Partial<MemoryPhysics>, claimed = 0.3): string {
  seq += 1;
  const id = `mem_wait_${String(seq).padStart(8, "0")}`;
  return s.put({
    id,
    type: "memory",
    kind: "fact",
    body: `A memory that says something particular about ${id}.`,
    salience: { relevance: 0, emotional: 0, predictive: 0, claimed },
    physics,
  });
}

function ctx(s: Store, day: number, apply = true): PhaseCtx {
  return { store: s as unknown as SleepStore, day, apply, budget: 1000, step: () => {}, event: () => {} };
}

describe("sleep: the night a new curve arrives lets go of nothing", () => {
  test("a store signed under another curve: nothing goes tonight, and it goes 14 lived days on", () => {
    const s = store();
    // Unused since day -400: its curve crossed the floor long ago.
    const id = put(s, { birthDay: -400, lastUsedDay: -400, uses: 0 });
    const F = floorDay(rowToPhysics(s.row(id)!)) as number;
    expect(F).toBeLessThan(0 - TUNABLES.D_FLOOR_DAYS);
    // Signed under an earlier build's curve.
    s.setMeta(CURVE_META_KEY, JSON.stringify({ an: "older curve" }));

    // An observer run before the decay pass re-signs: tonight is the curve's first.
    expect(curveSinceDay(s, 0)).toBe(0);
    expect(runPrune(ctx(s, 0, false)).pruned).toEqual([]);

    runDecay(ctx(s, 0), null);
    expect(s.getMeta(CURVE_META_KEY)).toBe(curveSignature(s.getMeta("claims.era.cutoff") ?? null));
    expect(s.getMeta(CURVE_SINCE_KEY)).toBe("0");
    expect(curveSinceDay(s, 5)).toBe(0);

    expect(runPrune(ctx(s, 0)).pruned).toEqual([]);
    expect(runPrune(ctx(s, 13)).pruned).toEqual([]);
    expect(s.row(id)!.archived).toBe(0);
    const later = runPrune(ctx(s, 14));
    expect(later.pruned.map((p) => p.id)).toEqual([id]);
    expect(s.row(id)!.archived).toBe(1);
  });

  test("a store's first signing is a curve change too: an unsigned upgrader waits its 14 days", () => {
    const s = store();
    const id = put(s, { birthDay: -400, lastUsedDay: -400, uses: 0 });
    // Never signed (a store from a build older than the signature): nothing to read yet.
    expect(s.getMeta(CURVE_META_KEY)).toBeUndefined();
    expect(curveSinceDay(s, 0)).toBeNull();
    runDecay(ctx(s, 0), null);
    expect(s.getMeta(CURVE_SINCE_KEY)).toBe("0");
    expect(curveSinceDay(s, 0)).toBe(0);
    expect(runPrune(ctx(s, 0)).pruned).toEqual([]);
    expect(runPrune(ctx(s, 13)).pruned).toEqual([]);
    expect(s.row(id)!.archived).toBe(0);
    expect(runPrune(ctx(s, 14)).pruned.map((p) => p.id)).toEqual([id]);
  });

  test("an empty since row is no day, not day 0", () => {
    const s = store();
    runDecay(ctx(s, 3), null);
    s.setMeta(CURVE_SINCE_KEY, "");
    expect(curveSinceDay(s, 9)).toBeNull();
    s.setMeta(CURVE_SINCE_KEY, "3");
    expect(curveSinceDay(s, 9)).toBe(3);
  });

  test("a memory that crosses the floor tonight on a settled curve waits its 14 days", () => {
    const s = store();
    const probe = mem();
    const F = floorDay(probe) as number;
    // Anchored so it goes under the floor on lived day 100.
    const shift = 100 - F;
    const id = put(s, { birthDay: shift, lastUsedDay: shift, uses: 0 });
    expect(floorDay(rowToPhysics(s.row(id)!))).toBe(100);
    runDecay(ctx(s, 99), null);
    expect(runPrune(ctx(s, 100)).pruned).toEqual([]);
    expect(runPrune(ctx(s, 113)).pruned).toEqual([]);
    expect(runPrune(ctx(s, 114)).pruned.map((p) => p.id)).toEqual([id]);
  });
});
