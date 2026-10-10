/**
 * EMOTION, PART A (owner decisions 2026-09-25/26): feelings start to matter.
 *
 *   1. Height — emotion ADDS to a memory's starting height; its intensity is the
 *      strongest of its `emotional` score and its recorded feelings; a lone
 *      `emotional` score is kept.
 *   2. Slope — the same intensity slows decay.
 *   3. The feeling softens faster than the fact (on read; the table keeps it).
 *   4. Mood-matching recall, by person, with a light cross-link — a modulation
 *      of candidates the conversation reached, never an admission.
 *   5. Vocabulary from real use: additions, blends, aliases, and suggestions
 *      only when genuinely close — never toward the opposite valence.
 *   6. Showing it: `you: … · me: …`, and the mechanisms rows.
 *
 * Hermetic: a fresh temp directory per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closestKeys,
  coresOfFeeling,
  lookupWord,
  resolveEmotion,
  wheelEntry,
} from "../src/core/feelings-wheel.js";
import {
  TUNABLES,
  base,
  challengeForce,
  emotionalIntensity,
  feelingSofteningDays,
  promotionEligibility,
  sal,
  salArm,
  softenedFeeling,
  stability,
  strength,
} from "../src/core/physics/index.js";
import type { MemoryPhysics, Salience } from "../src/core/types.js";
import { Store, isStoreError } from "../src/core/store/index.js";
import type { FeelingRow, StoreOptions } from "../src/core/store/index.js";
import {
  Recall,
  TUNABLES as RECALL,
  gate,
  freshGateState,
  gatedSal,
  moodLift,
  withTunables,
} from "../src/core/recall/index.js";
import type { Candidate, Mood } from "../src/core/recall/index.js";
import type { ProseDoc } from "../src/core/store/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { firedReport } from "../src/adapters/fired.js";
import { consoleVerdicts, mechanismsLines } from "../src/adapters/cli/mechanisms.js";
import { feelingsLine } from "../src/adapters/feelings-line.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { memoryDetail } from "../src/adapters/dashboard/web/views/memory.js";
import { mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-emotion-"));
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

function store(opts: Omit<StoreOptions, "dir"> = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

/** A silent authored note: nothing claimed, so the default floor, no dimensions. */
function note(over: Partial<MemoryPhysics> = {}, salience: Partial<Salience> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: {
      novelty: null,
      relevance: 0,
      emotional: 0,
      predictive: 0,
      claimed: TUNABLES.AUTHORED_DEFAULT_CLAIM,
      ...salience,
    },
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

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2 + 3 — the arithmetic (physics §5.10)
// ═══════════════════════════════════════════════════════════════════════════
describe("physics §5.10 — height, slope, and the feeling that softens", () => {
  test("intensity is the STRONGEST of the numeric score and the recorded feelings, his or mine", () => {
    expect(emotionalIntensity(note())).toBe(0);
    expect(emotionalIntensity(note({}, { emotional: 0.6 }))).toBe(0.6);
    expect(emotionalIntensity(note({ feelingPeak: 0.9 }, { emotional: 0.6 }))).toBe(0.9);
    expect(emotionalIntensity(note({ feelingPeak: 0.3 }, { emotional: 0.6 }))).toBe(0.6);
    expect(emotionalIntensity(note({ feelingPeak: null }))).toBe(0);
  });

  test("height: emotion ADDS to the salience arm — it is not averaged away by the claimed floor", () => {
    const flat = note();
    const felt = note({ feelingPeak: 0.9 });
    expect(base(flat)).toBeCloseTo(0.25, 10);
    expect(base(felt)).toBeCloseTo(0.25 + TUNABLES.EMO_LIFT * 0.9, 10);
    // A lone emotional score of 0.9 used to read as a mean of 0.3 and nothing more.
    const lone = note({}, { emotional: 0.9 });
    expect(sal(lone.salience)).toBeCloseTo(0.3, 10);
    expect(base(lone)).toBeCloseTo(0.3 + TUNABLES.EMO_LIFT * 0.9, 10);
    // `sal()` itself is untouched: the turn gate (§9 G10) and revision force read it.
    expect(sal(felt.salience)).toBeCloseTo(sal(flat.salience), 10);
  });

  test("the lift never lands on the repetition arm, and never on revision force", () => {
    const skill = note({ kind: "skill", uses: 10, feelingPeak: 1 });
    // wRep x rep (saturating since 2026-10-10: 0.5 x (1 - e^(-10/3)) ~ 0.48)
    // dominates the salience arm (0.4 x 0.4): no lift reaches it.
    expect(base(skill)).toBeCloseTo(TUNABLES.REP_CAP * (1 - Math.exp(-10 / TUNABLES.REP_SCALE_USES)), 10);
    const a = note({ kind: "entity", birthDay: 5, lastUsedDay: 5 });
    const b = note({ kind: "entity", birthDay: 5, lastUsedDay: 5, feelingPeak: 1 });
    // Force = strength x sal: the lift raises the strength factor only.
    expect(challengeForce(b, 5) / challengeForce(a, 5)).toBeCloseTo(salArm(b) / salArm(a), 10);
  });

  test("the structural bounds that still hold, written down", () => {
    // The DEFAULT ALONE still cannot reach semantic, even consolidated (F5 scar).
    expect(TUNABLES.AUTHORED_DEFAULT_CLAIM + TUNABLES.CONS_BONUS).toBeLessThan(TUNABLES.THETA_SEM);
    // A silent note with the strongest possible feeling is not semantic at birth…
    expect(TUNABLES.AUTHORED_DEFAULT_CLAIM + TUNABLES.EMO_LIFT).toBeLessThan(TUNABLES.THETA_SEM);
    expect(strength(note({ feelingPeak: 1 }), 0)).toBeLessThan(TUNABLES.THETA_SEM);
    // Softening is faster than the fact's own decay.
    expect(TUNABLES.S_FEELING).toBeLessThan(TUNABLES.S_BASE);
  });

  test("emotion counts toward identity ON PURPOSE, and only through the fast lane, and only about me (2026-09-26)", () => {
    // Back once, three lived days after it was made: the fast lane's second half.
    const at = (feelingPeak: number, kind: MemoryPhysics["kind"] = "self"): MemoryPhysics =>
      note({ kind, birthDay: 0, returnDays: 1, firstReturnDay: 3, lastReturnDay: 3, feelingPeak });
    // Below the bar, no lane; at or above it, the fast lane opens.
    for (const I of [0, 0.3, 0.5]) expect(promotionEligibility(at(I), { aboutMe: true }).eligible).toBe(false);
    expect(promotionEligibility(at(TUNABLES.CORE_FAST_FEELING), { aboutMe: true })).toMatchObject({ eligible: true, lane: "fast" });
    // His feeling or mine — the strongest counts (`emotionalIntensity`).
    expect(promotionEligibility(note({ kind: "person", returnDays: 1, lastReturnDay: 3, firstReturnDay: 3 }, { emotional: 0.8 }), { aboutMe: true }).lane).toBe("fast");
    // A fact about the world is not about me, however strongly it was felt.
    expect(promotionEligibility(at(1, "fact"), { aboutMe: false }).eligible).toBe(false);
    // And the lift stays height only: `base` rises with the feeling, the lane reads the feeling itself.
    expect(base(at(1))).toBeGreaterThan(base(at(0)));
  });

  test("slope: the same intensity lengthens stability", () => {
    const s0 = stability(note());
    expect(stability(note({ feelingPeak: 0.5 }))).toBeCloseTo(s0 * (1 + TUNABLES.EMO_SLOPE * 0.5), 10);
    expect(stability(note({}, { emotional: 0.9 }))).toBeCloseTo(s0 * (1 + TUNABLES.EMO_SLOPE * 0.9), 10);
    // A caller that passes no salience (the old two-field shape) reads unfelt.
    expect(stability({ kind: "fact", uses: 0 })).toBeCloseTo(s0, 10);
  });

  test("THE SIMULATION in physics NOTES, pinned: a silent fact at intensity 0 / 0.5 / 0.9 over 90 lived days", () => {
    const at = (I: number, d: number): number => strength(note({ feelingPeak: I }), d);
    const table = [0, 0.5, 0.9].map((I) => [0, 7, 30, 60, 90].map((d) => Number(at(I, d).toFixed(3))));
    expect(table).toEqual([
      [0.25, 0.222, 0.152, 0.092, 0.056],
      [0.325, 0.296, 0.218, 0.146, 0.098],
      [0.385, 0.355, 0.273, 0.193, 0.137],
    ]);
    const floorDay = (I: number): number => {
      let d = 0;
      while (at(I, d) >= TUNABLES.PHI_PRUNE) d += 1;
      return d;
    };
    expect([floorDay(0), floorDay(0.5), floorDay(0.9)]).toEqual([152, 210, 258]);
  });

  test("the feeling softens faster than the fact — read-side only", () => {
    expect(softenedFeeling(0.9, 0)).toBeCloseTo(0.9, 10);
    // ~14 lived days halves the feeling; the fact itself is still at ~0.79 of its height.
    expect(softenedFeeling(0.9, 14) / 0.9).toBeLessThan(0.5);
    expect(strength(note(), 14) / strength(note(), 0)).toBeGreaterThan(0.75);
    expect(softenedFeeling(0.9, -3)).toBeCloseTo(0.9, 10);
    expect(softenedFeeling(0.9, Number.NaN)).toBeCloseTo(0.9, 10);
  });

  test("the store reads the strongest feeling beside the row, and the table keeps it as recorded", () => {
    const s = store();
    const plain = s.put({ type: "memory", kind: "fact", body: "the kiln was loaded for the bisque firing" });
    const felt = s.put({ type: "memory", kind: "fact", body: "the kiln opened on a cracked bowl" });
    expect(s.row(felt)?.feeling_peak).toBeNull();
    s.addFeelings(felt, [
      { whose: "owner", core: "sad", emotion: "despair", strength: 0.4 },
      { whose: "self", core: "sad", emotion: "tender", strength: 0.8 },
    ]);
    expect(s.row(felt)?.feeling_peak).toBeCloseTo(0.8, 10);
    const p = s.physicsOf(felt);
    expect(p.feelingPeak).toBeCloseTo(0.8, 10);
    expect(emotionalIntensity(p)).toBeCloseTo(0.8, 10);
    expect(strength(p, 0)).toBeGreaterThan(strength(s.physicsOf(plain), 0));
    // Recorded strength is never rewritten by reading.
    expect(s.feelingsFor(felt).map((f) => f.strength)).toEqual([0.4, 0.8]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 — a lone `emotional` score is kept, through both authored doors
// ═══════════════════════════════════════════════════════════════════════════
describe("a lone emotional score is kept", () => {
  function server(): McpServer {
    const s = openServer({ dir, scope: "/tmp/emotion-project", owner: true });
    open.push({ close: () => s.counterpart.close() });
    return s;
  }
  const payload = (r: { structuredContent?: unknown }): Record<string, unknown> =>
    (r.structuredContent ?? {}) as Record<string, unknown>;

  test("note: emotional alone reaches the row and lifts it", async () => {
    const s = server();
    const felt = payload(await s.call("note", { text: "The day the kiln cracked and the whole month's work went with it.", emotional: 0.9 }));
    const plain = payload(await s.call("note", { text: "The kiln shelf was moved to the left wall on Tuesday." }));
    const a = s.counterpart.store.physicsOf(felt["id"] as string);
    const b = s.counterpart.store.physicsOf(plain["id"] as string);
    expect(a.salience.emotional).toBe(0.9);
    expect([a.salience.relevance, a.salience.predictive]).toEqual([0, 0]);
    expect(base(a)).toBeGreaterThan(base(b) + 0.1);
  });

  test("session_end: emotional alone on an entry is kept too", async () => {
    recordSession(dir, { sessionId: "s-emo", scope: "/tmp/emotion-project", phase: "start" });
    const s = server();
    const out = payload(
      await s.call("session_end", {
        session: "s-emo",
        memories: [{ content: "Hearing the firing came out whole after three failed ones.", emotional: 0.7 }],
      }),
    );
    const [first] = out["outcomes"] as Record<string, unknown>[];
    expect(first?.["stored"]).toBe(true);
    expect(s.counterpart.store.physicsOf(first?.["id"] as string).salience.emotional).toBe(0.7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — vocabulary from real use
// ═══════════════════════════════════════════════════════════════════════════
describe("the wheel's words from real use, blends and aliases", () => {
  test("every word a counterpart has recorded has a home on the wheel", () => {
    // The emotion walk's live store, 2026-09-30: every word, mine and the owner's.
    const words = [
      "hopeful", "sheepish", "amused", "moved", "wistful", "steadied", "curious", "fond", "grateful", "kinship",
      "relieved", "rueful", "tender", "recognized", "unsettled", "exposed", "seen", "anticipating", "clarified",
      "completion", "encouraged", "engaged", "glad", "settled", "trust", "trusted", "warm", "entrusted", "lonely",
      "caught", "confused", "amazed", "recognition", "frustrated", "hurt", "wary", "interested", "validated",
      "bummed", "guilty", "excited",
    ];
    for (const w of words) expect(`${w}: ${lookupWord(w) !== undefined}`).toBe(`${w}: true`);
    expect(wheelEntry("steadied")?.core).toBe("calm");
    expect(wheelEntry("kinship")?.core).toBe("warm");
    expect(wheelEntry("sheepish")).toMatchObject({ core: "uneasy", parent: "caught out" });
    expect(wheelEntry("guilty")).toMatchObject({ core: "uneasy", ring: "middle" });
    expect(wheelEntry("rueful")?.core).toBe("sad");
    expect(wheelEntry("hopeful")?.core).toBe("happy");
    expect(wheelEntry("disgusted")).toMatchObject({ core: "angry", ring: "middle" });
    // Recognition: under curious, also warm, and self-relevant — its words too.
    expect(wheelEntry("recognized")).toMatchObject({ core: "curious", alsoCore: "warm", selfRelevant: true });
    expect(wheelEntry("familiar")).toMatchObject({ core: "curious", alsoCore: "warm", selfRelevant: true });
    expect(wheelEntry("clarified")?.selfRelevant).toBeUndefined();
  });

  test("a blend counts under both cores, and the writer's core is kept", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "the last firing before the studio closed" });
    s.addFeelings(id, [
      { whose: "self", core: "happy", emotion: "tender", strength: 0.6 },
      { whose: "owner", core: "sad", emotion: "sheepish", strength: 0.4 },
      { whose: "owner", core: "sad", emotion: "bittersweet", strength: 0.5 },
    ]);
    const rows = s.feelingsFor(id);
    expect(rows.map((r) => [r.core, r.emotion])).toEqual([
      ["happy", "tender"],
      ["sad", "sheepish"],
      ["sad", "bittersweet"],
    ]);
    expect(coresOfFeeling("happy", "tender")).toEqual(["happy", "warm", "sad"]);
    expect(coresOfFeeling("sad", "bittersweet")).toEqual(["sad", "happy"]);
    expect(coresOfFeeling("happy", "other")).toEqual(["happy"]);
    // A first-wheel core name is read as the core it is now, and said.
    const moved = s.addFeelings(id, [{ whose: "owner", core: "anger", emotion: "tender", strength: 0.5 }]);
    expect(moved.repairs).toMatchObject([{ field: "core", was: "anger", now: "angry" }]);
    expect(s.feelingsFor(id).at(-1)).toMatchObject({ core: "angry", emotion: "tender" });
  });

  test("an alias is read as its wheel word, and the caller is told", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "the help with the kiln wiring" });
    const out = s.addFeelings(id, [{ whose: "self", core: "warm", emotion: "Thankful", strength: 0.5 }]);
    expect(s.feelingsFor(id).map((r) => [r.core, r.emotion, r.other_word])).toEqual([["warm", "grateful", null]]);
    expect(out.notices).toEqual([{ index: 0, word: "Thankful", core: "warm", closest: [], readAs: "grateful" }]);
  });

  test('"tender" is never offered despair — and nothing far is offered at all', () => {
    const read = resolveEmotion("sad", "tender");
    expect(read.kind === "wheel" ? [read.entry.key, read.home] : read.kind).toEqual(["tender", true]);
    // A word with nothing close stays the writer's own, with no nudge.
    for (const [core, word] of [["sad", "glowing"], ["happy", "unclenched"], ["sad", "tenderness"], ["uneasy", "jittery"]] as const) {
      const r = resolveEmotion(core, word);
      expect(`${word}: ${r.kind === "other" ? r.closest.join(",") : r.kind}`).toBe(`${word}: `);
    }
    expect(closestKeys("sad", "tender")).not.toContain("despair");
    expect(closestKeys("sad", "tender")).not.toContain("bored");
    expect(closestKeys("sad", "tender")).not.toContain("lonely");
  });

  test("a misspelling IS offered its word — only a word that can be written under that core", () => {
    expect(closestKeys("warm", "gratefull")).toEqual(["grateful"]);
    expect(closestKeys("sad", "tendr")).toEqual(["tender"]); // a blend belongs to both its cores
    expect(closestKeys("warm", "thankfull")).toEqual(["grateful"]); // through its alias
    expect(closestKeys("calm", "relievd")).toEqual(["relieved"]);
    expect(closestKeys("curious", "confussed")).toEqual(["confused"]);
    // "bord" is one letter from bored (sad): under happy it is never offered.
    expect(closestKeys("happy", "bord")).toEqual([]);
    expect(closestKeys("sad", "bord")).toEqual(["bored"]);
    for (const core of ["happy", "warm", "calm", "curious", "sad", "uneasy", "angry"] as const) {
      for (const word of ["hapy", "sadd", "angyr", "joyfull", "worred", "tendr", "fnd", "steadyed"]) {
        for (const key of closestKeys(core, word)) {
          const e = wheelEntry(key);
          const ok = e !== undefined && (e.core === core || e.alsoCore === core);
          expect(`${core}/${word} → ${key}: ${ok}`).toBe(`${core}/${word} → ${key}: true`);
        }
      }
    }
  });

  test("the MCP reply says 'kept as your own word' and suggests only when close", async () => {
    const s = openServer({ dir, scope: "/tmp/emotion-project", owner: true });
    open.push({ close: () => s.counterpart.close() });
    const out = (await s.call("note", {
      text: "The glaze notes finally make sense after the long evening going through them.",
      feelings: [
        { whose: "self", core: "calm", emotion: "unclenched", strength: 0.5 },
        { whose: "self", core: "warm", emotion: "gratefull", strength: 0.5 },
        { whose: "self", core: "warm", emotion: "thankful", strength: 0.3 },
      ],
    })).structuredContent as Record<string, unknown>;
    const f = out["feelings"] as Record<string, unknown>;
    const other = f["other"] as Record<string, unknown>[];
    expect(other.map((o) => o["note"])).toEqual([
      '"unclenched" is not on the feelings wheel, so it was kept as your own word.',
      '"gratefull" is not on the feelings wheel, so it was kept as your own word. If you meant grateful, say it that way next time.',
    ]);
    expect((f["readAs"] as Record<string, unknown>[])[0]).toMatchObject({ word: "thankful", as: "grateful" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — mood-matching
// ═══════════════════════════════════════════════════════════════════════════
const HOUR = 3_600_000;

function feeling(over: Partial<FeelingRow> & { whose: string; core: string; emotion: string; strength: number }): FeelingRow & {
  birth_day: number;
} {
  return {
    id: "fel_x",
    memory_id: "mem_x",
    other_word: null,
    beneath_id: null,
    carried_by: "",
    model: null,
    created_at: 0,
    updated_at: 0,
    source: "session",
    recorded_later: null,
    valence: null,
    core_v10: null,
    emotion_v10: null,
    birth_day: 0,
    ...over,
  };
}

/** A mood of these valences per person. */
const mood = (byPerson: Record<string, number[]>, sinceMs = 10 * HOUR): Mood => ({
  byPerson: new Map(Object.entries(byPerson)),
  sinceMs,
});
const SAD = -0.6;
const HAPPY = 0.7;

describe("mood-matching — the lift (recall G18)", () => {
  const t = RECALL;

  test("same person > the other person > no match", () => {
    const now = mood({ owner: [HAPPY] });
    const own = moodLift([feeling({ whose: "owner", core: "happy", emotion: "joyful", strength: 0.8 })], now, 0, t);
    const cross = moodLift([feeling({ whose: "self", core: "warm", emotion: "grateful", strength: 0.8 })], now, 0, t);
    const none = moodLift([feeling({ whose: "owner", core: "sad", emotion: "lonely", strength: 0.8 })], now, 0, t);
    expect(own).toBeCloseTo(t.MOOD_SAME_WEIGHT * 0.8, 10);
    expect(cross).toBeCloseTo(t.MOOD_CROSS_WEIGHT * 0.8, 10);
    expect(none).toBe(0);
    expect(own).toBeGreaterThan(cross);
  });

  test("by valence (wheel v2): neighbours match in part, opposites never, a writer's valence counts", () => {
    const at = (core: string, emotion: string, valence: number | null = null): number =>
      moodLift([feeling({ whose: "owner", core, emotion, strength: 1, valence })], mood({ owner: [SAD] }), 0, t);
    // A low mood meeting a low memory counts a quarter (the page: "a low mood can't feed itself").
    expect(t.MOOD_LOW_LOW_WEIGHT).toBe(0.25);
    expect(at("sad", "lonely")).toBeCloseTo(t.MOOD_SAME_WEIGHT * t.MOOD_LOW_LOW_WEIGHT, 10);
    // uneasy (−0.5) is 0.1 from sad (−0.6): most of a match, then the quarter.
    expect(at("uneasy", "worried")).toBeCloseTo(t.MOOD_SAME_WEIGHT * (1 - 0.1 / t.MOOD_VALENCE_SPAN) * t.MOOD_LOW_LOW_WEIGHT, 10);
    // A neutral feeling under a low mood is not damped: it is not low.
    expect(at("curious", "surprised")).toBe(0);
    expect(moodLift([feeling({ whose: "owner", core: "sad", emotion: "bittersweet", strength: 1 })], mood({ owner: [-0.2] }), 0, t)).toBeCloseTo(
      t.MOOD_SAME_WEIGHT * (1 - 0.2 / t.MOOD_VALENCE_SPAN),
      10,
    );
    expect(at("happy", "joyful")).toBe(0);
    expect(at("calm", "relieved")).toBe(0);
    // Curious and confused, one core, are far apart in feeling: no longer one match.
    const curious = (emotion: string): number =>
      moodLift([feeling({ whose: "owner", core: "curious", emotion, strength: 1 })], mood({ owner: [0.3] }), 0, t);
    expect(curious("interested")).toBeCloseTo(t.MOOD_SAME_WEIGHT, 10);
    expect(curious("confused")).toBe(0);
    // A "moved" the writer called mixed matches a mixed mood, not a happy one.
    expect(moodLift([feeling({ whose: "owner", core: "warm", emotion: "moved", strength: 1, valence: 0 })], mood({ owner: [HAPPY] }), 0, t)).toBe(0);
  });

  test("an old match lifts less (the feeling softened), and the mood itself never matches itself", () => {
    const f = [feeling({ whose: "owner", core: "sad", emotion: "lonely", strength: 0.8, birth_day: 0 })];
    const fresh = moodLift(f, mood({ owner: [SAD] }), 0, t);
    const month = moodLift(f, mood({ owner: [SAD] }), 30, t);
    // Lonely is unpleasant, so it softens on the faster clock.
    expect(month).toBeCloseTo(fresh * Math.exp(-30 / feelingSofteningDays(-0.6)), 10);
    expect(feelingSofteningDays(-0.6)).toBeLessThan(TUNABLES.S_FEELING);
    // Recorded INSIDE the window: it is the mood, not a memory of one.
    const inside = [feeling({ whose: "owner", core: "sad", emotion: "lonely", strength: 0.8, created_at: 11 * HOUR })];
    expect(moodLift(inside, mood({ owner: [SAD] }, 10 * HOUR), 0, t)).toBe(0);
  });
});

/** A synthetic candidate for the gate, as `recall.test.ts` builds them. */
function cand(id: string, spec: { cue: number; arrival?: number; sal: number; mood?: number }): Candidate {
  const cue = spec.cue;
  const arrival = spec.arrival ?? 0;
  const activation = cue + arrival;
  const doc: ProseDoc = { id, type: "memory", learnedOn: "2026-09-26", bornDay: 0, meta: {}, body: `body of ${id} with its own words` };
  return {
    id,
    kind: "fact",
    doc,
    physics: note(),
    strength: 0.3,
    sal: spec.sal,
    mood: spec.mood ?? 0,
    cue,
    temporal: 0,
    semantic: 0,
    arrival,
    hops: 0,
    activation,
    cueFraction: activation > 0 ? cue / activation : 0,
    matched: 1,
    trains: true,
    maxTier: "surfaced",
    confidential: false,
  };
}

describe("mood-matching never admits an uncued memory", () => {
  test("at the gate, in the RELATIVE regime: an uncued candidate with the largest possible mood lift is dark", () => {
    const t = withTunables();
    const cued = ["a", "b", "c", "d", "e"].map((id, i) => cand(id, { cue: 1 + i * 0.1, sal: 0.3 }));
    const uncued = cand("u", { cue: 0, arrival: 50, sal: 1, mood: 1 });
    const g = gate(
      { candidates: [...cued, uncued], state: freshGateState("s-gate"), storeSize: 200, owner: true, affectStated: false, turn: 1 },
      t,
    );
    expect(g.background.regime).toBe("relative");
    expect(g.verdicts.find((v) => v.id === "u")?.verdict).toBe("dark-uncued");
  });

  test("end to end: the mood lifts cued memories that carried it, and reaches nothing the turn did not", () => {
    let clock = Date.parse("2026-09-01T18:00:00Z");
    const s = store({ now: () => clock });
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const put = (body: string): string => s.put({ type: "memory", kind: "fact", body });
    const own = put("The kiln cracked the big bowl again during the glaze firing.");
    const twin = put("The kiln shelf was rearranged to fit the new tiles.");
    const cross = put("The kiln vent needs a new filter before the winter comes.");
    const happy = put("The kiln timer beeped twice at midnight during the long bisque.");
    const uncued = put("The glaze recipe book sits on the top shelf of the studio.");
    // Lonely and guilty under sad carry sad's valence (−0.6), the mood's: a whole match.
    s.addFeelings(own, [{ whose: "owner", core: "sad", emotion: "lonely", strength: 0.8 }]);
    s.addFeelings(cross, [{ whose: "self", core: "sad", emotion: "isolated", strength: 0.8 }]);
    s.addFeelings(happy, [{ whose: "owner", core: "happy", emotion: "joyful", strength: 0.8 }]);
    s.addFeelings(uncued, [{ whose: "owner", core: "sad", emotion: "lonely", strength: 1 }]);

    // No "the" in the turn: it is a (weak) cue, and it would reach every memory.
    const turn = { sessionId: "s1", text: "Any kiln news this week?", day: 0 };
    const r = new Recall({ store: s, owner: true });
    const before = r.build({ ...turn, sessionId: "before" }).decision;

    // Ten days on, the owner records feeling low — the mood, on a memory the turn never names.
    clock += 10 * 24 * HOUR;
    const moodNote = put("Feeling low about the studio today, nothing went right.");
    s.addFeelings(moodNote, [{ whose: "owner", core: "sad", emotion: "lonely", strength: 0.7 }]);
    // And one IN the window that the turn does name: it is the mood, not a match.
    const inWindow = put("The kiln day felt heavy from start to finish.");
    s.addFeelings(inWindow, [{ whose: "owner", core: "sad", emotion: "despair", strength: 0.7 }]);

    const after = r.build({ ...turn, sessionId: "after" }).decision;
    expect(after.background.regime).toBe("relative");
    const v = (d: typeof after, id: string) => d.verdicts.find((x) => x.id === id);

    expect(v(before, own)?.mood).toBeUndefined();
    // A low mood, low memories: a quarter of the lift (MOOD_LOW_LOW_WEIGHT).
    const low = RECALL.MOOD_LOW_LOW_WEIGHT;
    expect(v(after, own)?.mood).toBeCloseTo(RECALL.MOOD_SAME_WEIGHT * 0.8 * low, 10);
    expect((v(after, own)?.sal ?? 0) - (v(before, own)?.sal ?? 0)).toBeCloseTo(RECALL.MOOD_SAME_WEIGHT * 0.8 * low, 10);
    expect(v(after, cross)?.mood).toBeCloseTo(RECALL.MOOD_CROSS_WEIGHT * 0.8 * low, 10);
    expect(v(after, happy)?.mood).toBeUndefined();
    expect(v(after, twin)?.mood).toBeUndefined();
    expect(v(after, inWindow)?.mood).toBeUndefined();
    // The uncued memory carries the strongest matching feeling in the store and
    // is not a candidate at all: the mood touched salience, never activation.
    expect(v(after, uncued)).toBeUndefined();
    expect(v(after, moodNote)).toBeUndefined();
    // Same store, same turn, the mood switched off (no feeling is strong enough
    // to set one): every activation — so every candidate — is identical. The
    // mood moved salience and nothing else.
    const moodless = new Recall({ store: s, owner: true, tunables: { MOOD_MIN_STRENGTH: 2 } }).build({ ...turn, sessionId: "moodless" }).decision;
    const activations = (d: typeof after): Map<string, number> => new Map(d.verdicts.map((x) => [x.id, x.activation]));
    expect(activations(moodless)).toEqual(activations(after));
    expect(moodless.verdicts.every((x) => x.mood === undefined)).toBe(true);
    // The durable count is the admitted, lifted ones.
    const admittedLifted = after.verdicts.filter((x) => (x.verdict === "surfaced" || x.verdict === "footnoted") && (x.mood ?? 0) > 0);
    expect(after.moodMatched).toBe(admittedLifted.length);

    // Four hours later the mood has passed: nothing is lifted.
    clock += 4 * HOUR;
    const later = r.build({ ...turn, sessionId: "later" }).decision;
    expect(later.verdicts.every((x) => x.mood === undefined)).toBe(true);
    expect(later.moodMatched).toBe(0);
  });

  test("the turn gate reads recorded feelings as the emotional dimension when the turn is felt (§9 G10)", () => {
    const p = note({ feelingPeak: 0.9 });
    expect(gatedSal(p, false)).toBeCloseTo(sal({ ...p.salience, emotional: 0 }), 10);
    expect(gatedSal(p, true)).toBeCloseTo(sal({ ...p.salience, emotional: 0.9 }), 10);
  });
});

const FILLER: readonly string[] = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
  "The kitchen tap drips when the pressure is high.",
  "Set up a standing desk in the spare bedroom.",
  "The bus route changed and adds ten minutes.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

// ═══════════════════════════════════════════════════════════════════════════
// 6 — showing it
// ═══════════════════════════════════════════════════════════════════════════
describe("showing it", () => {
  test("the line: you first, then me, recorded strength and — once it has moved — now", () => {
    const rows = [
      { whose: "self", core: "warm", emotion: "tender", other_word: null, strength: 0.4 },
      { whose: "owner", core: "uneasy", emotion: "fear.insecure", other_word: null, strength: 0.6 },
      { whose: "owner", core: "uneasy", emotion: "other", other_word: "caught", strength: 0.5 },
    ];
    expect(feelingsLine(rows, 0)).toBe("you: insecure 0.6, caught 0.5 · me: tender 0.4");
    expect(feelingsLine(rows, 14)).toBe("you: insecure 0.6 (now 0.3), caught 0.5 (now 0.2) · me: tender 0.4 (now 0.2)");
    // The same strength, a month on: the unpleasant one has softened further (wheel v2).
    const pair = [
      { whose: "owner", core: "angry", emotion: "frustrated", other_word: null, strength: 0.9 },
      { whose: "self", core: "happy", emotion: "joyful", other_word: null, strength: 0.9 },
    ];
    expect(feelingsLine(pair, 30)).toBe("you: frustrated 0.9 (now 0.1) · me: joyful 0.9 (now 0.3)");
    expect(feelingsLine([], 0)).toBe("");
  });

  test("the mechanisms line: a memory with feeling written this week lights Emotion", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "the first clean firing in a month" });
    s.addFeelings(id, [{ whose: "owner", core: "happy", emotion: "relieved", strength: 0.8 }]);
    s.put({ type: "memory", kind: "fact", body: "an ordinary note with no feeling on it" });
    const report = firedReport(s, s.today());
    const byId = new Map(report.rows.map((r) => [r.id, r]));
    expect(byId.get("feelings")?.total).toBe(1);
    expect(byId.get("emotion-weight")?.total).toBe(1);
    const line = mechanismsLines(report, consoleVerdicts(s, s.today())).find((l) => l.includes("Emotion")) ?? "";
    expect(line.startsWith("●")).toBe(true);
    expect(line).toContain("1 new memory carrying feeling");
    expect(line).toContain("1 memory held higher and fading slower (1 with recorded feelings)");
    expect(s.emotionCensus()).toEqual({ withFeelings: 1, weighted: 1 });
  });

  test("the dashboard's memory view carries the line and the intensity; the emotional light has a census", () => {
    const s = Store.open({ dir });
    const id = s.put({ type: "memory", kind: "fact", body: "The kiln came back up to temperature after the repair." });
    s.addFeelings(id, [
      { whose: "owner", core: "happy", emotion: "relieved", strength: 0.8 },
      { whose: "self", core: "sad", emotion: "wistful", strength: 0.3 },
    ]);
    s.close();
    const dash = Dashboard.open({ dir });
    try {
      const d = memoryDetail(dash.source, id);
      expect(d.feelingsLine).toBe("you: relieved 0.8 · me: wistful 0.3");
      expect(d.intensity).toBeCloseTo(0.8, 10);
      const emo = mechanismsView(dash.source).mechanisms.find((m) => m.id === "emotional");
      expect(emo?.status).toBe("green");
      expect(emo?.evidence).toContain("1 new memory held higher and fading slower for the feeling it carries");
    } finally {
      dash.close();
    }
  });

  test("ask --id shows the feelings as you: … · me: …", async () => {
    const s = Store.open({ dir });
    const id = s.put({ type: "memory", kind: "fact", body: "The lighthouse keeper's log came back from the archive." });
    s.addFeelings(id, [
      { whose: "owner", core: "happy", emotion: "moved", strength: 0.7 },
      { whose: "self", core: "happy", emotion: "curious", strength: 0.5 },
    ]);
    s.close();
    const out: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: () => {} };
    const code = await run(["ask", "--id", id, "--dir", dir], {
      io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: join(dir, "home"),
    });
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("feelings — you: moved 0.7 · me: curious 0.5"))).toBe(true);
  });
});
