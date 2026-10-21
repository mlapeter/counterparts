/**
 * The self tab's "How I act" (2026-09-27, a try): the seven trait axes as
 * spectrum bars, each with a firmness-weighted balance and a faint week-ago
 * marker (`views/traits.ts`, `pages/self/sections/traits.js`). Hermetic: fresh
 * temp stores, removed after.
 *
 * The dashboard reads with the wall clock, so the store is written on today's
 * date and a nudge is backdated through `provenance.createdAt`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TRAIT_AXES } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { balanceOf, firmnessThen, mindView, traitsView } from "../src/adapters/dashboard/web/views.js";
import { strength } from "../src/core/physics/index.js";
import type { TraitAxisView, TraitsView } from "../src/adapters/dashboard/web/views.js";
// @ts-expect-error — a plain browser module, no declarations
import { EMPTY, countWords, leanWords, markerAt } from "../src/adapters/dashboard/web/pages/self/sections/traits.js";

const DAY = 86_400_000;
const SECRET = "the thing only he and I know about the lake house";
const dirs: string[] = [];
let at: string;
const ids: Record<string, string> = {};

function withSource<T>(dir: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function fresh(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const axis = (v: TraitsView, id: string): TraitAxisView => {
  const a = v.axes.find((x) => x.id === id);
  if (a === undefined) throw new Error("no axis " + id);
  return a;
};

beforeAll(() => {
  at = fresh("counterparts-self-traits-");
  Counterpart.open({ dir: at, identity: { name: "Mike" } }).close();
  const c = Counterpart.open({ dir: at });
  try {
    c.store.advanceClock(localDate(Date.now(), c.store.zone()));
    const d = c.store.livedDay();
    const put = (body: string, emotional: number, extra: Record<string, unknown> = {}): string =>
      c.store.put({
        type: "memory",
        kind: "self",
        body,
        about: "me",
        salience: { relevance: 0.6, emotional, predictive: 0.6 },
        physics: { birthDay: d, lastUsedDay: d },
        ...extra,
      });
    ids["firm"] = put("I shipped the risky refactor without asking first.", 0.95);
    ids["faint"] = put("I double-checked the migration before running it.", 0.1);
    ids["core"] = put("I tell him when I think he is wrong.", 0.5, { physics: { birthDay: d, lastUsedDay: d, promotedIdentity: true } });
    ids["secret"] = put("A private conversation, answered honestly.", 0.6, { meta: { confidential: true } });
    ids["old"] = put("I kept to the one task all afternoon.", 0.6);
    ids["new"] = put("I went down the rabbit hole on sqlite page sizes.", 0.6);
    ids["original"] = put("I made a joke about the build breaking again.", 0.6);
    ids["merged"] = put("I made a joke about the build breaking, twice now.", 0.6);

    // careful-bold: one toward each pole, on memories held differently.
    c.store.addTraits(ids["firm"] as string, [{ axis: "careful-bold", toward: "bold", strength: 1, carriedBy: "went ahead" }]);
    c.store.addTraits(ids["faint"] as string, [{ axis: "careful-bold", toward: "careful", strength: 1, carriedBy: "checked twice" }]);
    // agreeable-candid: a core memory, and a confidential one.
    c.store.addTraits(ids["core"] as string, [{ axis: "agreeable-candid", toward: "candid", strength: 0.5, carriedBy: "said so" }]);
    c.store.addTraits(ids["secret"] as string, [{ axis: "agreeable-candid", toward: "agreeable", strength: 0.8, carriedBy: SECRET }]);
    // focused-curious: one recorded ten days ago, one today.
    const tenDaysAgo = Date.now() - 10 * DAY;
    c.store.addTraits(
      ids["old"] as string,
      [{ axis: "focused-curious", toward: "focused", strength: 0.7, carriedBy: "stayed on it" }],
      { provenance: [{ createdAt: tenDaysAgo }] },
    );
    c.store.addTraits(ids["new"] as string, [{ axis: "focused-curious", toward: "curious", strength: 0.7, carriedBy: "wandered off" }]);
    // serious-playful: a merge carries the original's nudge onto the merged
    // memory with its own moment; the original is then superseded.
    c.store.addTraits(ids["original"] as string, [{ axis: "serious-playful", toward: "playful", strength: 0.6, carriedBy: "a joke" }]);
    c.store.addTraits(
      ids["merged"] as string,
      [{ axis: "serious-playful", toward: "playful", strength: 0.6, carriedBy: "a joke" }],
      { provenance: [{ source: "session", createdAt: Date.now() }] },
    );
    c.store.supersedeInto(ids["original"] as string, ids["merged"] as string, "merged");
  } finally {
    c.close();
  }
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("the balance, pure", () => {
  const poles = ["careful", "bold"] as const;

  test("signed −1 toward the first pole, +1 toward the second", () => {
    expect(balanceOf([{ toward: "bold", strength: 1, firmness: 1 }], poles)).toBe(1);
    expect(balanceOf([{ toward: "careful", strength: 0.4, firmness: 0.5 }], poles)).toBe(-1);
    expect(balanceOf([{ toward: "careful", strength: 1, firmness: 1 }, { toward: "bold", strength: 1, firmness: 1 }], poles)).toBe(0);
  });

  test("each nudge weighs strength × firmness: a faded memory pulls less", () => {
    // (1·1 − 1·0.25) / (1·1 + 1·0.25) = 0.6
    expect(balanceOf([{ toward: "bold", strength: 1, firmness: 1 }, { toward: "careful", strength: 1, firmness: 0.25 }], poles)).toBe(0.6);
    // (0.5·1 − 1·0.5) / 1 = 0
    expect(balanceOf([{ toward: "bold", strength: 0.5, firmness: 1 }, { toward: "careful", strength: 1, firmness: 0.5 }], poles)).toBe(0);
  });

  test("nothing weighing anything is null (no marker), never NaN or a centred 0", () => {
    expect(balanceOf([], poles)).toBeNull();
    expect(balanceOf([{ toward: "bold", strength: 1, firmness: 0 }], poles)).toBeNull();
    expect(balanceOf([{ toward: "careful", strength: 0, firmness: 1 }], poles)).toBeNull();
    // A pole from another axis is not counted.
    expect(balanceOf([{ toward: "playful", strength: 1, firmness: 1 }], poles)).toBeNull();
  });
});

describe("the view, on a store", () => {
  test("every axis, in TRAIT_AXES order, with its poles and gloss", () => {
    const v = withSource(at, (src) => traitsView(src));
    expect(v.axes.map((a) => a.id)).toEqual(TRAIT_AXES.map((a) => a.id));
    expect(axis(v, "guarded-open").gloss).toBe("about my inner life");
    expect(axis(v, "careful-bold").poles).toEqual(["careful", "bold"]);
  });

  test("careful-bold: weighted by firmness, and the firmer memory wins", () => {
    const v = withSource(at, (src) => traitsView(src));
    const a = axis(v, "careful-bold");
    expect(a.memories).toBe(2);
    expect(a.nudges).toBe(2);
    const firm = a.rows.find((r) => r.id === ids["firm"]);
    const faint = a.rows.find((r) => r.id === ids["faint"]);
    expect(firm?.firmness).toBeGreaterThan(faint?.firmness as number);
    const f1 = firm?.firmness as number;
    const f2 = faint?.firmness as number;
    expect(a.balance).toBeCloseTo((f1 - f2) / (f1 + f2), 2);
    expect(a.balance as number).toBeGreaterThan(0);
    // The weightiest first.
    expect(a.rows[0]?.id).toBe(ids["firm"]);
    expect(a.rows[0]?.carriedBy).toBe("went ahead");
  });

  test("a core memory counts fully", () => {
    const v = withSource(at, (src) => traitsView(src));
    const core = axis(v, "agreeable-candid").rows.find((r) => r.id === ids["core"]);
    expect(core?.firmness).toBe(1);
  });

  test("a nudge on a memory carrying the retired confidential key moves the bar and shows its words (2026-10-21)", () => {
    const v = withSource(at, (src) => mindView(src));
    const a = axis(v.traits, "agreeable-candid");
    expect(a.memories).toBe(2);
    const secret = a.rows.find((r) => r.id === ids["secret"]);
    expect(secret).toMatchObject({ toward: "agreeable" });
    expect(secret?.carriedBy).not.toBe("");
    // It pulls toward "agreeable": the balance is not what the core one alone gives (+1).
    expect(a.balance as number).toBeLessThan(1);
  });

  test("a merged original and its merge are counted once", () => {
    const v = withSource(at, (src) => traitsView(src));
    const a = axis(v, "serious-playful");
    expect(a.memories).toBe(1);
    expect(a.nudges).toBe(1);
    expect(a.rows.map((r) => r.id)).toEqual([ids["merged"] as string]);
    expect(a.balance).toBe(1);
  });

  test("an axis with no nudges: no marker, no week-ago marker, no rows", () => {
    const v = withSource(at, (src) => traitsView(src));
    for (const id of ["guarded-open", "following-initiating", "inward-outward"]) {
      expect(axis(v, id)).toMatchObject({ balance: null, weekAgo: null, memories: 0, nudges: 0, rows: [], more: 0 });
    }
    expect(v.memories).toBe(7);
    expect(v.nudges).toBe(7);
  });

  test("a week ago: only the nudges recorded seven or more calendar days back", () => {
    const v = withSource(at, (src) => traitsView(src));
    const a = axis(v, "focused-curious");
    // Now: one each way, on equally held memories.
    expect(a.balance as number).toBeCloseTo(0, 1);
    // Then: only the old one, toward "focused".
    expect(a.weekAgo).toBe(-1);
    // Axes whose nudges are all newer than a week have no faint marker.
    expect(axis(v, "careful-bold").weekAgo).toBeNull();
    expect(axis(v, "serious-playful").weekAgo).toBeNull();
  });

  test("a store no trait was ever written on reads as the calm empty state", () => {
    const dir = fresh("counterparts-self-traits-empty-");
    Counterpart.open({ dir }).close();
    const v = withSource(dir, (src) => traitsView(src));
    expect(v.nudges).toBe(0);
    expect(v.memories).toBe(0);
    expect(v.axes.every((a) => a.balance === null && a.weekAgo === null)).toBe(true);
    expect(EMPTY).toBe("No memory carries a trait yet. They're recorded as memories are written.");
  });
});

describe("a week ago: firmness then, and memories that have left since", () => {
  // A store ten lived days old, one active day per calendar day, so seven
  // lived days back is a day these memories had lived through.
  let wk: string;
  let d = 0;
  const w: Record<string, string> = {};
  const OLD = (): number => Date.now() - 10 * DAY;

  beforeAll(() => {
    wk = fresh("counterparts-self-traits-week-");
    Counterpart.open({ dir: wk, identity: { name: "Mike" } }).close();
    // An archive BEFORE the week-ago date needs the store's clock back then.
    const past = Counterpart.open({ dir: wk, now: () => Date.now() - 9 * DAY });
    try {
      for (let k = 10; k >= 9; k--) past.store.advanceClock(localDate(Date.now() - k * DAY, past.store.zone()));
      w["gone-long"] = past.store.put({
        type: "memory", kind: "self", body: "I chased a tangent about fonts.", about: "me",
        salience: { relevance: 0.6, emotional: 0.4, predictive: 0.6 },
        physics: { birthDay: 1, lastUsedDay: 1 },
      });
      past.store.addTraits(w["gone-long"] as string, [{ axis: "focused-curious", toward: "curious", strength: 1, carriedBy: "fonts" }], {
        provenance: [{ createdAt: OLD() }],
      });
      past.store.archive(w["gone-long"] as string, "pruned");
    } finally {
      past.close();
    }
    const c = Counterpart.open({ dir: wk });
    try {
      for (let k = 8; k >= 0; k--) c.store.advanceClock(localDate(Date.now() - k * DAY, c.store.zone()));
      d = c.store.livedDay();
      const put = (body: string, emotional: number): string =>
        c.store.put({
          type: "memory", kind: "self", body, about: "me",
          salience: { relevance: 0.6, emotional, predictive: 0.6 },
          physics: { birthDay: 2, lastUsedDay: 2 },
        });
      const nudge = (id: string, axisId: string, toward: string, strength: number): void => {
        c.store.addTraits(id, [{ axis: axisId, toward, strength, carriedBy: toward }], { provenance: [{ createdAt: OLD() }] });
      };
      // careful-bold: A fading untouched since day 2; B made core TODAY.
      w["A"] = put("I checked the backups twice before the upgrade.", 0.3);
      w["B"] = put("I pushed the fix without waiting for review.", 0.8);
      nudge(w["A"] as string, "careful-bold", "careful", 1);
      nudge(w["B"] as string, "careful-bold", "bold", 1);
      c.store.updatePhysics(w["B"] as string, { promotedIdentity: true });
      c.store.appendCoreEvent({ memoryId: w["B"] as string, action: "promoted", day: d, lane: "fast" });
      // focused-curious: C live; D archived today; `gone-long` archived nine days ago.
      w["C"] = put("I stayed on the migration all day.", 0.5);
      w["D"] = put("I wandered into the sqlite docs.", 0.5);
      nudge(w["C"] as string, "focused-curious", "focused", 1);
      nudge(w["D"] as string, "focused-curious", "curious", 1);
      c.store.archive(w["D"] as string, "pruned");
      // serious-playful: E live; F merged into G today, G carrying F's nudge with its moment.
      w["E"] = put("I kept the release notes plain.", 0.5);
      w["F"] = put("I joked about the flaky test.", 0.5);
      nudge(w["E"] as string, "serious-playful", "serious", 0.6);
      const at = OLD();
      c.store.addTraits(w["F"] as string, [{ axis: "serious-playful", toward: "playful", strength: 0.6, carriedBy: "a joke" }], {
        provenance: [{ createdAt: at }],
      });
      w["G"] = c.store.put({
        type: "memory", kind: "self", body: "I joke about the flaky test, every time.", about: "me",
        salience: { relevance: 0.6, emotional: 0.5, predictive: 0.6 },
        physics: { birthDay: d, lastUsedDay: d },
      });
      c.store.addTraits(w["G"] as string, [{ axis: "serious-playful", toward: "playful", strength: 0.6, carriedBy: "a joke" }], {
        provenance: [{ createdAt: at }],
      });
      c.store.supersedeInto(w["F"] as string, w["G"] as string, "merged");
      // guarded-open: T records the same nudge twice in one write (one
      // moment); U pulls the other way at twice the strength.
      w["T"] = put("I told him how the week had felt.", 0.5);
      w["U"] = put("I kept my worry to myself.", 0.5);
      c.store.addTraits(w["T"] as string, [
        { axis: "guarded-open", toward: "open", strength: 0.5, carriedBy: "said it" },
        { axis: "guarded-open", toward: "open", strength: 0.5, carriedBy: "said it" },
      ], { provenance: [{ createdAt: at }, { createdAt: at }] });
      nudge(w["U"] as string, "guarded-open", "guarded", 1);
    } finally {
      c.close();
    }
  });

  test("firmness then: a memory left alone had faded less; a core memory promoted since was not core", () => {
    withSource(wk, (src) => {
      const s = src.store;
      const then = d - 7;
      const a = s.physicsOf(w["A"] as string);
      expect(firmnessThen(s, w["A"] as string, then, Date.now() - 7 * DAY)).toBeCloseTo(strength(a, then), 6);
      expect(strength(a, then)).toBeGreaterThan(strength(a, d));
      const b = s.physicsOf(w["B"] as string);
      const bThen = firmnessThen(s, w["B"] as string, then, Date.now() - 7 * DAY);
      expect(bThen).toBeCloseTo(strength({ ...b, promotedIdentity: false }, then), 6);
      expect(bThen).toBeLessThan(1);
      // On or after the promotion's day it was core.
      expect(firmnessThen(s, w["B"] as string, d, Date.now())).toBe(1);
    });
  });

  test("the faint marker weighs each memory as it was held then, not today", () => {
    withSource(wk, (src) => {
      const s = src.store;
      const a = axis(traitsView(src), "careful-bold");
      const fA = strength(s.physicsOf(w["A"] as string), d - 7);
      const fB = strength({ ...s.physicsOf(w["B"] as string), promotedIdentity: false }, d - 7);
      expect(a.weekAgo as number).toBeCloseTo((fB - fA) / (fA + fB), 2);
      // Today's firmness would give a different answer (B counts 1 now).
      const fAToday = strength(s.physicsOf(w["A"] as string), d);
      const todays = (1 - fAToday) / (1 + fAToday);
      expect(Math.abs((a.weekAgo as number) - todays)).toBeGreaterThan(0.05);
      expect(a.balance as number).toBeCloseTo(todays, 2);
    });
  });

  test("a memory archived since last week counts a week ago, not today", () => {
    const v = withSource(wk, (src) => traitsView(src));
    const a = axis(v, "focused-curious");
    // Today: only C, toward "focused".
    expect(a.balance).toBe(-1);
    expect(a.memories).toBe(1);
    expect(a.rows.map((r) => r.id)).toEqual([w["C"] as string]);
    // A week ago: C and D, held alike, one each way; the one archived nine
    // days ago had already left and does not count.
    expect(a.weekAgo as number).toBeCloseTo(0, 2);
  });

  test("a merge since last week: the carried nudge counts once a week ago", () => {
    const v = withSource(wk, (src) => traitsView(src));
    const a = axis(v, "serious-playful");
    // Today: E and the merged G.
    expect(a.rows.map((r) => r.id).sort()).toEqual([w["E"] as string, w["G"] as string].sort());
    // A week ago: E and F (the original, born then), held alike, one each
    // way; counting G's copy too would pull it toward "playful".
    expect(a.weekAgo as number).toBeCloseTo(0, 2);
  });

  test("the same nudge twice on ONE memory is two nudges a week ago, as it is today", () => {
    const v = withSource(wk, (src) => traitsView(src));
    const a = axis(v, "guarded-open");
    expect(a.nudges).toBe(3);
    expect(a.balance as number).toBeCloseTo(0, 2);
    expect(a.weekAgo as number).toBeCloseTo(0, 2);
  });
});

describe("the bars, as the page draws them", () => {
  test("a balance is a place on the track; null draws nothing", () => {
    expect(markerAt(-1)).toBe(0);
    expect(markerAt(0)).toBe(50);
    expect(markerAt(1)).toBe(100);
    expect(markerAt(0.5)).toBe(75);
    expect(markerAt(null)).toBeNull();
    expect(markerAt(Number.NaN)).toBeNull();
  });

  test("the count and the row in words", () => {
    expect(countWords(0)).toBe("none yet");
    expect(countWords(1)).toBe("1 memory");
    expect(countWords(4)).toBe("4 memories");
    const a = { poles: ["careful", "bold"], balance: 0.7, weekAgo: -0.4, memories: 4 };
    expect(leanWords(a)).toBe("careful to bold: strongly bold (4 memories); a week ago toward careful");
    expect(leanWords({ ...a, balance: 0.05, weekAgo: null })).toBe("careful to bold: about even (4 memories)");
    expect(leanWords({ ...a, balance: null, weekAgo: null, memories: 0 })).toBe("careful to bold: no memory carries it yet");
    // Every memory behind it a week ago has left since: the faint mark stands alone.
    expect(leanWords({ ...a, balance: null, memories: 0 })).toBe(
      "careful to bold: no memory carries it yet; a week ago toward careful",
    );
  });
});
