/**
 * "Might be relevant:" — the hints lane rotates instead of freezing on the
 * strongest memory (2026-09-26, the owner's "rich get richer"; harvested from
 * the held #238 and reworked after its review).
 *
 * One strong memory held the hints lane nearly every session: it was shown, the
 * assistant mentioned it, the mention was credited, it stayed strongest, it was
 * shown again. Three things break the loop, and these tests pin each:
 *
 *   - a hint is scored on its ORGANIC strength — decayed since its last use that
 *     the display cannot have prompted (`self/identity.ts#hintReading`);
 *   - each showing adds a habituation load that recovers over lived days, and a
 *     use while shown does not soften it (#238's half step is gone);
 *   - a use while shown still credits the memory, but it is not a RETURN, so it
 *     buys no durability (physics §5.11) and no core lane day.
 *
 * Hermetic: every test opens a fresh temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SELF_TUNABLES, Self, hintReading } from "../src/core/self/index.js";
import type { SelfTunables } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";
import type { WakeDisplayRow } from "../src/core/store/index.js";
import type { MemoryPhysics } from "../src/core/types.js";

const BUDGET = 9_000;

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-nearby-"));
});

afterEach(() => {
  for (const c of closers.splice(0)) {
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
  closers.push(s);
  return s;
}

/** A plain warm fact: salience is the mean of the three claimed dimensions. */
function warm(s: Store, body: string, relevance: number, birthDay = 0): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance, emotional: 0.8, predictive: 0.8 },
    physics: { birthDay, lastUsedDay: birthDay },
  });
}

/** The hints lane is this file's subject: on, though it is off the wake by default since WK1 (2026-10-30). */
function self(s: Store, over: Partial<SelfTunables> = {}): Self {
  return new Self({ store: s, tunables: { HINTS_IN_WAKE: true, ...over } });
}

/** One day's render, as the worker runs it; returns the KEPT hint ids. */
function renderDay(me: Self, day: number): string[] {
  return me.boundary({ budgetBytes: BUDGET, day }).briefing.kept.hints;
}

function physics(over: Partial<MemoryPhysics> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: { novelty: null, relevance: 0.9, emotional: 0.8, predictive: 0.8 },
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    consolidated: false,
    promotedIdentity: false,
    protected: false,
    pressure: 0,
    lastChallengedDay: null,
    ...over,
  };
}

function display(over: Partial<WakeDisplayRow> = {}): WakeDisplayRow {
  return {
    memory_id: "m",
    lane: "hints",
    first_day: 1,
    shown_day: 1,
    closed_day: null,
    load: 1,
    ever_day: 1,
    ever_uses: 0,
    ever_last_used: 0,
    updated_at: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// the reading
// ---------------------------------------------------------------------------

describe("hintReading — organic strength x habituation", () => {
  const t = SELF_TUNABLES;

  test("fresh, one showing, recovery, and the organic reset", () => {
    expect(hintReading(physics(), undefined, 5, t)).toMatchObject({ habit: "fresh", habituation: 1, load: 0 });

    // Kept on day 1, still showing at day 2: one step, one day of recovery.
    const shown = hintReading(physics(), display(), 2, t);
    expect(shown.habit).toBe("habituated");
    expect(shown.load).toBeCloseTo(Math.exp(-1 / t.HINT_RECOVERY_DAYS), 10);
    expect(shown.habituation).toBeLessThan(1);
    expect(shown.nextLoad).toBeCloseTo(shown.load + t.HINT_STEP, 10);

    // Used while showing is NOT softer than ignored: the display may have
    // prompted it (#238's half step, dropped).
    const usedWhileShown = hintReading(physics({ uses: 1, lastUsedDay: 2 }), display(), 2, t);
    expect(usedWhileShown.load).toBeCloseTo(shown.load, 10);

    // Dropped on day 2, never used since: recovers with time and nothing else.
    const closed = display({ closed_day: 2 });
    const soon = hintReading(physics(), closed, 3, t).habituation;
    const later = hintReading(physics(), closed, 12, t).habituation;
    expect(later).toBeGreaterThan(soon);
    expect(later).toBeGreaterThan(0.9);

    // Came back AFTER it left the wake: an organic return resets the load.
    const returned = physics({ lastReturnDay: 3, returnDays: 1, firstReturnDay: 3, lastUsedDay: 3, uses: 1 });
    expect(hintReading(returned, closed, 4, t)).toMatchObject({ habit: "reset", load: 0, habituation: 1 });
  });

  test("a use while it was showing keeps its own strength up but not its hint score", () => {
    // Used five times on display since day 1: `uses` and `lastUsedDay` moved,
    // no return was counted. The score reads it as it stood before it was shown.
    const used = physics({ uses: 5, lastUsedDay: 20 });
    const r = hintReading(used, display({ first_day: 1, shown_day: 20 }), 20, SELF_TUNABLES);
    const neverUsed = hintReading(physics(), undefined, 20, SELF_TUNABLES).organic;
    expect(r.organic).toBeCloseTo(neverUsed, 10);
    // …while one organic return (after it left the wake) does count.
    const returned = physics({ uses: 6, lastUsedDay: 20, returnDays: 1, firstReturnDay: 20, lastReturnDay: 20 });
    const back = hintReading(returned, display({ first_day: 1, shown_day: 15, closed_day: 15 }), 20, SELF_TUNABLES);
    expect(back.organic).toBeGreaterThan(neverUsed);
  });

  test("a same-day re-render is one showing, not two", () => {
    const r = hintReading(physics(), display({ shown_day: 4, load: 1.7 }), 4, SELF_TUNABLES);
    expect(r.nextLoad).toBe(1.7);
  });
});

// ---------------------------------------------------------------------------
// the lane, over real renders
// ---------------------------------------------------------------------------

describe("the hints lane rotates, over real renders", () => {
  test("repeated shown-but-unused hints rotate out, then come back", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const next = warm(s, "A slightly less strong warm thing.", 0.75);
    const me = self(s, { HINTS_MAX: 1 });

    expect(renderDay(me, 1)).toEqual([strong]);
    // Day 2: the strong one was on display and nobody used it — it yields.
    expect(renderDay(me, 2)).toEqual([next]);
    // Day 3: now the other one carries the load, and the strong one has
    // recovered a day's worth — it is back.
    expect(renderDay(me, 3)).toEqual([strong]);

    const rows = s.wakeDisplays();
    expect(rows.get(strong)).toMatchObject({ shown_day: 3, closed_day: null });
    expect(rows.get(next)).toMatchObject({ shown_day: 2, closed_day: 3 });
  });

  test("a hint that rotated out recovers its pull over lived days without being shown", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const me = self(s, { HINTS_MAX: 1 });
    for (const d of [1, 2, 3]) renderDay(me, d);
    const reading = (day: number): number =>
      hintReading(s.physicsOf(strong), s.wakeDisplays().get(strong), day, SELF_TUNABLES).habituation;
    expect(reading(4)).toBeLessThan(0.6);
    expect(reading(12)).toBeGreaterThan(reading(6));
    expect(reading(20)).toBeGreaterThan(0.95);
  });

  test("used after it left the wake: a return, and the load resets", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    warm(s, "A slightly less strong warm thing.", 0.75);
    const me = self(s, { HINTS_MAX: 1 });
    renderDay(me, 1); // strong shown
    renderDay(me, 2); // strong dropped (closed at 2)
    const credit = s.reinforce(strong, 3, "referenced");
    expect(credit.credited).toBe(true);
    expect(credit.ret?.reason).toBe("counted");
    const r = hintReading(s.physicsOf(strong), s.wakeDisplays().get(strong), 4, SELF_TUNABLES);
    expect(r.habit).toBe("reset");
    expect(r.habituation).toBe(1);
  });

  test("used WHILE shown: credited as a use, refused as a return", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    renderDay(self(s, { HINTS_MAX: 1 }), 1);
    const credit = s.reinforce(strong, 2, "referenced");
    expect(credit.credited).toBe(true);
    expect(credit.ret).toMatchObject({ counted: false, reason: "on-display" });
    const p = s.physicsOf(strong);
    expect(p.uses).toBe(1);
    expect(p.returns).toBe(0);
    expect(p.returnDays).toBe(0);
    expect(s.returnsOf(strong)).toEqual([]);
  });

  test("used while shown but brought up by the turn's own cue: organic, a return", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    renderDay(self(s, { HINTS_MAX: 1 }), 1);
    const credit = s.reinforce(strong, 2, "referenced", { cued: true });
    expect(credit.ret).toMatchObject({ counted: true, reason: "counted" });
    expect(s.physicsOf(strong).returnDays).toBe(1);
  });

  test("the day a publish drops it is still a showing day (ambiguous: an earlier session read the old bundle)", () => {
    const s = store();
    const first = warm(s, "Warm, and alone in the lane this morning.", 0.7);
    const me = self(s, { HINTS_MAX: 1 });
    expect(renderDay(me, 1)).toEqual([first]);
    warm(s, "Stronger, and minted later the same day.", 1.0);
    renderDay(me, 1);
    expect(s.wakeDisplays().get(first)).toMatchObject({ shown_day: 1, load: 1, closed_day: 1 });
    expect(s.shownInHints(first, 1)).toBe(true);
    expect(s.shownInHints(first, 2)).toBe(false);
  });

  test("build() composes without writing any shown history", () => {
    const s = store();
    warm(s, "The strongest warm thing in this store.", 0.95);
    self(s).build({ budgetBytes: BUDGET, day: 1 });
    expect(s.wakeDisplays().size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the loop, simulated over sixty lived days at the default lane size
// ---------------------------------------------------------------------------

describe("the rich-get-richer loop, simulated over 60 lived days", () => {
  test("one strong memory, used every time it is shown, does not hold the lane every day", () => {
    const s = store();
    const han = s.put({
      type: "memory",
      kind: "fact",
      body: "An emotional conversation that keeps coming back.",
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    // Fifteen ordinary warm memories — more than the lane holds (HINTS_MAX = 8).
    const others = Array.from({ length: 15 }, (_, i) =>
      warm(s, `An ordinary warm memory number ${i} with its own small weight.`, 0.9 - i * 0.02),
    );
    const me = self(s); // default tunables, HINTS_MAX 8
    const shownOn: number[] = [];
    const seen = new Set<string>();
    let lastStreak = 0;
    let streak = 0;
    for (let day = 1; day <= 60; day += 1) {
      const kept = renderDay(me, day);
      for (const id of kept) seen.add(id);
      if (kept.includes(han)) {
        shownOn.push(day);
        streak += 1;
        // The loop: on display, mentioned, credited.
        s.reinforce(han, day, "referenced");
      } else {
        lastStreak = Math.max(lastStreak, streak);
        streak = 0;
      }
    }
    lastStreak = Math.max(lastStreak, streak);
    // Not every day, and not every day late in the run either (#238's review:
    // the old loop was back every day by ~day 20).
    expect(shownOn.length).toBeLessThan(60);
    const late = shownOn.filter((d) => d > 40).length;
    expect(late).toBeLessThan(20);
    expect(lastStreak).toBeLessThan(10);
    // The rest of the warm shelf got its turn.
    for (const id of others.slice(0, 10)) expect(seen.has(id)).toBe(true);
    // Every one of its uses while shown was refused as a return.
    expect(s.physicsOf(han).returns).toBe(0);
  });
});
