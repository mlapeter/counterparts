/**
 * "Nearby, if it helps:" by context and habituation, not strength alone
 * (2026-09-25, the owner's "rich get richer").
 *
 * One strong memory held the hints lane nearly every session; the assistant then
 * mentioned it, which credited it, which kept it strongest. These tests pin the
 * two changes in `self/` that break the loop — a same-scope boost and a
 * shown-but-unused habituation — plus the durable row that says, per hint, why
 * it was chosen. The spacing half lives in `physics.test.ts`.
 *
 * Hermetic: every test opens a fresh temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import {
  HINTED_PREFIX,
  SELF_TUNABLES,
  Self,
  habituationOf,
  hintedOf,
  parseHintRecord,
} from "../src/core/self/index.js";
import type { SelfTunables } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET = 9_000;

let dir: string;
let priorEnv: string | undefined;
const closers: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-nearby-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function store(): Store {
  const s = Store.open({ dir });
  closers.push(s);
  return s;
}

/** A plain warm fact: salience is the mean of the three claimed dimensions. */
function warm(
  s: Store,
  body: string,
  relevance: number,
  origin?: { scope?: string; session?: string },
): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance, emotional: 0.8, predictive: 0.8 },
    physics: { birthDay: 0, lastUsedDay: 0 },
    ...(origin === undefined ? {} : { origin }),
  });
}

function self(s: Store, over: Partial<SelfTunables> = {}): Self {
  return new Self({ store: s, tunables: over });
}

/** One day's render, as the worker runs it; returns the KEPT hint ids. */
function renderDay(
  me: Self,
  day: number,
  here?: { scope?: string; session?: string },
): string[] {
  const out = me.boundary({ budgetBytes: BUDGET, day, ...(here === undefined ? {} : { here }) });
  return out.briefing.kept.hints;
}

// ---------------------------------------------------------------------------
// habituation — shown and not used loses pull, recovers over days, use resets
// ---------------------------------------------------------------------------

describe("habituation — a hint shown and not used loses some pull, then recovers", () => {
  const t = SELF_TUNABLES;

  test("the reading: fresh, one ignored showing, recovery, organic reset, a use on display", () => {
    expect(habituationOf(null, 0, 5, t)).toMatchObject({ habit: "fresh", habituation: 1 });

    // Kept on day 1, still open at day 2, never used: one full step, one day of recovery.
    const open = { day: 1, load: 0, closed: null };
    const ignored = habituationOf(open, 0, 2, t);
    expect(ignored.habit).toBe("habituated");
    expect(ignored.load).toBeCloseTo(Math.exp(-1 / t.HINT_RECOVERY_DAYS), 10);
    expect(ignored.habituation).toBeLessThan(1);

    // Used while on display: softened, not reset — the display may have prompted it.
    const usedOnDisplay = habituationOf(open, 1, 2, t);
    expect(usedOnDisplay.load).toBeCloseTo(t.HINT_USED_STEP * Math.exp(-1 / t.HINT_RECOVERY_DAYS), 10);
    expect(usedOnDisplay.habituation).toBeGreaterThan(ignored.habituation);
    expect(usedOnDisplay.habituation).toBeLessThan(1);

    // Dropped on day 2 (closed), not used: recovers with time and nothing else.
    const closed = { day: 1, load: 1, closed: 2 };
    const soon = habituationOf(closed, 0, 3, t).habituation;
    const later = habituationOf(closed, 0, 10, t).habituation;
    expect(later).toBeGreaterThan(soon);
    expect(later).toBeGreaterThan(0.9);

    // Used AFTER it left the wake: organic use resets it outright.
    expect(habituationOf(closed, 3, 4, t)).toMatchObject({ habit: "reset", load: 0, habituation: 1 });
    // A use on the very day it was dropped is ambiguous (the first session of
    // that day still read the old bundle), so it is not a reset.
    expect(habituationOf(closed, 2, 4, t).habit).toBe("habituated");
  });

  test("a record written by a render reads back as it was written", () => {
    expect(parseHintRecord("4:1.25:-")).toEqual({ day: 4, load: 1.25, closed: null });
    expect(parseHintRecord("4:1.25:6")).toEqual({ day: 4, load: 1.25, closed: 6 });
    expect(parseHintRecord("garbage")).toBeNull();
  });

  test("repeated shown-but-unused hints rotate out, then come back", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const next = warm(s, "A slightly less strong warm thing.", 0.75);
    const me = self(s, { HINTS_MAX: 1 });

    // Day 1: strength alone decides, as it always did.
    expect(renderDay(me, 1)).toEqual([strong]);
    // Day 2: the strong one was on display and nobody used it — it yields.
    expect(renderDay(me, 2)).toEqual([next]);
    // Day 3: now the other one carries the load, and the strong one has
    // recovered a day's worth — it is back. The lane ROTATES rather than
    // freezing on the strongest.
    expect(renderDay(me, 3)).toEqual([strong]);

    const records = hintedOf(s);
    expect(records.get(strong)).toMatchObject({ day: 3, closed: null });
    expect(records.get(next)).toMatchObject({ day: 2, closed: 3 });
  });

  test("a hint that rotated out recovers its pull over lived days without being shown", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const me = self(s, { HINTS_MAX: 1 });
    renderDay(me, 1);
    renderDay(me, 2);
    renderDay(me, 3);
    const tight = hintedOf(s).get(strong);
    expect(tight).toBeDefined();
    const reading = (day: number): number =>
      habituationOf(hintedOf(s).get(strong) ?? null, 0, day, SELF_TUNABLES).habituation;
    expect(reading(4)).toBeLessThan(0.6);
    expect(reading(12)).toBeGreaterThan(reading(6));
    expect(reading(20)).toBeGreaterThan(0.95);
  });

  test("using it after it left the wake resets it; a use while shown only softens", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const next = warm(s, "A slightly less strong warm thing.", 0.75);
    const me = self(s, { HINTS_MAX: 1 });
    renderDay(me, 1); // strong shown
    renderDay(me, 2); // strong dropped (closed at 2), next shown
    // Day 3, after the render that dropped it: a session reaches for it anyway.
    s.reinforce(strong, 3, "referenced");
    const reset = habituationOf(hintedOf(s).get(strong) ?? null, 3, 4, SELF_TUNABLES);
    expect(reset.habit).toBe("reset");
    expect(reset.habituation).toBe(1);
  });

  test("a same-day re-render is one showing, not two", () => {
    const s = store();
    const strong = warm(s, "The strongest warm thing in this store.", 0.95);
    const me = self(s, { HINTS_MAX: 1 });
    renderDay(me, 1);
    const first = s.getMeta(`${HINTED_PREFIX}${strong}`);
    renderDay(me, 1);
    expect(s.getMeta(`${HINTED_PREFIX}${strong}`)).toBe(first);
  });

  test("a hint first shown on the day it was minted is not read as used — birth is not a use", () => {
    const s = store();
    // Minted on day 3, never credited: lastUsedDay === birthDay === 3.
    const fresh = s.put({
      type: "memory",
      kind: "fact",
      body: "Something that landed today and went straight into the wake.",
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
      physics: { birthDay: 3, lastUsedDay: 3 },
    });
    const me = self(s, { HINTS_MAX: 1 });
    expect(renderDay(me, 3)).toEqual([fresh]);
    renderDay(me, 4);
    // A full ignored step, not the used-on-display half step.
    expect(hintedOf(s).get(fresh)?.load).toBeCloseTo(Math.exp(-1 / SELF_TUNABLES.HINT_RECOVERY_DAYS), 3);
  });

  test("a same-day re-render that drops a hint still counts that day's showing", () => {
    const s = store();
    const first = warm(s, "Warm, and alone in the lane this morning.", 0.7);
    const me = self(s, { HINTS_MAX: 1 });
    expect(renderDay(me, 1)).toEqual([first]);
    // Something stronger lands and the owner rebriefs the same lived day.
    warm(s, "Stronger, and minted later the same day.", 1.0);
    renderDay(me, 1);
    expect(hintedOf(s).get(first)).toEqual({ day: 1, load: 1, closed: 1 });
  });

  test("build() composes without writing any shown history", () => {
    const s = store();
    warm(s, "The strongest warm thing in this store.", 0.95);
    self(s).build({ budgetBytes: BUDGET, day: 1 });
    expect(hintedOf(s).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// context — same scope first, never a silo
// ---------------------------------------------------------------------------

describe("context — hints from the scope the render is for rank higher, not exclusively", () => {
  test("a same-scope memory outranks an equally strong one from elsewhere", () => {
    const s = store();
    const site = warm(s, "Something learned working on the site.", 0.8, { scope: "/work/site" });
    const home = warm(s, "Something learned in a personal chat.", 0.8, { scope: "/home" });
    const me = self(s, { HINTS_MAX: 1 });
    // `build` composes without writing shown history, so the two compositions
    // below see the same store and differ ONLY in where they are composed for.
    const composedFor = (scope: string): readonly string[] =>
      me.build({ budgetBytes: BUDGET, day: 1, here: { scope } }).kept.hints;
    expect(composedFor("/work/site")).toEqual([site]);
    expect(composedFor("/home")).toEqual([home]);
  });

  test("the last session here gets a further boost over the rest of its scope", () => {
    const s = store();
    const older = warm(s, "From an earlier session in this directory.", 0.8, {
      scope: "/work/site",
      session: "s-old",
    });
    const latest = warm(s, "From the session that just ended here.", 0.8, {
      scope: "/work/site",
      session: "s-new",
    });
    void older;
    expect(renderDay(self(s, { HINTS_MAX: 1 }), 1, { scope: "/work/site", session: "s-new" })).toEqual([
      latest,
    ]);
  });

  test("a strong memory from elsewhere still appears when nothing local competes", () => {
    const s = store();
    const elsewhere = warm(s, "A strong memory from another directory.", 0.9, { scope: "/home" });
    expect(renderDay(self(s), 1, { scope: "/work/site" })).toEqual([elsewhere]);
  });

  test("and it beats a WEAK local one — a nudge, not a silo", () => {
    const s = store();
    const strongElsewhere = warm(s, "A strong memory from another directory.", 1.0, { scope: "/home" });
    const weakLocal = warm(s, "A barely warm memory from here.", 0.0, { scope: "/work/site" });
    const kept = renderDay(self(s, { HINTS_MAX: 1 }), 1, { scope: "/work/site" });
    expect(kept).toEqual([strongElsewhere]);
    void weakLocal;
  });

  test("no scope named: no boost, strength order as before", () => {
    const s = store();
    const a = warm(s, "Stronger, from elsewhere.", 0.9, { scope: "/home" });
    warm(s, "Weaker, from the site.", 0.7, { scope: "/work/site" });
    expect(renderDay(self(s, { HINTS_MAX: 1 }), 1)).toEqual([a]);
  });
});

// ---------------------------------------------------------------------------
// the loop, simulated
// ---------------------------------------------------------------------------

describe("the rich-get-richer loop, simulated over ten daily renders", () => {
  test("one strong memory, used every time it is shown, does not monopolise the lane", () => {
    const s = store();
    const han = warm(s, "An emotional conversation that keeps coming back.", 1.0);
    const others = [0.75, 0.7, 0.7, 0.65, 0.6].map((r, i) =>
      warm(s, `An ordinary warm memory number ${i} with its own small weight.`, r),
    );
    const me = self(s, { HINTS_MAX: 2 });

    let hanShown = 0;
    const shown = new Set<string>();
    for (let day = 1; day <= 10; day += 1) {
      const kept = renderDay(me, day);
      for (const id of kept) shown.add(id);
      if (kept.includes(han)) {
        hanShown += 1;
        // The loop: it was on display, the session mentioned it, it was credited.
        s.reinforce(han, day, "referenced");
      }
    }
    // Under "strongest first" it held a slot all ten days. Now it yields often.
    // A regression pin at today's tunables (measured: 7 of 10) — move it when
    // the tunables move; the property is "not every day", not the number.
    expect(hanShown).toBeLessThanOrEqual(7);
    expect(hanShown).toBeGreaterThanOrEqual(3); // it is still a strong memory
    // And the rest of the warm shelf got its turn.
    for (const id of others) expect(shown.has(id)).toBe(true);
    // The spacing rule kept what those credits bought small: measured at these
    // defaults, 7 showings and 7 credited days came to ~1.26 uses, not 7.
    expect(s.physicsOf(han).uses).toBeLessThan(hanShown);
  });
});

// ---------------------------------------------------------------------------
// visibility — the durable row says why each hint was chosen
// ---------------------------------------------------------------------------

describe("the self.briefing row carries, per rendered hint, why it was chosen", () => {
  test("ids and numbers: context, boost, habituation", async () => {
    const c = Counterpart.open({ dir, owner: true });
    closers.push(c);
    const local = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Something learned working on the site, warm enough to hint.",
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 },
      origin: { scope: "/work/site", session: "s1" },
    });
    const away = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Something learned elsewhere, warm enough to hint.",
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 },
      origin: { scope: "/home", session: "s0" },
    });
    c.wake(BUDGET);
    await c.sessionEnd({
      date: "2026-01-02",
      budgetBytes: BUDGET,
      here: { scope: "/work/site", session: "s1" },
    });
    const rows = c.store
      .eventLog({ name: SELF_BRIEFING_EVENT, limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    const hints = rows[0]?.["hints"] as Record<string, unknown>[];
    expect(Array.isArray(hints)).toBe(true);
    const byId = new Map(hints.map((h) => [h["id"], h]));
    expect(byId.get(local)).toMatchObject({ context: "session", habit: "fresh", habituation: 1 });
    expect(Number(byId.get(local)?.["boost"])).toBeGreaterThan(1);
    expect(byId.get(away)).toMatchObject({ context: "elsewhere", boost: 1 });
    // The local one leads the lane.
    expect(hints[0]?.["id"]).toBe(local);
    // Numbers, never text.
    for (const h of hints) {
      for (const [k, v] of Object.entries(h)) {
        if (k === "id" || k === "context" || k === "habit") continue;
        expect(typeof v).toBe("number");
      }
    }
  });
});
