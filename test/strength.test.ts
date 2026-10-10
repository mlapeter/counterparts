/**
 * GROUP 1 — STRENGTH (2026-10-10, the mechanisms review's synthesis §1 G1,
 * items 1–5 and 8; review 03 C1–C4, 02 C1/C5, 07 C1/C2, 13 C2).
 *
 *   - the curve: power-law (ψ = 1) with a per-memory stability, checked
 *     against review 03's design table (§5 C1) within ±1 lived day;
 *   - feeling counted once: `emotional` out of `sal()`'s mean;
 *   - below reach (`REACH`) as a computed state; the core never leaves reach;
 *   - the dated hold: a memory dated a month out stays in reach until its
 *     window closes, then fades steeply;
 *   - a chapter's copy and a live handoff are never archived;
 *   - the turn-down: the decay pass reads only the rows whose state changes;
 *   - store v13: the one additive migration, its copy, and the way back.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NEVER_CHANGES,
  TUNABLES as PHYSICS,
  belowReach,
  daysUntilBelow,
  decay,
  nextChangeDay,
  sal,
  stability,
  strength,
} from "../src/core/physics/index.js";
import type { MemoryPhysics, Salience } from "../src/core/physics/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { OBSERVER_READ_FLOOR, SCHEMA_VERSION, Store, V13_UPGRADE_KEY, paths } from "../src/core/store/index.js";
import { datedHold, rowToPhysics } from "../src/core/store/operational.js";
import { HANDOFF_ROLE } from "../src/core/handoff/index.js";
import { addDays } from "../src/core/time.js";

let root: string;
let dir: string;
const open: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-strength-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(): Store {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps") });
  open.push(s);
  return s;
}

function salience(claimed: number, extra: Partial<Salience> = {}): Salience {
  return { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed, ...extra };
}

function memory(over: Partial<MemoryPhysics> & { claimed?: number } = {}): MemoryPhysics {
  const { claimed = 0.25, ...rest } = over;
  return {
    kind: "fact",
    salience: salience(claimed),
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    consolidated: false,
    promotedIdentity: false,
    protected: false,
    pressure: 0,
    lastChallengedDay: null,
    ...rest,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// the curve
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Review 03 §5 C1's design table: lived days a fresh, never-used FACT stays in
 * reach (strength ≥ 0.15), by claimed salience (rows) and feeling (columns).
 * `null` is the table's ">2000".
 */
const DESIGN: readonly [number, readonly (number | null)[]][] = [
  [0.15, [1, 2, 9, 44]],
  [0.2, [1, 5, 21, 90]],
  [0.25, [2, 10, 42, 170]],
  [0.3, [5, 20, 78, 307]],
  [0.4, [17, 65, 246, 922]],
  [0.5, [51, 191, 707, null]],
  [0.6, [146, 533, 1929, null]],
  [0.7, [397, 1425, null, null]],
];
const FEELINGS = [0, 0.3, 0.6, 0.9] as const;

describe("the curve (review 03 C1)", () => {
  test("the shape is power-law, ψ = 1, with the synthesis's constants", () => {
    expect(PHYSICS.DECAY_SHAPE).toBe("power-law");
    expect(PHYSICS.POWER_LAW_PSI).toBe(1);
    expect(PHYSICS.S0).toBe(0.4);
    expect(PHYSICS.STABILITY_GAIN).toBe(8);
    expect(PHYSICS.EMO_Q).toBe(0.5);
    expect(PHYSICS.BETA).toBe(0.5);
    expect(PHYSICS.REACH).toBe(0.15);
    expect(PHYSICS.PHI_PRUNE).toBe(0.02);
    expect(PHYSICS.D_FLOOR_DAYS).toBe(14);
  });

  test("days in reach match review 03's design table within ±1 lived day", () => {
    for (const [claimed, row] of DESIGN) {
      row.forEach((want, i) => {
        const m = memory({ claimed, feelingPeak: FEELINGS[i] as number });
        const got = daysUntilBelow(m, PHYSICS.REACH);
        expect(got).not.toBeNull();
        if (want === null) expect(got as number).toBeGreaterThan(2000);
        else expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(1);
      });
    }
  });

  test("the table's worked examples: a 0.7 fact, a default note, a felt self note", () => {
    const fact = memory({ claimed: 0.7 });
    expect([0, 7, 30, 90].map((d) => Number(strength(fact, d).toFixed(2)))).toEqual([0.7, 0.66, 0.55, 0.38]);
    const note = memory({ claimed: 0.25 });
    expect([0, 1, 2, 3].map((d) => Number(strength(note, d).toFixed(2)))).toEqual([0.25, 0.19, 0.15, 0.12]);
    expect(strength(note, 30)).toBeCloseTo(0.022, 3);
    const felt = memory({ kind: "self", claimed: 0.25, feelingPeak: 0.6 });
    expect(daysUntilBelow(felt, PHYSICS.REACH)).toBe(59);
  });

  test("S = S0 · e^(G·q) · uses · returns / κ, q = clamp01(sal + 0.5·I)", () => {
    const m = memory({ claimed: 0.4, feelingPeak: 0.6, uses: 2, returns: 1, kind: "skill" });
    const q = 0.4 + 0.5 * 0.6;
    const want = (0.4 * Math.exp(8 * q) * (1 + 0.5 * Math.log(3)) * (1 + Math.log(2))) / 0.5;
    expect(stability(m)).toBeCloseTo(want, 8);
    // q is clamped: a 1.0 claim with a 0.9 feeling is q = 1.
    expect(stability(memory({ claimed: 1, feelingPeak: 0.9 }))).toBeCloseTo(0.4 * Math.exp(8), 6);
  });

  test("steep early, flat late: the strong lose far less per day after the first week", () => {
    const weak = memory({ claimed: 0.25 });
    const strong = memory({ claimed: 0.6, feelingPeak: 0.6 });
    const loss = (m: MemoryPhysics, d: number): number => strength(m, d) - strength(m, d + 1);
    expect(loss(weak, 0)).toBeGreaterThan(loss(weak, 10));
    expect(loss(strong, 10)).toBeLessThan(0.002);
    expect(loss(weak, 0)).toBeGreaterThan(20 * loss(strong, 10));
  });

  test("never fades is S = ∞: the core, with no branch in the readers", () => {
    const core = memory({ claimed: 0.4, promotedIdentity: true });
    expect(stability(core)).toBe(Number.POSITIVE_INFINITY);
    expect(decay(core, 10_000)).toBe(1);
    expect(belowReach(memory({ claimed: 0.05, promotedIdentity: true }), 500)).toBe(false);
    expect(nextChangeDay(core, 3)).toBe(NEVER_CHANGES);
  });

  test("a use re-anchors the curve, and so does a counted return or dream replay", () => {
    const m = memory({ claimed: 0.25 });
    expect(belowReach(m, 10)).toBe(true);
    expect(belowReach({ ...m, lastDreamDay: 10 }, 10)).toBe(false);
    expect(belowReach({ ...m, lastReturnDay: 9 }, 10)).toBe(false);
    expect(belowReach({ ...m, lastUsedDay: 10, uses: 1 }, 10)).toBe(false);
  });

  test("revision pressure stays on its exponential curve", async () => {
    const { pressureAt } = await import("../src/core/physics/index.js");
    expect(pressureAt({ pressure: 1, lastChallengedDay: 0 }, 60)).toBeCloseTo(Math.exp(-1), 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// feeling counted once
// ═══════════════════════════════════════════════════════════════════════════

describe("feeling counted once (review 02 C1)", () => {
  test("`emotional` is not in sal()'s mean; height and slope take it, once each", () => {
    expect(sal({ novelty: null, relevance: 0.4, emotional: 0.9, predictive: 0.2, claimed: null })).toBeCloseTo(0.3, 10);
    expect(sal({ novelty: 0.6, relevance: 0.3, emotional: 1, predictive: 0, claimed: null })).toBeCloseTo(0.3, 10);
    const plain = memory({ claimed: 0.3 });
    const felt = memory({ claimed: 0.3, salience: salience(0.3, { emotional: 0.8 }) });
    // Height: the lift (EMO_LIFT x I), not a share of a mean.
    expect(strength(felt, 0) - strength(plain, 0)).toBeCloseTo(PHYSICS.EMO_LIFT * 0.8, 10);
    // Slope: e^(G x EMO_Q x I).
    expect(stability(felt) / stability(plain)).toBeCloseTo(Math.exp(8 * 0.5 * 0.8), 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// next change day (the turn-down)
// ═══════════════════════════════════════════════════════════════════════════

describe("next change day (review 13 C2)", () => {
  test("is the first day the band, the reach or the prune eligibility moves", () => {
    const m = memory({ claimed: 0.6 });
    const sem = daysUntilBelow(m, PHYSICS.THETA_SEM) as number;
    expect(nextChangeDay(m, 0)).toBe(sem);
    expect(strength(m, sem - 1)).toBeGreaterThanOrEqual(PHYSICS.THETA_SEM);
    expect(strength(m, sem)).toBeLessThan(PHYSICS.THETA_SEM);
    const reach = daysUntilBelow(m, PHYSICS.REACH) as number;
    expect(nextChangeDay(m, sem)).toBe(reach);
    const floor = daysUntilBelow(m, PHYSICS.PHI_PRUNE) as number;
    expect(nextChangeDay(m, reach)).toBe(floor);
    // A note already under the floor: the day its dwell completes.
    const low = memory({ claimed: 0.01 });
    expect(nextChangeDay(low, 3)).toBe(PHYSICS.D_FLOOR_DAYS);
    // A dated memory is looked at daily: its hold turns on the calendar.
    expect(nextChangeDay({ ...m, hold: { state: "pending" } }, 5)).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the dated hold
// ═══════════════════════════════════════════════════════════════════════════

describe("the dated hold (review 07 C1/C2)", () => {
  test("datedHold: pending through the date and the grace, spent after; a past date or a repeat", () => {
    const row = { event_date: "2026-11-01", learned_on: "2026-10-01", meta: "{}" };
    expect(datedHold(row, "2026-10-15")).toEqual({ state: "pending" });
    expect(datedHold(row, "2026-11-08")).toEqual({ state: "pending" });
    expect(datedHold(row, "2026-11-10")).toEqual({ state: "spent", closedDaysAgo: 2 });
    // A date already past when it was written is a note about it, not a reminder.
    expect(datedHold({ ...row, learned_on: "2026-11-05" }, "2026-11-06")).toBeNull();
    // A month: held to its last day plus grace.
    expect(datedHold({ ...row, event_date: "2026-11" }, "2026-12-07")).toEqual({ state: "pending" });
    // A live repeat is always pending.
    expect(datedHold({ ...row, meta: JSON.stringify({ recurring: "yearly" }) }, "2027-03-01")).toEqual({ state: "pending" });
    // No calendar today: no hold.
    expect(datedHold(row, "")).toBeNull();
  });

  test("a memory dated a month out stays in reach until its date; then it fades steeply", () => {
    const s = store();
    let date = "2026-10-01";
    runCycle({ store: s, date });
    const dated = s.put({ type: "memory", kind: "fact", body: "Renew the passport before the trip.", learnedOn: date, eventDate: "2026-11-01", salience: { claimed: 0.25 } });
    const plain = s.put({ type: "memory", kind: "fact", body: "Merged the docs tweak.", learnedOn: date, salience: { claimed: 0.25 } });
    const reach = (id: string): boolean => !belowReach(rowToPhysics(s.row(id) as NonNullable<ReturnType<Store["row"]>>), s.livedDay());
    let plainLeft: string | null = null;
    // Every calendar day through the date and its grace week is a lived day.
    const closes = addDays("2026-11-01", PHYSICS.HOLD_GRACE_DAYS);
    while (date < closes) {
      date = addDays(date, 1);
      runCycle({ store: s, date });
      expect(reach(dated)).toBe(true);
      if (plainLeft === null && !reach(plain)) plainLeft = date;
    }
    expect(plainLeft).toBe("2026-10-03");
    // The window has closed: below reach within two lived days, steeply.
    let after = 0;
    while (reach(dated) && after < 10) {
      date = addDays(date, 1);
      runCycle({ store: s, date });
      after += 1;
    }
    expect(after).toBeLessThanOrEqual(2);
    expect(s.row(dated)?.archived).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// exemptions and the exit
// ═══════════════════════════════════════════════════════════════════════════

describe("exit at the floor, and what never exits (review 03 C3/C4)", () => {
  test("a chapter, its copy and a live handoff are never archived; an ordinary floor memory exits after 14 lived days", () => {
    const s = store();
    let date = "2026-10-01";
    runCycle({ store: s, date });
    const chapter = s.put({ type: "episode", kind: "self", title: "A day", body: "## chapter 1\n\nI wrote the garden notes.", source: "episode", meta: { sessionId: "s1" } });
    const copy = s.put({ type: "memory", kind: "self", body: "I wrote the garden notes.", source: "episode", origin: { session: "s1", ref: chapter } });
    const floor = s.put({ type: "memory", kind: "fact", body: "A note nobody claimed.", salience: { claimed: 0 } });
    const handoff = s.put({ type: "schema", kind: "place", title: "Handoff", body: "Pick up the migration test.", meta: { role: HANDOFF_ROLE, scope: "/proj", writtenDay: s.livedDay() } });
    const born = s.livedDay();
    let floorExit: number | null = null;
    for (let i = 0; i < 40; i++) {
      date = addDays(date, 1);
      runCycle({ store: s, date });
      if (floorExit === null && s.row(floor)?.archived === 1) floorExit = s.livedDay();
      expect(s.row(chapter)?.archived).toBe(0);
      expect(s.row(copy)?.archived).toBe(0);
      // A handoff lives 14 lived days from its writing; while it lives, it stays.
      if (s.livedDay() - born < 14) expect(s.row(handoff)?.archived).toBe(0);
    }
    expect(floorExit).toBe(born + PHYSICS.D_FLOOR_DAYS);
    // Exit is archival: the words are still there, readable by id.
    expect(s.read(floor).doc.body).toBe("A note nobody claimed.");
    expect(s.row(floor)?.archived_reason).toBe("pruned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the turn-down
// ═══════════════════════════════════════════════════════════════════════════

describe("the turn-down by next_change_day (review 13 C2)", () => {
  test("the decay pass reads only rows whose state changes, and a use brings a row back to it", () => {
    const s = store();
    let date = "2026-10-01";
    runCycle({ store: s, date });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(s.put({ type: "memory", kind: "fact", body: `A steady fact number ${String(i)}.`, salience: { claimed: 0.7 } }));
    date = addDays(date, 1);
    const first = runCycle({ store: s, date });
    expect(first.phases.find((p) => p.phase === "decay")?.examined).toBe(20);
    for (const id of ids) expect((s.row(id)?.next_change_day ?? 0) > s.livedDay()).toBe(true);
    // Nothing crosses a line tomorrow: nothing is read.
    date = addDays(date, 1);
    const second = runCycle({ store: s, date });
    expect(second.phases.find((p) => p.phase === "decay")?.examined).toBe(0);
    // A use clears the row's day (the v13 trigger), so the next pass reads it.
    s.updatePhysics(ids[0] as string, { uses: 1, lastUsedDay: s.livedDay() });
    expect(s.row(ids[0] as string)?.next_change_day).toBeNull();
    date = addDays(date, 1);
    const third = runCycle({ store: s, date });
    expect(third.phases.find((p) => p.phase === "decay")?.examined).toBe(1);
    // So does a feeling.
    s.addFeelings(ids[1] as string, [{ whose: "self", emotion: "moved", strength: 0.7 }]);
    expect(s.row(ids[1] as string)?.next_change_day).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// store v13
// ═══════════════════════════════════════════════════════════════════════════

const V13_COLUMNS: readonly [string, string][] = [
  ["memories", "next_change_day"],
  ["memories", "dream_shown_day"],
  ["feelings", "recorded_day"],
  ["returns", "session"],
  ["edges", "source"],
  ["edges", "reinforced"],
];
const V13_INDEXES = [
  "memories_next_change",
  "memories_dream_shown",
  "memories_birth",
  "feelings_created",
  "edges_last_day",
  "edges_weight",
  "edges_dst",
  "derivations_parent",
];
const V13_TRIGGERS = ["memories_next_change_inputs", "feelings_next_change_insert", "feelings_next_change_update", "feelings_next_change_delete"];

function cols(path: string, table: string): string {
  const d = new Database(path, { readonly: true });
  try {
    return JSON.stringify(d.query(`PRAGMA table_info(${table})`).all());
  } finally {
    d.close();
  }
}

/** A store made by this build, turned back into a v12 file: the v13 objects dropped. */
function v12Store(): { id: string; felt: string } {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps") });
  s.advanceClock("2026-10-01");
  s.advanceClock("2026-10-02");
  const id = s.put({ type: "memory", kind: "fact", body: "The standup moved to nine on Mondays.", salience: { claimed: 0.4 } });
  s.addFeelings(id, [{ whose: "self", emotion: "relieved", strength: 0.5 }]);
  s.close();
  const db = new Database(paths.operational(dir));
  for (const t of V13_TRIGGERS) db.run(`DROP TRIGGER ${t}`);
  for (const i of V13_INDEXES) db.run(`DROP INDEX ${i}`);
  db.run("DROP TABLE derivations");
  for (const [t, c] of V13_COLUMNS) db.run(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  db.run("UPDATE meta SET value = '12' WHERE key = 'schemaVersion'");
  const felt = (db.query("SELECT id FROM feelings").get() as { id: string }).id;
  db.close();
  return { id, felt };
}

describe("store v13 — the one additive migration (synthesis §3)", () => {
  test("the version is 13 and the observer floor stays at 11", () => {
    expect(SCHEMA_VERSION).toBe(13);
    expect(OBSERVER_READ_FLOOR).toBe(11);
  });

  test("a v12 store migrates after a copy: every §3 column, table, index; recorded days backfilled; fresh and migrated converge", () => {
    const { id, felt } = v12Store();
    // An observer reads the v12 file as it stands.
    const reader = Store.open({ dir, observer: true });
    expect(reader.getMeta("schemaVersion")).toBe("12");
    expect(reader.row(id)?.body).toContain("standup");
    reader.close();

    const s = store();
    expect(s.getMeta("schemaVersion")).toBe("13");
    const snaps = readdirSync(join(root, "snaps")).filter((n) => n.includes("pre-migration-v12-to-v13"));
    expect(snaps.length).toBe(1);
    const up = JSON.parse(s.getMeta(V13_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
    expect(up["from"]).toBe("12");
    expect(up["feelings"]).toBe(1);
    // The feeling learned the day it was recorded: written in a session, its memory's birth.
    expect(s.feelingsOn([id]).get(id)?.[0]?.recorded_day).toBe(s.row(id)?.birth_day as number);
    expect(s.feelingsOn([id]).get(id)?.[0]?.id).toBe(felt);
    expect(s.row(id)?.next_change_day).toBeNull();
    s.close();
    open.splice(0);

    const db = new Database(paths.operational(dir), { readonly: true });
    const names = new Set((db.query("SELECT name FROM sqlite_master").all() as { name: string }[]).map((r) => r.name));
    db.close();
    for (const n of [...V13_INDEXES, ...V13_TRIGGERS, "derivations"]) expect(names.has(n)).toBe(true);

    const fresh = join(root, "fresh");
    Store.open({ dir: fresh, snapshotsDir: join(root, "snaps2") }).close();
    for (const t of ["memories", "feelings", "returns", "edges", "derivations"]) {
      expect(cols(paths.operational(dir), t)).toBe(cols(paths.operational(fresh), t));
    }
  });

  test("the copy taken before migrating is the way back: restored, it is the v12 store as it was", () => {
    const { id } = v12Store();
    const s = store();
    expect(s.getMeta("schemaVersion")).toBe("13");
    s.put({ type: "memory", kind: "fact", body: "Written after the upgrade." });
    s.close();
    open.splice(0);
    const snap = readdirSync(join(root, "snaps")).find((n) => n.includes("pre-migration-v12-to-v13")) as string;
    const copy = join(root, "snaps", snap, "counterparts.sqlite");
    expect(existsSync(copy)).toBe(true);
    // Put it back (the store closed): the database and nothing else.
    const live = paths.operational(dir);
    for (const extra of ["-wal", "-shm"]) rmSync(`${live}${extra}`, { force: true });
    copyFileSync(copy, live);
    const back = Store.open({ dir, observer: true });
    expect(back.getMeta("schemaVersion")).toBe("12");
    expect(back.row(id)?.body).toContain("standup");
    expect(back.list().length).toBe(1);
    back.close();
  });
});
