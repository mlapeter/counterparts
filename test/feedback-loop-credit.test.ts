/**
 * The feedback loop, Builder 1's half (2026-10-19, an experiment; check on
 * ~2026-10-22): A, graded use credit from ratings; B, strong co-use links; D,
 * habituation, light. Behaviours and orderings, never pinned tunable values:
 * every number below is read from the tunables it depends on.
 *
 * Hermetic: every store is a fresh temp dir, removed after; an unnamed store
 * refuses (`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, RECALL_RATED_EVENT } from "../src/core/counterpart.js";
import {
  CO_USE_MIN_SCORE,
  RATED_EVENT_NAME,
  freshGateState,
  gate,
  habituatedFrom,
  habituatedIds,
  loadGateState,
  planRatedUse,
  rateableSet,
  saveGateState,
  withTunables,
} from "../src/core/recall/index.js";
import type { Candidate, GateState, HabituationRow } from "../src/core/recall/index.js";
import { TUNABLES as PHYSICS, USE_TIER_WEIGHT, creditReturn } from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { TUNABLES as ASSOCIATE } from "../src/core/associate/index.js";
import { TUNABLES as RECALL } from "../src/core/recall/tunables.js";
import { coreRecurrence } from "../src/core/sleep/consolidate.js";
import type { Store } from "../src/core/store/index.js";
import { feedbackLoopFindings } from "../src/adapters/claude-code/doctor-feedback.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const EXPLICIT = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
let dir: string;
let priorEnv: string | undefined;
let priorExplicit: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorExplicit = process.env[EXPLICIT];
  dir = mkdtempSync(join(tmpdir(), "counterparts-feedback-"));
  process.env[ENV] = dir;
  process.env[EXPLICIT] = "1";
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  if (priorExplicit === undefined) delete process.env[EXPLICIT];
  else process.env[EXPLICIT] = priorExplicit;
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir });
  findable(c.store);
  open.push(c);
  return c;
}

/** Day n after 2026-08-01, as a calendar date. */
function date(n: number): string {
  const d = new Date(Date.UTC(2026, 7, 1 + n));
  return d.toISOString().slice(0, 10);
}

function fact(c: Counterpart, body: string): string {
  return c.store.put({ type: "memory", kind: "fact", body });
}

type Showing = { id: string; tier?: "surfaced" | "footnoted" };

/** Record showings to `sessionId` on `turn`, as recall's own save would. */
function shown(c: Counterpart, sessionId: string, turn: number, list: readonly (string | Showing)[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const s of list) {
    const e = typeof s === "string" ? { id: s } : s;
    surfaced[e.id] = { turn, tier: e.tier ?? "footnoted", trains: true };
  }
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

/** The edge weight a single link needs for the quiet-pointer lane (derived, never pinned). */
const POINTER_WEIGHT = (RECALL.LINK_POINTER_MIN_FRACTION * ASSOCIATE.MAX_OUT_WEIGHT) / ASSOCIATE.HOP_DECAY;

function weight(c: Counterpart, a: string, b: string): number {
  return c.associate.weightAt(a, b);
}

// ── A: the plan ─────────────────────────────────────────────────────────────

describe("A. what a rating call plans to credit", () => {
  test("each score maps to a rising use; 0 is none; unrated ambient showings in the stretch are glimpses", () => {
    const shownMap = rateableSet(
      {
        a: { turn: 1, tier: "footnoted" },
        b: { turn: 2, tier: "footnoted" },
        c: { turn: 2, tier: "surfaced" },
        old: { turn: 1, tier: "footnoted" },
        z: { turn: 3, tier: "footnoted" },
      },
      ["q"],
      ["o"],
    );
    const plan = planRatedUse({
      shown: shownMap,
      rated: [
        { id: "a", score: 3, lane: "footnotes", drewOn: false },
        { id: "b", score: 2, lane: "footnotes", drewOn: false },
        { id: "z", score: 0, lane: "footnotes", drewOn: false },
        { id: "o", score: 1, lane: "opened", drewOn: false },
      ],
      floor: 1,
      otherwiseUsed: [],
      maxMembers: 8,
    });
    const tier = new Map(plan.credits.map((x) => [x.id, x.tier]));
    expect(tier.has("z")).toBe(false);
    expect(USE_TIER_WEIGHT[tier.get("a") ?? "footnoted"]).toBeGreaterThan(USE_TIER_WEIGHT[tier.get("b") ?? "footnoted"]);
    expect(USE_TIER_WEIGHT[tier.get("b") ?? "footnoted"]).toBeGreaterThan(USE_TIER_WEIGHT[tier.get("o") ?? "footnoted"]);
    // The unrated loud line in the stretch is a glimpse, the smallest use above none.
    expect(USE_TIER_WEIGHT[tier.get("c") ?? "footnoted"]).toBeGreaterThan(0);
    expect(USE_TIER_WEIGHT[tier.get("c") ?? "footnoted"]).toBeLessThan(USE_TIER_WEIGHT[tier.get("o") ?? "footnoted"]);
    // Shown before the stretch, or handed over by a question, unrated: nothing.
    expect(tier.has("old")).toBe(false);
    expect(tier.has("q")).toBe(false);
  });

  test("the co-used set: strongest use first, never a 0, capped; shown-together pairs skip a 0", () => {
    const shownMap = rateableSet(
      { a: { turn: 2, tier: "footnoted" }, b: { turn: 2, tier: "footnoted" }, z: { turn: 2, tier: "footnoted" }, d: { turn: 3, tier: "footnoted" } },
      [],
      [],
    );
    const plan = planRatedUse({
      shown: shownMap,
      rated: [
        { id: "b", score: CO_USE_MIN_SCORE, lane: "footnotes", drewOn: false },
        { id: "a", score: 3, lane: "footnotes", drewOn: false },
        { id: "z", score: 0, lane: "footnotes", drewOn: false },
      ],
      floor: 0,
      otherwiseUsed: ["u", "z"],
      maxMembers: 2,
    });
    expect(plan.coUse).toEqual(["a", "u"]);
    expect(plan.coUseCapped).toBe(1);
    expect(plan.together).toEqual([["a", "b"]]);
  });
});

// ── A: physics and the store ────────────────────────────────────────────────

describe("A. the returns a graded use earns", () => {
  const m = (over: Partial<MemoryPhysics> = {}): MemoryPhysics =>
    ({ kind: "fact", birthDay: 0, lastUsedDay: 0, uses: 0, returns: 0, returnDays: 0, firstReturnDay: null, lastReturnDay: null, lastDreamDay: null, ...over }) as MemoryPhysics;

  test("a glimpse and a rating of 1 are partial returns: durability only, no lane day", () => {
    for (const source of ["shown", "ontopic"] as const) {
      const r = creditReturn(m(), 5, { source });
      expect(r.counted).toBe(true);
      expect(r.next.lastReturnDay).toBeNull();
      expect(r.next.returnDays).toBe(0);
      expect(r.next.returns).toBeGreaterThan(0);
    }
  });

  test("a rating of 2 is an awake return; the repeat credit (surfaced) still is not", () => {
    expect(creditReturn(m(), 5, { source: "awake", tierWeight: USE_TIER_WEIGHT.useful }).counted).toBe(true);
    expect(creditReturn(m(), 5, { source: "awake", tierWeight: USE_TIER_WEIGHT.surfaced }).reason).toBe("not-referenced");
  });

  test("across sessions, a full use after today's glimpse lifts the day to a full use, not past it", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const a = fact(c, "Glimpsed then opened.");
    const b = fact(c, "Opened only.");
    c.store.advanceClock(date(1));
    c.store.reinforce(a, c.store.livedDay(), "shown", { session: "s1" });
    c.store.reinforce(a, c.store.livedDay(), "referenced", { session: "s2" });
    c.store.reinforce(b, c.store.livedDay(), "referenced", { session: "s2" });
    expect(c.store.row(a)?.uses).toBeCloseTo(c.store.row(b)?.uses ?? -1, 9);
    // The glimpse's return was taken back for the full one.
    expect(c.store.returnsOf(a).map((r) => r.source)).toEqual(c.store.returnsOf(b).map((r) => r.source));
  });

  test("after the night's reflection return, a glimpse in one session does not block a full use in another that day", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const a = fact(c, "Reflected at night, glimpsed, then used.");
    const b = fact(c, "Used only.");
    c.store.advanceClock(date(3));
    const day = c.store.livedDay();
    expect(c.store.reflectReturn(a, day, { session: "night" }).counted).toBe(true);
    c.store.reflectReturn(b, day, { session: "night" });
    c.store.reinforce(a, day, "shown", { session: "s1" });
    c.store.reinforce(a, day, "referenced", { session: "s2" });
    c.store.reinforce(b, day, "referenced", { session: "s2" });
    expect(c.store.row(a)?.uses).toBeCloseTo(c.store.row(b)?.uses ?? -1, 9);
    expect(c.store.row(a)?.returns).toBeCloseTo(c.store.row(b)?.returns ?? -1, 9);
  });

  test("drewOn is a full use with an awake return, as an open is (the 2026-10-19 experiment)", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const drawn = fact(c, "Drawn on by name.");
    const opened = fact(c, "Opened by id.");
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [drawn]);
    expect(c.creditDrewOn("s1", [drawn]).credited).toEqual([drawn]);
    c.store.reinforce(opened, c.store.livedDay(), "referenced", { session: "s1" });
    expect(c.store.row(drawn)?.uses).toBeCloseTo(c.store.row(opened)?.uses ?? -1, 9);
    expect(c.store.returnsOf(drawn).map((r) => r.source)).toEqual(c.store.returnsOf(opened).map((r) => r.source));
  });

  test("a memory only ever shown never anchors itself and never has a full recurrence day", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const ruling = fact(c, "A standing ruling that is footnoted every day.");
    for (let d = 1; d <= 25; d++) {
      c.store.advanceClock(date(d));
      c.store.reinforce(ruling, c.store.livedDay(), "shown", { session: `s${String(d)}` });
    }
    const rec = coreRecurrence(c.store, ruling, c.store.livedDay());
    expect(rec.anchored).toBe(false);
    expect(rec.fullDays).toBe(0);
    expect(rec.days).toBeLessThan(PHYSICS.CORE_SLOW_DAYS);
  });
});

// ── A + B through rateShown ─────────────────────────────────────────────────

describe("A + B. rateShown credits the stretch and links what was co-used", () => {
  test("unrated showings in the stretch are glimpsed once; a later call does not re-credit an earlier stretch", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const [a, b, d] = ["Ferry timetable for the island.", "The island cafe closes at four.", "Island tide tables."].map((t) => fact(c, t)) as [string, string, string];
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [a, b]);
    const first = c.rateShown("s1", [{ id: a, score: 2 }]);
    expect(first.used.credited.useful).toBe(1);
    expect(first.used.credited.shown).toBe(1);
    expect(c.store.row(b)?.uses ?? 0).toBeGreaterThan(0);
    c.store.advanceClock(date(2));
    shown(c, "s1", 2, [d]);
    const second = c.rateShown("s1", [{ id: d, score: 1 }]);
    // b was in the first stretch: not glimpsed again.
    expect(second.used.credited.shown).toBe(0);
    expect(second.used.credited.ontopic).toBe(1);
  });

  test("a handoff, an archived row or a superseded one is scored but not credited", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const gone = fact(c, "This one was archived.");
    const kept = fact(c, "This one stays.");
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [gone, kept]);
    c.store.archive(gone, "test");
    const r = c.rateShown("s1", [
      { id: gone, score: 3 },
      { id: kept, score: 3 },
    ]);
    expect(r.rated.length).toBe(2);
    expect(r.used.credited.referenced).toBe(1);
    expect(r.used.notCredited["archived"]).toBe(1);
  });

  test("two co-uses reach the quiet-pointer weight; one does not; the row says what was linked", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const a = fact(c, "The sourdough starter died after two weeks of neglect.");
    const b = fact(c, "Vellichor quixotry zygomorphic ephemera.");
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [a, b]);
    const once = c.rateShown("s1", [
      { id: a, score: 2 },
      { id: b, score: 3 },
    ]);
    expect(once.used.coUse.pairs).toBe(1);
    c.applyPendingAssociations({ session: "s1" });
    expect(weight(c, a, b)).toBeLessThan(POINTER_WEIGHT);
    shown(c, "s2", 1, [a, b]);
    c.rateShown("s2", [
      { id: a, score: 2 },
      { id: b, score: 2 },
    ]);
    c.applyPendingAssociations({ session: "s2" });
    expect(weight(c, a, b)).toBeGreaterThanOrEqual(POINTER_WEIGHT);
    expect(weight(c, b, a)).toBeGreaterThanOrEqual(POINTER_WEIGHT);
    const row = JSON.parse(c.store.eventLog({ name: RECALL_RATED_EVENT, order: "desc", limit: 1 })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(row["coUse"]).toEqual(expect.objectContaining({ members: 2, pairs: 1 }));
  });

  test("a retried call on the same turn links each co-used pair once; a new pair in the retry still links", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const [a, b, d] = ["Kiln shelf posts.", "Kiln wash recipe.", "Kiln cone chart."].map((t) => fact(c, t)) as [string, string, string];
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [a, b, d]);
    const first = c.rateShown("s1", [
      { id: a, score: 3 },
      { id: b, score: 2 },
    ]);
    expect(first.used.coUse.pairs).toBe(1);
    c.applyPendingAssociations({ session: "s1" });
    const once = weight(c, a, b);
    // The same ratings again, and d now rated useful too: only d's pairs are new.
    const retry = c.rateShown("s1", [
      { id: a, score: 3 },
      { id: b, score: 2 },
      { id: d, score: 2 },
    ]);
    expect(retry.used.coUse.pairs).toBe(2);
    c.applyPendingAssociations({ session: "s1" });
    expect(weight(c, a, b)).toBeCloseTo(once, 9);
    expect(weight(c, a, d)).toBeGreaterThan(0);
  });

  test("a memory rated 0 is never co-used, and shown-together pairs leave it out", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const [a, b, z] = ["Garden shed key.", "Garden shed padlock.", "Unrelated noise."].map((t) => fact(c, t)) as [string, string, string];
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [a, b, z]);
    c.rateShown("s1", [
      { id: a, score: 3 },
      { id: b, score: 1 },
      { id: z, score: 0 },
    ]);
    c.applyPendingAssociations({ session: "s1" });
    expect(weight(c, a, z)).toBe(0);
    expect(weight(c, b, z)).toBe(0);
    // Shown together, neither a 0: a faint trail, well under a co-use.
    expect(weight(c, a, b)).toBeGreaterThan(0);
    expect(weight(c, a, b)).toBeLessThan(ASSOCIATE.CO_USE_DEPOSIT);
  });
});

// ── watching ────────────────────────────────────────────────────────────────

describe("the doctor's Feedback loop line", () => {
  test("reads what the rating rows credited and linked, the links at pointer weight, and who is habituated", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const [a, b, z] = ["Pointer pair one.", "Pointer pair two.", "Noise."].map((t) => fact(c, t)) as [string, string, string];
    c.store.advanceClock(date(1));
    expect(feedbackLoopFindings(c.store)[0]?.data["calls"]).toBe(0);
    for (const s of ["s1", "s2"]) {
      shown(c, s, 1, [a, b, z]);
      c.rateShown(s, [
        { id: a, score: 3 },
        { id: b, score: 2 },
        { id: z, score: 0 },
      ]);
      c.applyPendingAssociations({ session: s });
    }
    const f = feedbackLoopFindings(c.store)[0];
    expect(f?.severity).toBe("green");
    expect(f?.data["calls"]).toBe(2);
    expect(f?.data["coUsePairs"]).toBe(2);
    expect(f?.data["atPointer"]).toBe(2);
    expect(f?.data["habituatedNow"]).toBe(1);
    expect(f?.detail).toContain("habituated now");
  });
});

// ── D: habituation ──────────────────────────────────────────────────────────

describe("D. habituation", () => {
  const row = (seq: number, day: number, session: string, zero: string[], cleared: string[] = []): HabituationRow => ({ seq, day, session, zero, cleared });

  test("rated 0 in enough sessions inside the window habituates; one session does not; a later useful rating clears; it ages out", () => {
    const t = withTunables();
    const need = t.HABITUATION_MIN_SESSIONS;
    const rows = Array.from({ length: need }, (_, i) => row(i + 1, 10, `s${String(i)}`, ["x"]));
    expect(habituatedFrom(rows.slice(0, need - 1), 10, t).has("x")).toBe(false);
    expect(habituatedFrom(rows, 10, t).has("x")).toBe(true);
    // The same session twice is one session.
    expect(habituatedFrom([row(1, 10, "s", ["x"]), row(2, 10, "s", ["x"])], 10, t).has("x")).toBe(need <= 1);
    expect(habituatedFrom([...rows, row(99, 10, "later", [], ["x"])], 10, t).has("x")).toBe(false);
    expect(habituatedFrom(rows, 10 + t.HABITUATION_WINDOW_DAYS, t).has("x")).toBe(false);
  });

  test("the gate raises a habituated memory's bar and says so; a lift, never a veto", () => {
    const c = brain();
    const id = fact(c, "A habituated note.");
    const cand = (activation: number): Candidate =>
      ({
        id,
        kind: "fact",
        doc: c.store.readProse(id),
        physics: { kind: "fact", salience: { novelty: null, relevance: 0.5, emotional: 0, predictive: 0.5 } } as never,
        strength: 1,
        sal: 0.5,
        mood: 0,
        cue: activation,
        temporal: 0,
        semantic: 0,
        arrival: 0,
        hops: 0,
        activation,
        cueFraction: 1,
        matched: 1,
        trains: true,
        maxTier: "surfaced",
        confidential: false,
      }) as Candidate;
    const t = withTunables();
    const input = (activation: number, habituated?: Map<string, number>) => ({
      candidates: [cand(activation)],
      state: freshGateState("g"),
      storeSize: 500,
      owner: true,
      affectStated: false,
      turn: 1,
      ...(habituated === undefined ? {} : { habituated }),
    });
    const plain = gate(input(1_000), t);
    const floorBar = plain.verdicts[0]?.bar ?? 0;
    // Just over the plain bar: shown plainly, not when habituated.
    const just = floorBar * (1 + t.HABITUATION_BAR_LIFT / 2);
    const h = new Map([[id, t.HABITUATION_MIN_SESSIONS]]);
    expect(gate(input(just), t).footnotes.length + gate(input(just), t).surfaced.length).toBe(1);
    const damped = gate(input(just, h), t);
    expect(damped.footnotes.length + damped.surfaced.length).toBe(0);
    expect(damped.verdicts[0]?.habituated).toBe(true);
    expect(damped.verdicts[0]?.bar).toBeGreaterThan(floorBar);
    // Strongly reached, it still shows.
    const strong = gate(input(1_000, h), t);
    expect(strong.footnotes.length + strong.surfaced.length).toBe(1);
  });

  test("the note is written after a rating and agrees with the rows; without it the rows answer the same", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const x = fact(c, "Noise memory.");
    const y = fact(c, "Other memory.");
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [x, y]);
    c.rateShown("s1", [{ id: x, score: 0 }, { id: y, score: 2 }]);
    shown(c, "s2", 1, [x]);
    const r = c.rateShown("s2", [{ id: x, score: 0 }]);
    expect(r.used.habituated).toBe(1);
    const day = c.store.livedDay();
    const t = c.recall.tunables;
    expect([...habituatedIds(c.store, day, t).keys()]).toEqual([x]);
    expect(c.store.cacheNote("habituation")).not.toBeNull();
    // A cache reset drops the note; the rows still answer.
    c.store.rebuildCache();
    expect(c.store.cacheNote("habituation")).toBeNull();
    expect([...habituatedIds(c.store, day, t).keys()]).toEqual([x]);
    // A useful rating later clears it.
    shown(c, "s3", 1, [x]);
    c.rateShown("s3", [{ id: x, score: 2 }]);
    expect(habituatedIds(c.store, c.store.livedDay(), t).size).toBe(0);
  });

  test("the habituation reader and the composition root name the same rows", () => {
    expect(RATED_EVENT_NAME).toBe(RECALL_RATED_EVENT);
  });

  test("an observer's store is read, never written", () => {
    const c = brain();
    c.store.advanceClock(date(0));
    const x = fact(c, "Noise memory.");
    c.store.advanceClock(date(1));
    shown(c, "s1", 1, [x]);
    c.rateShown("s1", [{ id: x, score: 0 }]);
    c.close();
    open.splice(0);
    const watcher = Counterpart.open({ dir, observer: true });
    open.push(watcher);
    const before = (watcher.store as Store).cacheNote("habituation");
    const r = watcher.rateShown("s2", [{ id: x, score: 0 }]);
    expect(r.recorded).toBe(false);
    expect(r.used.credited).toEqual({ shown: 0, ontopic: 0, useful: 0, referenced: 0 });
    expect((watcher.store as Store).cacheNote("habituation")).toBe(before);
  });
});
