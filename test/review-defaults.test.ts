/**
 * The working defaults taken after the adversarial review of #251
 * (2026-09-26): each one held here.
 *
 *   Q1 — a legacy row's reinforcement days become LEGACY returns at the v8
 *        upgrade: durability only, never a lane day; spacing reads them.
 *   Q2 — the slow lane needs the semantic floor on the day it promotes.
 *   Q3 — a quoted use is organic only when recall surfaced it that same turn.
 *   Q4 — a merge's return days are the UNION of distinct days, not a sum.
 *   Q5 — a dream replay counts at most once per `RETURN_SPACING_DAYS`.
 *   Q6 — the owner's removal redacts the journal of any dream that cites or
 *        quotes the memory, and keeps the row.
 *   and an undone dream no longer lights Dreaming.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES, creditReturn, promotionEligibility, spacingWeight, stability } from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/physics/index.js";
import { freshGateState, saveGateState } from "../src/core/recall/session.js";
import { V8_CENSUS_KEY, preV8, runCycle } from "../src/core/sleep/index.js";
import type { UpgradeCensus } from "../src/core/sleep/index.js";
import { Store, V8_UPGRADE_KEY } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { stripToV7 } from "./v7-fixture.js";
import { withTwoLanes } from "./two-lanes-fixture.js";

let dir: string;
const open: { close(): void }[] = [];
let offsetMs = 0;

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-review-defaults-"));
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => Date.now() + offsetMs });
  open.push(c);
  return c;
}

function days(s: { advanceClock(d: string): number }, from: number, to: number): void {
  for (let d = from; d <= to; d += 1) s.advanceClock(`2026-08-${String(d).padStart(2, "0")}`);
}

function phys(p: Partial<MemoryPhysics>): MemoryPhysics {
  return {
    kind: "self",
    salience: { novelty: null, relevance: 0.9, emotional: 0, predictive: 0.9, claimed: null },
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

describe("Q1 — the upgrade credits a legacy row's reinforcement days as returns", () => {
  test("evenly placed legacy returns, weighed by spacing; durability only; spacing reads them after", () => {
    const storeDir = join(dir, "store");
    const s = Store.open({ dir: storeDir });
    days(s, 1, 13);
    const used = s.put({
      type: "memory",
      kind: "fact",
      body: "The release train leaves every other Thursday at noon.",
      salience: { relevance: 0.6, emotional: 0, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 9, uses: 3, reinforcedDays: 3, consolidated: true },
    });
    const never = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory nobody came back to.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    s.close();
    stripToV7(storeDir);
    const up = Store.open({ dir: storeDir });
    open.push(up);
    const rows = up.returnsOf(used);
    expect(rows.map((r) => [r.day, r.source])).toEqual([
      [3, "legacy"],
      [6, "legacy"],
      [9, "legacy"],
    ]);
    const p = up.physicsOf(used);
    expect(p.returns).toBeCloseTo(3 * spacingWeight(3), 10);
    // Durability only: no lane day, no first/last awake return.
    expect(p.returnDays).toBe(0);
    expect(p.firstReturnDay).toBeNull();
    expect(p.lastReturnDay).toBeNull();
    expect(stability(p)).toBeGreaterThan(stability(preV8(p)));
    expect(up.returnsOf(never)).toEqual([]);
    const upgrade = JSON.parse(up.getMeta(V8_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
    expect(upgrade["legacyReturns"]).toBe(1);
    // The census: nothing weaker or down; the credited row reads stronger.
    runCycle({ store: up, date: "2026-08-14" });
    const census = JSON.parse(up.getMeta(V8_CENSUS_KEY) ?? "null") as UpgradeCensus;
    expect(census).toMatchObject({ bandDown: 0, weaker: 0, pruneSooner: 0 });
    // A return after the upgrade measures its spacing from the last legacy day.
    const day = up.livedDay();
    const r = up.reinforce(used, day, "referenced", { cued: true });
    expect(r.ret).toMatchObject({ counted: true, gap: day - 9 });
    expect(up.physicsOf(used).returnDays).toBe(1);
  });
});

describe("Q2 — the slow lane needs the semantic floor on the day it promotes", () => {
  // The two lanes (physics §5.3 until 2026-10-24): the support door is pinned off here (E2).
  withTwoLanes();
  test("a faint self memory back on five days over three weeks is not core; a strong one is", () => {
    const lane = { returnDays: 5, firstReturnDay: 2, lastReturnDay: 30, returns: 2, lastUsedDay: 30 };
    const faint = phys({
      ...lane,
      salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
      uses: 5,
    });
    const v = promotionEligibility(faint, { aboutMe: true, day: 31 });
    expect(v.slow.days).toBe(5);
    expect(v.slow.span).toBe(28);
    expect(v.slow.strength ?? 1).toBeLessThan(TUNABLES.THETA_SEM);
    expect(v.slow.met).toBe(false);
    expect(v.eligible).toBe(false);
    const strong = phys({ ...lane, uses: 5 });
    const w = promotionEligibility(strong, { aboutMe: true, day: 31 });
    expect(w.slow.met).toBe(true);
    expect(w.lane).toBe("slow");
  });
});

describe("Q3 — a quoted use is organic only when recall surfaced it this same turn", () => {
  test("surfaced turns ago and showing in the hints lane: not a return; surfaced this turn: a return", () => {
    const c = brain();
    days(c.store, 1, 12);
    const day = c.store.livedDay();
    const put = (body: string): string =>
      c.store.put({ type: "memory", kind: "fact", body, physics: { birthDay: 1, lastUsedDay: 1 } } satisfies PutInput);
    const earlier = put("The staging database is restored from the Sunday snapshot every week.");
    const now = put("The backup job moved to two in the morning to miss the batch window.");
    c.store.recordHintDisplay(day, [
      { id: earlier, load: 1 },
      { id: now, load: 1 },
    ]);
    const state = freshGateState("s-q3");
    state.turn = 5;
    state.surfaced[earlier] = { turn: 3, tier: "surfaced", trains: true };
    state.surfaced[now] = { turn: 5, tier: "surfaced", trains: true };
    saveGateState(c.store, state, 1_000);
    const a = c.resolveUse("s-q3", earlier, "referenced", { cued: true });
    expect(a.credited).toBe(true);
    expect((a.outcome as { ret?: unknown } | null)?.ret).toMatchObject({ counted: false, reason: "on-display" });
    const b = c.resolveUse("s-q3", now, "referenced", { cued: true });
    expect(b.credited).toBe(true);
    expect((b.outcome as { ret?: unknown } | null)?.ret).toMatchObject({ counted: true });
  });
});

describe("Q4 — a merge's return days are the union of distinct days", () => {
  test("two near-copies that came back on overlapping days: the merged memory counts each day once", () => {
    const c = brain();
    days(c.store, 1, 20);
    const put = (body: string): string =>
      c.store.put({
        type: "memory",
        kind: "self",
        body,
        salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
        physics: { birthDay: 1, lastUsedDay: 1 },
      });
    const a = put("I say what I do not know before I guess at an answer.");
    const b = put("I say plainly what I do not know before I guess.");
    // Returns: a on days 4, 8, 12; b on days 8, 12, 16 — four distinct days.
    let lastA = 1;
    let lastB = 1;
    for (const d of [4, 8, 12, 16]) {
      if (d !== 16) {
        c.store.updatePhysics(a, { lastUsedDay: lastA });
        c.store.reinforce(a, d, "referenced", { cued: true });
        lastA = d;
      }
      if (d !== 4) {
        c.store.updatePhysics(b, { lastUsedDay: lastB });
        c.store.reinforce(b, d, "referenced", { cued: true });
        lastB = d;
      }
    }
    expect(c.store.physicsOf(a).returnDays).toBe(3);
    expect(c.store.physicsOf(b).returnDays).toBe(3);
    const m = c.store.put({ type: "memory", kind: "self", body: "I say what I do not know first." });
    c.store.supersedeInto(a, m, "dream-merge", { carryReturns: true });
    c.store.supersedeInto(b, m, "dream-merge", { carryReturns: true });
    const p = c.store.physicsOf(m);
    expect(p.returnDays).toBe(4);
    expect(p.firstReturnDay).toBe(4);
    expect(p.lastReturnDay).toBe(16);
  });
});

describe("Q5 — a dream replay counts at most once per RETURN_SPACING_DAYS", () => {
  test("replayed nightly, it counts weekly; a nightly year stays below a weekly awake one", () => {
    let m = phys({ kind: "fact", birthDay: 0 });
    let counted = 0;
    for (let d = 1; d <= 365; d += 1) {
      const r = creditReturn(m, d, { source: "dream" });
      if (r.counted) {
        counted += 1;
        m = { ...m, ...r.next };
      } else if (d - (m.lastDreamDay ?? 0) < TUNABLES.RETURN_SPACING_DAYS && m.lastDreamDay !== null && m.lastDreamDay !== undefined) {
        expect(r.reason).toBe("dream-spaced");
      }
    }
    expect(counted).toBe(Math.floor(364 / TUNABLES.RETURN_SPACING_DAYS) + 1);
    let w = phys({ kind: "fact", birthDay: 0 });
    for (let d = 7; d <= 365; d += 7) {
      const r = creditReturn(w, d, { source: "awake" });
      w = { ...w, ...r.next };
    }
    expect(m.returns ?? 0).toBeLessThan(w.returns ?? 0);
  });
});

describe("Q6 — removal redacts a dream journal that cites or quotes the memory", () => {
  test("the journal row stays, its words go; a dream that never met the memory is untouched", async () => {
    const c = brain();
    days(c.store, 1, 12);
    const day = c.store.livedDay();
    const put = (body: string): string =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    const secret = put("Sarah is leaving the company in November and has not told the team yet.");
    put("The migration step must run before the container boots, or it boots empty.");
    put("Run the migration before starting the container, otherwise it starts empty.");
    const begun = c.dreams.begin({ session: "s-q6" });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.dream;
    expect(Object.keys(begun.bundle.memories)).toContain(secret);
    c.dreams.journal({ dream: id, session: "s-q6", title: "Leaving", text: "I dreamed Sarah is leaving the company in November." });
    // The owner's forget door, as the removal flow drives it: requested, dark, chased.
    c.store.appendRemovalRecord({ memoryId: secret, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: secret, stage: "dark", actor: "owner", reason: "test" });
    const { chaseRemoved } = await import("../src/core/store/owner-op-seam.js");
    const report = chaseRemoved(c.store, secret);
    expect(report.neutralized).toContainEqual({ surface: "operational.dreams", count: 1 });
    const row = c.store.dream(id);
    expect(row?.state).toBe("journaled");
    expect(row?.journal).toContain("redacted");
    expect(row?.journal ?? "").not.toContain("November");
    expect(row?.title).toBe("(redacted)");
  });
});

describe("an undone dream no longer lights Dreaming", () => {
  test("journaled: lit; undone: dark again", () => {
    const c = brain();
    days(c.store, 1, 12);
    const day = c.store.livedDay();
    for (const body of [
      "The nightly backup job moved to two in the morning to miss the batch window.",
      "The batch window now ends at one thirty, so backups start after it.",
      "Backups and batch jobs share the same disk, so they must not overlap.",
    ]) {
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    const begun = c.dreams.begin({ session: "s-lit" });
    if (!begun.ok) throw new Error(begun.reason);
    const shown = Object.keys(begun.bundle.memories);
    c.dreams.propose({ dream: begun.bundle.dream, session: "s-lit", changes: [{ action: "link", a: shown[0] as string, b: shown[1] as string }] });
    c.dreams.journal({ dream: begun.bundle.dream, session: "s-lit", text: "A dream." });
    const lit = (): boolean =>
      mechanismEvidence(c.store, { sinceDay: day - 7, today: day }).verdicts.find((v) => v.id === "dreaming")?.fired ?? false;
    expect(lit()).toBe(true);
    c.dreams.undo(begun.bundle.dream);
    expect(lit()).toBe(false);
  });
});
