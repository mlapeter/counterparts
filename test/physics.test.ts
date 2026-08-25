/**
 * `physics/` — the guarantee suite (CONTRACT.md §5.9) plus the named regressions.
 *
 * Physics is pure, so these tests need no data dir: there is nothing to make
 * hermetic. The only file access here is the test READING the physics sources to
 * assert what they may import and what they may touch (guarantees 1 and 6).
 *
 * House rule (the tests-lie scar): assert the REASON, not just the outcome. A
 * verdict that comes back right for the wrong reason is a test that lies.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as physics from "../src/core/physics/index.js";
import {
  applyChallenge,
  band,
  bandMove,
  base,
  challengeForce,
  clamp01,
  clampSalienceAtSeam,
  computedSal,
  cosine,
  creditUse,
  dayKey,
  decay,
  decayCurve,
  dedupVerdict,
  isBlindEncoding,
  kindPhysics,
  livedDay,
  livedDaysBetween,
  novelty,
  pressureAt,
  promote,
  promotionEligibility,
  pruneVerdict,
  rep,
  revisionBar,
  sal,
  stability,
  strength,
  successorSeed,
  supersedeRecord,
  supersededResolvable,
  symmetryCheck,
  TUNABLES,
  type Challenge,
} from "../src/core/physics/index.js";
import type { Kind, MemoryPhysics, Salience } from "../src/core/types.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const ALL_KINDS: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];

/** Flat salience: every dimension at `n` (novelty too, unless overridden). */
function S(n: number, novelty: number | null = n): Salience {
  return { novelty, relevance: n, emotional: n, predictive: n };
}

function mem(p: Partial<MemoryPhysics> & { kind: Kind }): MemoryPhysics {
  return {
    salience: S(0.5),
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

function challenge(id: string, target: string, salience: number, day: number, kind: Kind): Challenge {
  return {
    id,
    declaredUpdates: target,
    physics: mem({ kind, salience: S(salience), birthDay: day, lastUsedDay: day }),
  };
}

function src(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/core/physics/${file}`, import.meta.url)), "utf8");
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] as string);
}

// ---------------------------------------------------------------------------
// §5.9 guarantee 1 — no I/O, no model calls, no forbidden imports
// ---------------------------------------------------------------------------

describe("[M] guarantee 1 — physics makes no model calls and performs no I/O", () => {
  const ALLOWED: Record<string, string[]> = {
    "index.ts": ["../types.js", "./clock.js"],
    "clock.ts": [],
  };

  test("imports nothing but ../types.js and its own clock", () => {
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      for (const spec of importSpecifiers(src(file))) {
        expect(`${file}: ${spec}`).toBe(`${file}: ${allowed.find((a) => a === spec) ?? "FORBIDDEN"}`);
      }
    }
  });

  test("names no store/, encode/, client, or runtime-I/O surface", () => {
    for (const file of Object.keys(ALLOWED)) {
      const text = src(file);
      for (const forbidden of [
        /from\s+["'][^"']*store\//,
        /from\s+["'][^"']*encode\//,
        /\brequire\s*\(/,
        /\bawait\s+import\s*\(/,
        /\bfetch\s*\(/,
        /\bprocess\.(env|cwd|argv)/,
        /\bnode:fs\b/,
        /\bnode:sqlite\b/,
        /\banthropic\b/i,
      ]) {
        expect(`${file}:${forbidden.source}:${forbidden.test(text)}`).toBe(
          `${file}:${forbidden.source}:false`,
        );
      }
    }
  });

  test("exports no removal verb — physics returns verdicts, never deletes", () => {
    const offenders = Object.keys(physics).filter((n) => /delete|remove|erase|unlink|drop/i.test(n));
    expect(offenders).toEqual([]);
  });

  test("every exported function leaves a frozen memory untouched", () => {
    const day = 40;
    const m = Object.freeze(mem({ kind: "entity", salience: Object.freeze(S(0.6)), uses: 4, lastUsedDay: 10 }));
    const snapshot = JSON.stringify(m);
    const ch: Challenge = Object.freeze(challenge("c1", "t1", 0.6, day, "entity"));
    expect(() => {
      base(m);
      strength(m, day);
      band(m, day);
      decay(m, day);
      stability(m);
      rep(m);
      sal(m.salience);
      creditUse(m, day, "referenced");
      applyChallenge("t1", m, ch, day);
      promote(m, day);
      promotionEligibility(m);
      pruneVerdict(m, day, { inLiveRevisionChain: false });
      successorSeed(m);
      challengeForce(m, day);
      pressureAt(m, day);
      revisionBar(m, day);
    }).not.toThrow();
    expect(JSON.stringify(m)).toBe(snapshot);
  });

  test("state-changing operations return next state instead of mutating", () => {
    const m = mem({ kind: "fact", birthDay: 0, lastUsedDay: 0 });
    const out = creditUse(m, 3, "referenced");
    expect(out.next.uses).toBe(1);
    expect(m.uses).toBe(0); // the input is untouched
  });
});

// ---------------------------------------------------------------------------
// §5.1 salience
// ---------------------------------------------------------------------------

describe("[M] guarantee 2 — salience is fixed at birth; a claim is a floor with an event", () => {
  test("sal is the mean of four dimensions [v0 verbatim]", () => {
    expect(sal({ novelty: 0.2, relevance: 0.4, emotional: 0.6, predictive: 0.8 })).toBeCloseTo(0.5, 10);
  });

  test("a claim above the computed mean lifts, and emits the lift event", () => {
    const clamped = clampSalienceAtSeam(S(0.4), 0.8);
    expect(clamped.lifted).toBe(true);
    expect(clamped.event).toEqual({
      event: "salience.lifted",
      computed: 0.4,
      claimed: 0.8,
      applied: 0.8,
    });
    expect(sal(clamped.salience)).toBeCloseTo(0.8, 10);
    // the dimensions themselves are NOT rewritten — salience stays as authored
    expect(clamped.salience.novelty).toBe(0.4);
    expect(computedSal(clamped.salience)).toBeCloseTo(0.4, 10);
  });

  test("a claim below the computed mean is inert and emits nothing", () => {
    const clamped = clampSalienceAtSeam(S(0.6), 0.2);
    expect(clamped.lifted).toBe(false);
    expect(clamped.event).toBeNull();
    expect(sal(clamped.salience)).toBeCloseTo(0.6, 10);
  });

  test("salience does not move with use or with the clock", () => {
    const m = mem({ kind: "fact", salience: S(0.5) });
    const before = sal(m.salience);
    const after = creditUse(m, 5, "referenced");
    expect(sal({ ...m.salience })).toBe(before);
    expect(after.next.uses).toBeGreaterThan(m.uses);
  });

  test("novelty is prediction error against supplied vectors; physics fetches none", () => {
    expect(novelty([1, 0], [[1, 0]])).toBeCloseTo(0, 10); // identical -> no surprise
    expect(novelty([1, 0], [[0, 1]])).toBeCloseTo(1, 10); // orthogonal -> full surprise
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 10);
  });
});

describe("regression 7 — null novelty is specified, never defaulted", () => {
  const blind: Salience = { novelty: null, relevance: 0.6, emotional: 0.3, predictive: 0.9 };

  test("a blind write scores the mean of the THREE author-supplied dimensions", () => {
    expect(sal(blind)).toBeCloseTo(0.6, 10);
  });

  test("that is not the mean-of-four with novelty defaulted either way", () => {
    expect(sal({ ...blind, novelty: 0 })).toBeCloseTo(0.45, 10);
    expect(sal({ ...blind, novelty: 1 })).toBeCloseTo(0.7, 10);
    expect(sal(blind)).not.toBeCloseTo(0.45, 3);
    expect(sal(blind)).not.toBeCloseTo(0.7, 3);
  });

  test("blindness is RECORDED and countable, and survives the seam", () => {
    expect(novelty([1, 0], [])).toBeNull(); // E(m) empty -> null, not a number
    expect(isBlindEncoding(blind)).toBe(true);
    const clamped = clampSalienceAtSeam(blind, 0.9);
    expect(clamped.blind).toBe(true);
    expect(clamped.salience.novelty).toBeNull(); // a lift never fills in novelty
    expect(clamped.lifted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.2 strength
// ---------------------------------------------------------------------------

describe("[M] guarantee 3 — base is monotone non-decreasing", () => {
  test("base only ever rises as uses accumulate, for every kind", () => {
    for (const kind of ALL_KINDS) {
      let m = mem({ kind, salience: S(0.3) });
      let prev = base(m);
      for (let d = 1; d <= 12; d++) {
        const out = creditUse(m, d, "referenced");
        m = { ...m, ...out.next };
        const now = base(m);
        expect(`${kind}@${d}:${now >= prev}`).toBe(`${kind}@${d}:true`);
        prev = now;
      }
    }
  });

  test("consolidation only adds", () => {
    const m = mem({ kind: "fact", salience: S(0.4) });
    expect(base({ ...m, consolidated: true }) - base(m)).toBeCloseTo(TUNABLES.CONS_BONUS, 10);
  });

  test("reinforcement re-lifts what decay eroded", () => {
    const m = mem({ kind: "fact", salience: S(0.6), uses: 1, lastUsedDay: 0 });
    const faded = strength(m, 120);
    expect(faded).toBeLessThan(strength(m, 0));
    const out = creditUse(m, 120, "referenced");
    expect(out.credited).toBe(true);
    const revived = strength({ ...m, ...out.next }, 120);
    expect(revived).toBeGreaterThan(faded);
    expect(revived).toBeCloseTo(base({ ...m, ...out.next }), 10); // curve reset
  });

  test("base is a MAX of the two arms, never a product — the one-shot consolidates", () => {
    const oneShot = mem({ kind: "entity", salience: S(0.9), uses: 0 });
    expect(base(oneShot)).toBeCloseTo(0.9, 10);
    const k = kindPhysics("entity");
    expect(base(oneShot)).not.toBeCloseTo(k.wSal * 0.9 * (k.wRep * rep(oneShot)), 3);
  });
});

describe("[M] guarantee 4 — repetition never reaches the identity band", () => {
  test("the repetition arm tops out at 0.70 for every kind — arithmetic, not a check", () => {
    for (const kind of ALL_KINDS) {
      const saturated = mem({ kind, salience: S(0), uses: 10_000, consolidated: true });
      const b = base(saturated);
      expect(`${kind}:${b <= TUNABLES.REP_CAP + TUNABLES.CONS_BONUS}`).toBe(`${kind}:true`);
      expect(`${kind}:${b < TUNABLES.THETA_ID}`).toBe(`${kind}:true`);
      expect(promotionEligibility({ ...saturated, reinforcedDays: 500 }).reason).toBe(
        "base-below-identity-threshold",
      );
    }
  });

  test("the cap itself is what does it", () => {
    expect(TUNABLES.REP_CAP + TUNABLES.CONS_BONUS).toBeCloseTo(0.7, 10);
    expect(TUNABLES.REP_CAP + TUNABLES.CONS_BONUS).toBeLessThan(TUNABLES.THETA_ID);
  });
});

describe("regression 4 — repetition alone never promotes", () => {
  test("100 lived days of low-salience use leaves base below the identity floor", () => {
    const drilled = mem({
      kind: "skill",
      salience: S(0.2),
      uses: 100,
      consolidated: true,
      reinforcedDays: 100,
      lastUsedDay: 100,
    });
    expect(base(drilled)).toBeCloseTo(0.7, 10);
    const verdict = promotionEligibility(drilled);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("base-below-identity-threshold");
    // the DAY gate is satisfied — it is the strength gate that refuses
    expect(verdict.blockedBy).toEqual(["base-below-identity-threshold"]);
    expect(promote(drilled, 100).crossing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §5.4 decay
// ---------------------------------------------------------------------------

describe("[M] guarantee 5 — exactly-once decay, by being a pure function of the clock", () => {
  test("D is repeatable and order-independent — there is no step to run twice", () => {
    const m = mem({ kind: "person", salience: S(0.7), uses: 2, lastUsedDay: 10 });
    const at50 = strength(m, 50);
    strength(m, 900);
    strength(m, 12);
    expect(strength(m, 50)).toBe(at50);
    expect(decay(m, 50)).toBe(decay(m, 50));
  });

  test("no exported decay STEP exists to be run twice", () => {
    const offenders = Object.keys(physics).filter((n) => /^(applyDecay|decayTick|tick|materialize)/.test(n));
    expect(offenders).toEqual([]);
  });

  test("kappa divides: a fact erodes fastest, a skill slowest", () => {
    // compared on D alone: the omega weights are a different lever (§5.2)
    const at = (kind: Kind) => decay(mem({ kind, salience: S(0.8), uses: 1, lastUsedDay: 0 }), 60);
    expect(at("fact")).toBeLessThan(at("entity"));
    expect(at("entity")).toBeLessThan(at("skill"));
    expect(kindPhysics("fact").kappa).toBeGreaterThan(kindPhysics("skill").kappa);
  });

  test("uses raise stability logarithmically — slower, never immortal", () => {
    const s0 = stability({ kind: "fact", uses: 0 });
    const s5 = stability({ kind: "fact", uses: 5 });
    const s50 = stability({ kind: "fact", uses: 50 });
    expect(s5).toBeGreaterThan(s0);
    expect(s50 - s5).toBeLessThan(s5 - s0 + (s5 - s0)); // sub-linear growth
    expect(Number.isFinite(s50)).toBe(true);
  });

  test("all three decay shapes are D(0)=1 and monotone (open question 1 is replay's to settle)", () => {
    for (const shape of ["exponential", "flat", "power-law"] as const) {
      expect(`${shape}:${decayCurve(0, 60, shape)}`).toBe(`${shape}:1`);
      let prev = 1;
      for (const dt of [1, 5, 20, 60, 200]) {
        const now = decayCurve(dt, 60, shape);
        expect(`${shape}@${dt}:${now <= prev}`).toBe(`${shape}@${dt}:true`);
        prev = now;
      }
    }
    expect(decayCurve(60, 60, "flat")).toBeLessThan(decayCurve(60, 60, "exponential"));
    expect(decayCurve(60, 60, "exponential")).toBeLessThan(decayCurve(60, 60, "power-law"));
    expect(TUNABLES.DECAY_SHAPE).toBe("exponential"); // the contract's default
  });
});

describe("[M] guarantee 6 — one lived-day function, and every site routes through it", () => {
  test("the day rolls at the LOCAL boundary hour, not at UTC midnight", () => {
    expect(dayKey(new Date(2026, 7, 25, 3, 30))).toBe("2026-08-24"); // 03:30 is still last night
    expect(dayKey(new Date(2026, 7, 25, 4, 0))).toBe("2026-08-25");
    expect(dayKey(new Date(2026, 7, 25, 23, 59))).toBe("2026-08-25");
    expect(dayKey(new Date(2026, 7, 25, 3, 30), 0)).toBe("2026-08-25"); // boundary is TUNABLE
    expect(TUNABLES.BOUNDARY_HOUR).toBe(4);
  });

  test("lived days count days ACTUALLY lived — a week away decays one interval, not seven", () => {
    const lived = ["2026-08-01", "2026-08-02", "2026-08-02", "2026-08-10"];
    expect(livedDay(lived, "2026-08-01")).toBe(0);
    expect(livedDay(lived, "2026-08-02")).toBe(1);
    expect(livedDay(lived, "2026-08-10")).toBe(2);
    expect(livedDay(lived, "2026-08-11")).toBe(3);
    expect(livedDaysBetween(lived, "2026-08-02", "2026-08-10")).toBe(1);
  });

  test("totality: only clock.ts touches Date — no other physics site has its own clock", () => {
    expect(/\bDate\b/.test(src("index.ts"))).toBe(false);
    expect(/\bDate\b/.test(src("clock.ts"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.3 bands and promotion
// ---------------------------------------------------------------------------

describe("§5.3 bands", () => {
  test("semantic membership is evaluated on DECAYED strength", () => {
    const m = mem({ kind: "fact", salience: S(0.6), uses: 1, lastUsedDay: 0 });
    expect(band(m, 0)).toBe("semantic");
    expect(band(m, 200)).toBe("episodic");
    expect(TUNABLES.THETA_SEM).toBe(0.5);
  });
});

describe("regression 3 — nothing is born into identity", () => {
  const born = mem({
    kind: "self",
    salience: { ...S(1), claimed: 1 },
    birthDay: 0,
    lastUsedDay: 0,
    uses: 0,
  });

  test("a birth write claiming salience 1.0 lands at band <= semantic", () => {
    expect(sal(born.salience)).toBeCloseTo(1, 10);
    expect(strength(born, 0)).toBeCloseTo(1, 10);
    expect(band(born, 0)).toBe("semantic");
    expect(band(born, 0)).not.toBe("identity");
  });

  test("promotion refuses on the distinct-day gate, not on strength", () => {
    const verdict = promotionEligibility(born);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("insufficient-distinct-days");
    expect(verdict.blockedBy).toEqual(["insufficient-distinct-days"]);
    expect(verdict.requiredDays).toBe(3);
    const outcome = promote(born, 0);
    expect(outcome.promoted).toBe(false);
    expect(outcome.crossing).toBeNull();
    expect(outcome.next).toBeNull();
  });

  test("and the birth day itself cannot be one of the three", () => {
    expect(creditUse(born, 0, "referenced").reason).toBe("birth-day");
  });

  test("three distinct lived days later, promotion is an explicit counted crossing", () => {
    let m = born;
    for (const d of [1, 2, 3]) {
      const out = creditUse(m, d, "referenced");
      expect(`${d}:${out.reason}`).toBe(`${d}:credited`);
      m = { ...m, ...out.next };
    }
    const outcome = promote(m, 3);
    expect(outcome.verdict.eligible).toBe(true);
    expect(outcome.crossing).toMatchObject({ event: "band.promoted", day: 3, kind: "self", reinforcedDays: 3 });
    expect(outcome.next).toEqual({ promotedIdentity: true });
    expect(band({ ...m, ...outcome.next }, 3)).toBe("identity");
  });

  test("two days is not three — the gate is distinct days, not uses", () => {
    let m = born;
    for (const d of [1, 2]) m = { ...m, ...creditUse(m, d, "referenced").next };
    // hammering day 2 again does not buy a third day
    expect(creditUse(m, 2, "referenced").reason).toBe("already-credited-today");
    expect(promotionEligibility(m).reason).toBe("insufficient-distinct-days");
  });
});

describe("regression 6 — identity is sticky but revisable", () => {
  const anchor = mem({
    kind: "self",
    salience: S(0.95),
    uses: 4,
    reinforcedDays: 4,
    lastUsedDay: 200,
    promotedIdentity: true,
  });

  test("identity is decay-exempt: D = 1 forever (the named deviation of §2)", () => {
    expect(decay(anchor, 200)).toBe(1);
    expect(decay(anchor, 200 + 10_000)).toBe(1);
    expect(strength(anchor, 10_000)).toBeCloseTo(strength(anchor, 200), 10);
    expect(band(anchor, 10_000)).toBe("identity");
  });

  test("it cannot fade out — prune refuses on the band gate", () => {
    const verdict = pruneVerdict(anchor, 20_000, { inLiveRevisionChain: false });
    expect(verdict.prune).toBe(false);
    expect(verdict.blockedBy).toContain("band-not-episodic");
    expect(verdict.blockedBy).toContain("above-floor");
  });

  test("but sustained declared challenge still crosses — summation resolves the ceiling", () => {
    let m = anchor;
    let day = 200;
    let crossed = 0;
    for (let i = 1; i <= 5; i++) {
      day = 200 + i;
      const out = applyChallenge("anchor", m, challenge(`c${i}`, "anchor", 0.7, day, "self"), day);
      expect(`${i}:credited=${out.credited}`).toBe(`${i}:credited=true`);
      m = { ...m, ...out.next };
      if (out.verdict === "revise") {
        crossed = i;
        break;
      }
      expect(`${i}:${out.reason}`).toBe(`${i}:below-bar`);
    }
    expect(crossed).toBeGreaterThan(0);
    expect(crossed).toBeLessThanOrEqual(3);
  });

  test("revision is the exit: the successor inherits identity unless demoted on purpose", () => {
    expect(successorSeed(anchor)).toEqual({
      promotedIdentity: true,
      pressure: 0,
      lastChallengedDay: null,
    });
    expect(successorSeed(anchor, { inheritIdentity: false }).promotedIdentity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5.5 reinforcement
// ---------------------------------------------------------------------------

describe("§5.5 reinforcement — graded, retrospective, at most once a day", () => {
  const m = mem({ kind: "fact", birthDay: 0, lastUsedDay: 0 });

  test("the tiers carry the contract's weights and the ignorable tier never trains", () => {
    expect(creditUse(m, 5, "referenced")).toMatchObject({ credited: true, w: 1 });
    expect(creditUse(m, 5, "surfaced")).toMatchObject({ credited: true, w: 0.25 });
    const footnote = creditUse(m, 5, "footnoted");
    expect(footnote.credited).toBe(false);
    expect(footnote.reason).toBe("ignorable-tier");
    expect(footnote.next).toEqual({ uses: m.uses, lastUsedDay: m.lastUsedDay, reinforcedDays: 0 });
  });

  test("a second credit the same lived day is refused as already-credited", () => {
    const first = creditUse(m, 5, "referenced");
    const second = creditUse({ ...m, ...first.next }, 5, "referenced");
    expect(second.credited).toBe(false);
    expect(second.reason).toBe("already-credited-today");
  });

  test("a credited use resets the curve — the testing effect", () => {
    const out = creditUse(m, 30, "referenced");
    expect(out.next.lastUsedDay).toBe(30);
    expect(stability({ kind: "fact", uses: out.next.uses })).toBeGreaterThan(
      stability({ kind: "fact", uses: m.uses }),
    );
  });

  test("any credited tier counts one distinct reinforced day", () => {
    const out = creditUse(m, 7, "surfaced");
    expect(out.next.reinforcedDays).toBe(1);
  });

  test("a backdated credit is refused rather than silently reordering the clock", () => {
    const used = { ...m, lastUsedDay: 40 };
    expect(creditUse(used, 20, "referenced").reason).toBe("stale-day");
  });
});

// ---------------------------------------------------------------------------
// §5.6 revision
// ---------------------------------------------------------------------------

describe("[M] guarantee 7 — revision requires a DECLARED updates: target", () => {
  const target = mem({ kind: "entity", salience: S(0.7), uses: 3, lastUsedDay: 100 });

  test("an undeclared memory applies no pressure at all", () => {
    const out = applyChallenge(
      "bel",
      target,
      { id: "x", declaredUpdates: null, physics: mem({ kind: "entity", salience: S(0.9), birthDay: 101, lastUsedDay: 101 }) },
      101,
    );
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("no-declared-target");
    expect(out.verdict).toBe("hold");
    expect(out.next).toEqual({ pressure: target.pressure, lastChallengedDay: target.lastChallengedDay });
    expect(out.log).toBeNull();
  });

  test("a declaration naming somebody else never touches this row", () => {
    const out = applyChallenge("bel", target, challenge("x", "some-other-id", 0.9, 101, "entity"), 101);
    expect(out.reason).toBe("target-mismatch");
    expect(out.pressureAfter).toBe(out.pressureBefore);
  });

  test("every credited increment is logged with day, challenger, and force", () => {
    const out = applyChallenge("bel", target, challenge("c1", "bel", 0.5, 101, "entity"), 101);
    expect(out.log).toMatchObject({ event: "revision.pressure", day: 101, challengerId: "c1" });
    expect(out.log?.force).toBeCloseTo(0.25, 10);
  });

  test("novelty plays no role in the force term (review condition (c))", () => {
    const informed = mem({ kind: "entity", salience: S(0.6, 0.05), birthDay: 101, lastUsedDay: 101 });
    const blind = mem({ kind: "entity", salience: { ...S(0.6), novelty: null }, birthDay: 101, lastUsedDay: 101 });
    // an informed challenger (near-zero prediction error) is not out-weighed by a blind one
    expect(challengeForce(informed, 101)).toBeGreaterThan(0);
    expect(challengeForce(blind, 101)).toBeGreaterThan(0);
    const equalSal = mem({ kind: "entity", salience: S(0.6), birthDay: 101, lastUsedDay: 101 });
    expect(challengeForce(equalSal, 101)).toBeCloseTo(sal(equalSal.salience) ** 2, 10);
  });
});

describe("regression 1 — the 08-24 exhibit fires", () => {
  // entity kind (iota = 0.5), an established belief at strength ~0.7, challenged by
  // declared corrections of author salience ~0.6 on successive lived days.
  const D0 = 100;
  const belief = mem({ kind: "entity", salience: S(0.72), uses: 3, lastUsedDay: D0, birthDay: 20 });

  test("the belief is where the exhibit found it", () => {
    expect(kindPhysics("entity").iota).toBe(0.5);
    expect(strength(belief, D0)).toBeCloseTo(0.72, 10);
    expect(revisionBar(belief, D0)).toBeCloseTo(0.36, 10);
  });

  test("one challenge is not enough — it holds, below the bar", () => {
    const out = applyChallenge("bel", belief, challenge("c1", "bel", 0.58, D0 + 1, "entity"), D0 + 1);
    expect(out.credited).toBe(true);
    expect(out.verdict).toBe("hold");
    expect(out.reason).toBe("below-bar");
    expect(out.force).toBeCloseTo(0.3364, 4);
    expect(out.pressureAfter).toBeLessThan(out.bar);
  });

  test("pressure ACCUMULATES across lived days and crosses within a few", () => {
    let m = belief;
    let crossedOn = 0;
    const pressures: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const d = D0 + i;
      const out = applyChallenge("bel", m, challenge(`c${i}`, "bel", 0.58, d, "entity"), d);
      expect(`day+${i}:credited=${out.credited}`).toBe(`day+${i}:credited=true`);
      pressures.push(out.pressureAfter);
      m = { ...m, ...out.next };
      if (out.verdict === "revise") {
        crossedOn = i;
        expect(out.reason).toBe("revised");
        expect(out.pressureAfter).toBeGreaterThan(out.bar);
        break;
      }
    }
    expect(crossedOn).toBe(2);
    expect(pressures[1]).toBeGreaterThan(pressures[0] as number); // the SUM is what did it
  });

  test("the pre-review single-shot arithmetic provably could NOT fire this", () => {
    // old form: F = strength(new) x novelty(new), evaluated once, never summed.
    // The author was INFORMED, so novelty against a context containing the target
    // is near zero — and with no accumulation there is no second chance.
    const informedNovelty = 0.1;
    const singleShotF = 0.58 * informedNovelty;
    expect(singleShotF).toBeLessThan(revisionBar(belief, D0 + 1));
    // even the *new* force, un-summed, loses on day one
    expect(challengeForce(challenge("c1", "bel", 0.58, D0 + 1, "entity").physics, D0 + 1)).toBeLessThan(
      revisionBar(belief, D0 + 1),
    );
  });

  test("on REVISE the old version is superseded with lineage and stays resolvable", () => {
    const rec = supersedeRecord("bel", "bel-v2", D0 + 2);
    expect(rec).toMatchObject({ predecessorId: "bel", successorId: "bel-v2", day: D0 + 2 });
    expect(rec.resolvableUntilDay).toBe(D0 + 2 + TUNABLES.H_SUPERSEDED_DAYS);
    expect(successorSeed(belief).pressure).toBe(0); // the successor starts clean
  });
});

describe("regression 2 — one loud claim does not flip a friend-model", () => {
  // self kind (iota = 0.9), a strongly-held model, spammed in a single lived day.
  const friend = mem({ kind: "self", salience: S(0.95), uses: 4, lastUsedDay: 200, birthDay: 10 });
  const DAY = 201;

  test("twenty max-force claims on one day credit exactly once, and it holds", () => {
    let m = friend;
    const reasons: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const out = applyChallenge("friend", m, challenge(`spam${i}`, "friend", 0.9, DAY, "self"), DAY);
      reasons.push(out.reason);
      expect(`${i}:${out.verdict}`).toBe(`${i}:hold`);
      m = { ...m, ...out.next };
    }
    expect(reasons[0]).toBe("below-bar");
    expect(reasons.slice(1)).toEqual(Array(19).fill("already-challenged-today"));
    // ONE credited occasion, not twenty — and the slow-kind daily cap bounds it:
    // raw F would be 0.81, credited force is F_DAY_CAP_SLOW.
    expect(m.pressure).toBeCloseTo(TUNABLES.F_DAY_CAP_SLOW, 10);
  });

  test("the per-day cap is what saved it — the uncapped sum would have flipped it 18x over", () => {
    const perClaim = 0.9 * 0.9;
    expect(perClaim).toBeLessThan(revisionBar(friend, DAY));
    expect(perClaim * 20).toBeGreaterThan(revisionBar(friend, DAY) * 18);
  });

  test("the same claims spread over lived days DO revise — slowness, not immunity", () => {
    let m = friend;
    let crossed = 0;
    for (let i = 1; i <= 4; i++) {
      const d = DAY + i;
      const out = applyChallenge("friend", m, challenge(`day${i}`, "friend", 0.9, d, "self"), d);
      m = { ...m, ...out.next };
      if (out.verdict === "revise") {
        crossed = i;
        break;
      }
    }
    // With the slow-kind daily cap (0.35/day) the crossing lands on day 3 —
    // the ratified "~3 lived days to overturn a friend-model" is now a bound,
    // not an approximation.
    expect(crossed).toBe(3);
  });

  test("one FLAWLESS claim (sal 1.0, strength 1.0) still cannot flip a friend-model in one day", () => {
    const out = applyChallenge("friend", friend, challenge("flawless", "friend", 1.0, DAY, "self"), DAY);
    expect(out.verdict).toBe("hold");
    expect(out.force).toBeCloseTo(TUNABLES.F_DAY_CAP_SLOW, 10); // capped, not 1.0
    expect(out.force).toBeLessThan(out.bar);
  });

  test("a slow kind resists what a fast kind concedes", () => {
    expect(kindPhysics("self").iota).toBe(0.9);
    expect(kindPhysics("entity").iota).toBe(0.5);
    expect(kindPhysics("fact").iota).toBe(0.2);
  });
});

describe("regression 9 — pressure decays: an abandoned challenge fades", () => {
  const target = mem({
    kind: "entity",
    salience: S(0.72),
    uses: 3,
    lastUsedDay: 300,
    pressure: 0.3364,
    lastChallengedDay: 300,
  });

  test("it is undiminished on the day it was raised", () => {
    expect(pressureAt(target, 300)).toBeCloseTo(0.3364, 10);
  });

  test("it fades monotonically once abandoned", () => {
    let prev = pressureAt(target, 300);
    for (const d of [305, 330, 360, 420, 480]) {
      const now = pressureAt(target, d);
      expect(`${d}:${now < prev}`).toBe(`${d}:true`);
      prev = now;
    }
    expect(pressureAt(target, 480)).toBeLessThan(0.05 * 0.3364 + 1e-9);
  });

  test("a near-miss does not lie in ambush: months later it is no longer near", () => {
    const barThen = revisionBar(target, 300);
    expect(pressureAt(target, 300) / barThen).toBeGreaterThan(0.9); // it WAS a near miss
    expect(pressureAt(target, 480) / barThen).toBeLessThan(0.1);
  });

  test("no pressure and no challenge day reads as zero, not as NaN", () => {
    expect(pressureAt(mem({ kind: "fact" }), 500)).toBe(0);
    expect(pressureAt({ pressure: 0.5, lastChallengedDay: null }, 500)).toBe(0);
  });

  test("pressure decays even against a decay-exempt identity element", () => {
    const anchor = mem({
      kind: "self",
      salience: S(0.9),
      promotedIdentity: true,
      pressure: 0.5,
      lastChallengedDay: 300,
      lastUsedDay: 300,
    });
    expect(decay(anchor, 480)).toBe(1); // the MEMORY is exempt
    expect(pressureAt(anchor, 480)).toBeLessThan(0.5); // the PRESSURE is not
  });
});

// ---------------------------------------------------------------------------
// §5.7 dedup
// ---------------------------------------------------------------------------

describe("[M] guarantee 8 — a declared revision is never deduped into its target", () => {
  test("regression 8: not by cosine, and not even by an identical content hash", () => {
    const byCosine = dedupVerdict({ originalId: "bel", declaredUpdates: "bel", cosine: 0.99 });
    expect(byCosine.verdict).toBe("leave-alone");
    expect(byCosine.reason).toBe("declared-revision-never-merged");
    expect(byCosine.effect).toBeNull();

    const byHash = dedupVerdict({
      originalId: "bel",
      declaredUpdates: "bel",
      sameContentHash: true,
      cosine: 1,
    });
    expect(byHash.reason).toBe("declared-revision-never-merged");
    // otherwise the refutation merges into the belief it refutes and REINFORCES it
    expect(byHash.effect).toBeNull();
  });

  test("an ordinary near-duplicate merges as uses(orig) += 1", () => {
    const v = dedupVerdict({ originalId: "orig", declaredUpdates: null, cosine: 0.96 });
    expect(v.verdict).toBe("merge");
    expect(v.reason).toBe("cosine-at-or-above-tau");
    expect(v.effect).toEqual({ usesDelta: 1 });
  });

  test("ambiguous near-duplicates are LEFT ALONE — accepted rent for zero confabulation", () => {
    const v = dedupVerdict({ originalId: "orig", declaredUpdates: null, cosine: 0.9 });
    expect(v.verdict).toBe("leave-alone");
    expect(v.reason).toBe("below-tau");
  });

  test("a declaration aimed elsewhere does not shield it from ordinary dedup", () => {
    const v = dedupVerdict({ originalId: "orig", declaredUpdates: "another", cosine: 0.99 });
    expect(v.reason).toBe("cosine-at-or-above-tau");
  });

  test("no similarity supplied is a distinct answer, not a silent zero", () => {
    expect(dedupVerdict({ originalId: "o", declaredUpdates: null }).reason).toBe("no-similarity-supplied");
  });
});

// ---------------------------------------------------------------------------
// §5.8 forgetting
// ---------------------------------------------------------------------------

describe("[M] guarantees 9 and 10 — prune is gated on all five, and records nothing readable", () => {
  const faded = mem({ kind: "fact", salience: S(0.55), uses: 1, lastUsedDay: 0, birthDay: 0 });

  test("superseded versions stay resolvable for H lived days; nothing here deletes one", () => {
    expect(TUNABLES.H_SUPERSEDED_DAYS).toBe(90);
    expect(supersededResolvable(100, 189)).toBe(true);
    expect(supersededResolvable(100, 191)).toBe(false);
  });

  test("each of the five gates refuses by name", () => {
    expect(pruneVerdict(faded, 100, { inLiveRevisionChain: false }).blockedBy).toEqual(["above-floor"]);
    expect(pruneVerdict(faded, 60, { inLiveRevisionChain: false }).blockedBy).toEqual([
      "above-floor",
      "dwell-too-short",
    ]);
    expect(pruneVerdict(faded, 5, { inLiveRevisionChain: false }).blockedBy).toEqual([
      "above-floor",
      "dwell-too-short",
      "band-not-episodic",
    ]);
    expect(
      pruneVerdict({ ...faded, protected: true }, 280, { inLiveRevisionChain: false }).blockedBy,
    ).toEqual(["protected"]);
    expect(pruneVerdict(faded, 280, { inLiveRevisionChain: true }).blockedBy).toEqual([
      "in-live-revision-chain",
    ]);
  });

  test("the prune record carries counts, kind and dates — never a body, never a hash", () => {
    const v = pruneVerdict(faded, 280, { inLiveRevisionChain: false });
    expect(v.prune).toBe(true);
    expect(v.record).not.toBeNull();
    const keys = Object.keys(v.record as object);
    expect(keys.filter((k) => /text|body|content|hash|excerpt|title/i.test(k))).toEqual([]);
    expect(keys.sort()).toEqual(
      ["band", "birthDay", "day", "event", "kind", "lastUsedDay", "strength", "uses"].sort(),
    );
  });
});

describe("regression 5 — a faded semantic demotes and becomes prunable", () => {
  const m = mem({ kind: "fact", salience: S(0.55), uses: 1, lastUsedDay: 0, birthDay: 0 });

  test("it starts semantic", () => {
    expect(band(m, 0)).toBe("semantic");
    expect(strength(m, 0)).toBeCloseTo(0.55, 10);
  });

  test("decay demotes it to episodic — the band names its own exit (scar §2.17)", () => {
    expect(band(m, 100)).toBe("episodic");
    expect(bandMove("semantic", "episodic")).toBe("down");
  });

  test("but demotion alone is not forgetting — it still fails the floor gate", () => {
    const early = pruneVerdict(m, 100, { inLiveRevisionChain: false });
    expect(early.prune).toBe(false);
    expect(early.reason).toBe("above-floor");
    expect(early.band).toBe("episodic");
    expect(early.dwellDays).toBeGreaterThanOrEqual(TUNABLES.D_FLOOR_DAYS);
  });

  test("far enough down the curve, all five conditions pass", () => {
    const v = pruneVerdict(m, 280, { inLiveRevisionChain: false });
    expect(v.blockedBy).toEqual([]);
    expect(v.reason).toBe("prunable");
    expect(v.prune).toBe(true);
    expect(v.strength).toBeLessThan(TUNABLES.PHI_PRUNE);
    expect(v.band).toBe("episodic");
  });

  test("everything short of a prune merely fades — the memory is still there", () => {
    expect(strength(m, 280)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// guarantee 12 — the symmetry counter
// ---------------------------------------------------------------------------

describe("[M] guarantee 12 — up-moves and down-moves counted separately, per kind", () => {
  test("band moves are classified in both directions", () => {
    expect(bandMove("episodic", "semantic")).toBe("up");
    expect(bandMove("semantic", "identity")).toBe("up");
    expect(bandMove("identity", "semantic")).toBe("down");
    expect(bandMove("semantic", "semantic")).toBe("none");
  });

  test("v1's exact ratchet shape fires the tripwire", () => {
    const check = symmetryCheck("entity", { up: 279, down: 0 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("ratchet-suspected");
    expect(check.ratio).toBe(Infinity);
    expect(check.kind).toBe("entity");
  });

  test("a healthy ratio passes against the STATED expectation", () => {
    const check = symmetryCheck("fact", { up: 100, down: 50 });
    expect(check.ok).toBe(true);
    expect(check.reason).toBe("within-expectation");
    expect(check.expectedMax).toBe(TUNABLES.SYMMETRY_MAX_UP_DOWN_RATIO);
  });

  test("too few moves reads as NEVER ASKED, not as healthy (scar §2.4)", () => {
    const check = symmetryCheck("self", { up: 5, down: 0 });
    expect(check.reason).toBe("never-asked");
  });

  test("the counter can move both ways — a down-ratchet is also named", () => {
    expect(symmetryCheck("place", { up: 2, down: 40 }).reason).toBe("reverse-ratchet-suspected");
  });

  test("every kind is countable — the totality check", () => {
    for (const kind of ALL_KINDS) {
      expect(`${kind}:${symmetryCheck(kind, { up: 30, down: 10 }).kind}`).toBe(`${kind}:${kind}`);
    }
  });
});

// ---------------------------------------------------------------------------
// the TUNABLE table itself
// ---------------------------------------------------------------------------

describe("the TUNABLE table matches the contract, in one visible place", () => {
  test("the scalars are the contract's numbers", () => {
    expect(TUNABLES.REP_PER_USE).toBe(0.12);
    expect(TUNABLES.REP_CAP).toBe(0.5);
    expect(TUNABLES.CONS_BONUS).toBe(0.2);
    expect(TUNABLES.THETA_SEM).toBe(0.5);
    expect(TUNABLES.THETA_ID).toBe(0.85);
    expect(TUNABLES.N_PROMOTION_DAYS).toBe(3);
    expect(TUNABLES.S_BASE).toBe(60);
    expect(TUNABLES.BETA).toBe(0.5);
    expect(TUNABLES.BOUNDARY_HOUR).toBe(4);
    expect(TUNABLES.K_NEAREST).toBe(8);
    expect(TUNABLES.W_REFERENCED).toBe(1);
    expect(TUNABLES.W_SURFACED).toBe(0.25);
    expect(TUNABLES.W_FOOTNOTED).toBe(0);
    expect(TUNABLES.TAU_DUP).toBe(0.95);
    expect(TUNABLES.H_SUPERSEDED_DAYS).toBe(90);
    expect(TUNABLES.PHI_PRUNE).toBe(0.02);
    expect(TUNABLES.D_FLOOR_DAYS).toBe(90);
  });

  test("the per-kind table is v1 §4.3, verbatim", () => {
    expect(TUNABLES.KINDS).toEqual({
      self: { wSal: 1.0, wRep: 0.0, kappa: 0.7, iota: 0.9 },
      person: { wSal: 1.0, wRep: 0.0, kappa: 0.75, iota: 0.8 },
      entity: { wSal: 1.0, wRep: 1.0, kappa: 0.85, iota: 0.5 },
      skill: { wSal: 0.4, wRep: 1.0, kappa: 0.5, iota: 0.25 },
      place: { wSal: 0.4, wRep: 1.0, kappa: 0.85, iota: 0.25 },
      fact: { wSal: 1.0, wRep: 1.0, kappa: 1.0, iota: 0.2 },
    });
  });

  test("every kind has physics — a new kind cannot slip in unmapped (scar §2.4)", () => {
    for (const kind of ALL_KINDS) {
      const k = kindPhysics(kind);
      expect(`${kind}:${typeof k.kappa}:${typeof k.iota}`).toBe(`${kind}:number:number`);
      expect(`${kind}:${k.kappa > 0}`).toBe(`${kind}:true`);
    }
    expect(Object.keys(TUNABLES.KINDS).sort()).toEqual([...ALL_KINDS].sort());
  });

  test("clamp01 is the only clamp anyone needs", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});
