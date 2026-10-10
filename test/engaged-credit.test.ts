/**
 * G1b, 2026-10-10 — ENGAGED CREDIT: a reply that DREW ON a footnoted or loud
 * memory (a rare title phrase, or two rare title words, new to the prompt)
 * earns it half a use. Review 05 C1–C5; the synthesis's group 1 item 9.
 *
 * Revised by b2+f8, 2026-10-10, from Mike's 09-14 ruling, lightly held. Why:
 * deposit can't work otherwise; the ~0.8 precision bar and the saturating cap
 * keep the anti-rich-get-richer intent.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, RECALL_CREDIT_EVENT } from "../src/core/counterpart.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import {
  ENGAGED_MAX_PER_BOUNDARY,
  ENGAGED_RARE_MIN_DF,
  ENGAGED_RARE_SHARE,
  engagementTitleWords,
  resolveEngagement,
} from "../src/core/recall/reference.js";
import type { EngagementCandidate } from "../src/core/recall/reference.js";
import { TUNABLES, creditReturn, creditUse, rep } from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";

// ── the pure rule ────────────────────────────────────────────────────────────

/** A df map where every listed word is rare (in one memory) and every other word is everywhere. */
function rareDf(rare: readonly string[], common: readonly string[] = []): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of rare) m.set(w, 1);
  for (const w of common) m.set(w, 1000);
  return m;
}

const PRUNE: EngagementCandidate = {
  id: "mem_aaaaaaaaaaaa",
  title: "The orchard ladder came back from the repair shop with a new rung",
  shownTurn: 4,
};
const DF = rareDf(["orchard", "ladder", "repair", "rung"], ["came", "back", "shop", "new"]);

describe("resolveEngagement — the drew-on rule (review 05 R6)", () => {
  test("a rare title phrase in the reply, new to the prompt, engages", () => {
    const r = resolveEngagement({
      replyTexts: ["Then take the orchard ladder; it is fixed now."],
      promptTexts: ["what should I use to pick the high apples?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(r.engaged.map((e) => [e.memoryId, e.rule])).toEqual([[PRUNE.id, "phrase"]]);
    expect(r.engaged[0]?.how).toBe("engaged");
  });

  test("the same words, said first by the person, are the conversation's — no credit", () => {
    const r = resolveEngagement({
      replyTexts: ["Then take the orchard ladder; it is fixed now."],
      promptTexts: ["is the orchard ladder back yet?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(r.engaged).toEqual([]);
  });

  test("two rare title words in the reply's text engage without a phrase", () => {
    const r = resolveEngagement({
      replyTexts: ["The repair added a rung, so it should hold you."],
      promptTexts: ["can I climb it?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(r.engaged.map((e) => e.rule)).toEqual(["words"]);
    expect(r.engaged[0]?.rareWords).toBe(2);
  });

  test("one rare word alone is co-mention, not engagement", () => {
    const r = resolveEngagement({
      replyTexts: ["That needs a repair."],
      promptTexts: ["the gate is broken"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(r.engaged).toEqual([]);
  });

  test("in a tool call only a PHRASE counts: two loose rare words there do not", () => {
    const loose = resolveEngagement({
      replyTexts: ["Checking."],
      toolTexts: [JSON.stringify({ command: "ls ~/repair && cat ~/rung.txt" })],
      promptTexts: ["what is in the shed?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(loose.engaged).toEqual([]);
    const phrase = resolveEngagement({
      replyTexts: ["Checking."],
      toolTexts: [JSON.stringify({ command: "python3 tools/orchard_ladder.py --status" })],
      promptTexts: ["what is in the shed?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(phrase.engaged.map((e) => e.rule)).toEqual(["phrase"]);
  });

  test("a phrase split across two texts is not a phrase", () => {
    // Only "orchard" is rare here, so the phrase is the one way in.
    const df = rareDf(["orchard"], ["ladder"]);
    const split = resolveEngagement({
      replyTexts: ["We went to the orchard", "ladder sales were down"],
      promptTexts: [""],
      candidates: [PRUNE],
      df,
      storeSize: 1000,
    });
    expect(split.engaged).toEqual([]);
    const whole = resolveEngagement({ replyTexts: ["We went to the orchard ladder sale"], promptTexts: [""], candidates: [PRUNE], df, storeSize: 1000 });
    expect(whole.engaged.map((e) => e.rule)).toEqual(["phrase"]);
  });

  test("an id typed into the reply never counts (U5: ids echoed unread)", () => {
    const id = "mem_0123456789ab";
    const r = resolveEngagement({
      replyTexts: [`See [${id}] and [${id}].`],
      promptTexts: [""],
      candidates: [{ id, title: `${id} ${id}`, shownTurn: 1 }],
      df: rareDf(["0123456789ab", "mem"]),
      storeSize: 1000,
    });
    expect(r.engaged).toEqual([]);
  });

  test("a recall or wake block pasted back whole is the display, not a draw (review of #371)", () => {
    const block = [
      "<!-- counterparts:recall t=4 -->",
      "Quietly available (in the background; draw on what helps, open an id before relying on one):",
      `- ${PRUNE.title} [${PRUNE.id}]`,
      "<!-- counterparts:recall/end surfaced=0 footnotes=1 affect=0 bytes=120 -->",
    ].join("\n");
    const echoed = resolveEngagement({
      replyTexts: [`Here is exactly what I saw:\n${block}`],
      toolTexts: [JSON.stringify({ prompt: `Sample of the lane:\n${block}` })],
      promptTexts: ["what did you see?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(echoed.engaged).toEqual([]);
    const wake = resolveEngagement({
      replyTexts: [`<!-- counterparts:wake day=3 elements=1 bytes=90 -->\n- ${PRUNE.title}\n<!-- counterparts:wake/end day=3 elements=1 bytes=90 -->`],
      promptTexts: ["what did you wake with?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(wake.engaged).toEqual([]);
    // Outside the markers the same words still count.
    const drawn = resolveEngagement({
      replyTexts: [`${block}\nSo the orchard ladder is back; I'll use the new rung.`],
      promptTexts: ["what did you see?"],
      candidates: [PRUNE],
      df: DF,
      storeSize: 1000,
    });
    expect(drawn.engaged.map((e) => e.memoryId)).toEqual([PRUNE.id]);
  });

  test("common words never make a phrase: rarity is the share of the store, with a floor for a young store", () => {
    const common = { id: "mem_bbbbbbbbbbbb", title: "Came back from the shop", shownTurn: 1 };
    const r = resolveEngagement({
      replyTexts: ["It came back from the shop yesterday."],
      promptTexts: [""],
      candidates: [common],
      df: DF,
      storeSize: 1000,
    });
    expect(r.engaged).toEqual([]);
    // The bar: a share of the store, never below the floor.
    expect(ENGAGED_RARE_SHARE).toBe(0.03);
    expect(ENGAGED_RARE_MIN_DF).toBe(2);
    const young = resolveEngagement({
      replyTexts: ["Then take the orchard ladder."],
      promptTexts: [""],
      candidates: [PRUNE],
      df: new Map([
        ["orchard", 2],
        ["ladder", 2],
      ]),
      storeSize: 10,
    });
    expect(young.engaged.length).toBe(1);
    const tooCommon = resolveEngagement({
      replyTexts: ["Then take the orchard ladder."],
      promptTexts: [""],
      candidates: [PRUNE],
      df: new Map([
        ["orchard", 3],
        ["ladder", 3],
      ]),
      storeSize: 10,
    });
    expect(tooCommon.engaged).toEqual([]);
  });

  test("a word the index does not know is NOT rare (precision over recall)", () => {
    const r = resolveEngagement({
      replyTexts: ["Then take the orchard ladder."],
      promptTexts: [""],
      candidates: [PRUNE],
      df: new Map(),
      storeSize: 1000,
    });
    expect(r.engaged).toEqual([]);
  });

  test("strongest first: a phrase before two words, then more rare words, then the newer showing", () => {
    const words = { id: "mem_cccccccccccc", title: "Beekeeping smoker fuel: pine needles", shownTurn: 9 };
    const r = resolveEngagement({
      replyTexts: ["Use pine needles in the smoker. And the orchard ladder for the hive on the wall."],
      promptTexts: [""],
      candidates: [words, PRUNE],
      df: rareDf(["orchard", "ladder", "beekeeping", "smoker", "pine", "needles"]),
      storeSize: 1000,
    });
    expect(r.engaged.map((e) => e.memoryId)).toEqual([words.id, PRUNE.id]);
    // Both match by phrase here ("pine needles"); the one with more rare words leads.
    expect(r.engaged.map((e) => e.rule)).toEqual(["phrase", "phrase"]);
  });

  test("the title words it asks df for are the non-numeric content words", () => {
    expect(engagementTitleWords("PR #301: the 2026 wheel v2 for the dashboard").sort()).toEqual(["dashboard", "wheel"]);
  });
});

// ── physics: the tier, the return, the curve ─────────────────────────────────

function phys(over: Partial<MemoryPhysics> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: { novelty: null, relevance: 0.5, emotional: 0.5, predictive: 0.5 },
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    consolidated: false,
    promotedIdentity: false,
    ...over,
  } as MemoryPhysics;
}

describe("physics — the engaged tier (G1b)", () => {
  test("an engaged use is half a use, restarts the clock and counts the day", () => {
    const out = creditUse(phys({ uses: 1, lastUsedDay: 2, reinforcedDays: 1 }), 5, "engaged");
    expect(out.credited).toBe(true);
    expect(out.w).toBe(TUNABLES.W_ENGAGED);
    expect(out.next).toEqual({ uses: 1.5, lastUsedDay: 5, reinforcedDays: 2 });
  });

  test("display alone still trains nothing", () => {
    expect(creditUse(phys(), 5, "footnoted").credited).toBe(false);
  });

  test("a referenced use lifts today's engaged credit; without the lift it is refused as before", () => {
    const m = phys({ uses: 1.5, lastUsedDay: 5, reinforcedDays: 2 });
    expect(creditUse(m, 5, "referenced").reason).toBe("already-credited-today");
    const lifted = creditUse(m, 5, "referenced", { upgradeFrom: "engaged" });
    expect(lifted.credited).toBe(true);
    expect(lifted.next).toEqual({ uses: 2, lastUsedDay: 5, reinforcedDays: 2 });
    // Never downward, never sideways.
    expect(creditUse(m, 5, "engaged", { upgradeFrom: "referenced" }).credited).toBe(false);
    expect(creditUse(m, 5, "engaged", { upgradeFrom: "engaged" }).credited).toBe(false);
  });

  test("an engaged return is half a return, spaced, and touches no core-lane field", () => {
    const m = phys({ birthDay: 0, returns: 0, returnDays: 0, firstReturnDay: null, lastReturnDay: null, lastDreamDay: null });
    const r = creditReturn(m, 7, { source: "engaged" });
    expect(r.counted).toBe(true);
    expect(r.weight).toBeCloseTo(TUNABLES.ENGAGED_RETURN_WEIGHT * (1 - Math.exp(-7 / TUNABLES.RETURN_SPACING_DAYS)), 10);
    expect(r.next.returnDays).toBe(0);
    expect(r.next.lastReturnDay).toBe(null);
    expect(r.next.firstReturnDay).toBe(null);
    expect(r.next.lastDreamDay).toBe(null);
    // Spaced from the last return of ANY kind: an engaged one yesterday (`since`) leaves little.
    const soon = creditReturn(m, 7, { source: "engaged", since: 6 });
    expect(soon.weight).toBeCloseTo(TUNABLES.ENGAGED_RETURN_WEIGHT * (1 - Math.exp(-1 / TUNABLES.RETURN_SPACING_DAYS)), 10);
    // A day that already counted a return (here a dream's) counts no engaged one.
    expect(creditReturn({ ...m, lastDreamDay: 7 }, 7, { source: "engaged" }).reason).toBe("already-returned-today");
  });

  test("the repetition arm saturates: 0.5·(1 − e^(−uses/3)), each use adding less", () => {
    expect(rep({ uses: 0 })).toBe(0);
    expect(rep({ uses: 1 })).toBeCloseTo(0.5 * (1 - Math.exp(-1 / 3)), 10);
    expect(rep({ uses: 2 })).toBeCloseTo(0.2433, 3);
    expect(rep({ uses: 5 })).toBeCloseTo(0.4055, 3);
    const gain = (n: number): number => rep({ uses: n }) - rep({ uses: n - 1 });
    expect(gain(5)).toBeLessThan(gain(1) / 2);
    expect(rep({ uses: 100 })).toBeLessThanOrEqual(TUNABLES.REP_CAP);
  });
});

// ── the store and the credit seam ────────────────────────────────────────────

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-engaged-credit-"));
  process.env[ENV] = dir;
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
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true });
  open.push(c);
  return c;
}

function fact(c: Counterpart, title: string, body: string): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    title,
    body,
    salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
  });
}

/** Unrelated memories, so the store's rarity bar means something. */
function filler(c: Counterpart, n: number): void {
  for (let i = 0; i < n; i++) fact(c, `Routine note ${i}`, `A routine note about the weekly meeting, number ${i}.`);
}

function shown(c: Counterpart, sessionId: string, turn: number, records: GateState["surfaced"]): void {
  const prior = loadGateState(c.store, sessionId).state;
  saveGateState(
    c.store,
    { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced: { ...prior.surfaced, ...records } },
    200,
  );
}

function setup(): { c: Counterpart; ladder: string; hive: string } {
  const c = brain();
  c.store.advanceClock("2026-08-25");
  const ladder = fact(c, "The orchard ladder came back from repair with a new rung", "Picked up Tuesday; the third rung was replaced.");
  const hive = fact(c, "Beekeeping smoker fuel: pine needles burn cool", "Dry pine needles, packed loosely, give the coolest smoke.");
  filler(c, 30);
  c.store.advanceClock("2026-08-26");
  return { c, ladder, hive };
}

describe("creditReferences — the third door, credited", () => {
  test("a footnote the reply drew on is credited ENGAGED: half a use, an engaged return, `how` on the summary", () => {
    const { c, ladder, hive } = setup();
    shown(c, "s1", 1, {
      [ladder]: { turn: 1, tier: "footnoted", trains: true },
      [hive]: { turn: 1, tier: "footnoted", trains: true },
    });
    const s = c.creditReferences("s1", {
      assistantTurns: ["Take the orchard ladder, it is fixed."],
      expansions: [],
      userTurns: ["how do I reach the high branches?"],
    });
    expect(s.engaged).toBe(1);
    expect(s.credited).toBe(1);
    expect(s.ids).toEqual([ladder]);
    expect(s.how).toEqual(["engaged"]);
    expect(s.reason).toBe("credited");
    const row = c.store.row(ladder);
    expect(row?.uses).toBe(0.5);
    expect(row?.last_used_day).toBe(c.store.livedDay());
    const rets = c.store.returnsOf(ladder);
    expect(rets.map((r) => r.source)).toEqual(["engaged"]);
    expect(row?.return_days).toBe(0);
    // The hive footnote was shown and not drawn on: nothing.
    expect(c.store.row(hive)?.uses).toBe(0);
    expect(s.shownNotUsed).toEqual([hive]);
  });

  test("display alone credits nothing: no reply that draws on it, no credit", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    const s = c.creditReferences("s1", { assistantTurns: ["Sure, let's start with the budget."], expansions: [], userTurns: ["hi"] });
    expect(s.engaged).toBe(0);
    expect(s.credited).toBe(0);
    expect(c.store.row(ladder)?.uses).toBe(0);
  });

  test("no prompt text, no engaged credit (a caller that cannot say what the person typed)", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    const s = c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [] });
    expect(s.engaged).toBe(0);
  });

  test("an expansion and an engagement of the same memory credit once, as expanded", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    const s = c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [ladder], userTurns: ["x"] });
    expect(s.ids).toEqual([ladder]);
    expect(s.how).toEqual(["expanded"]);
    expect(c.store.row(ladder)?.uses).toBe(1);
  });

  test("engaged at one boundary, expanded at the next the same day: the day is lifted to a full use and one awake return", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [], userTurns: ["x"] });
    expect(c.store.row(ladder)?.uses).toBe(0.5);
    const s = c.creditReferences("s1", { assistantTurns: [], expansions: [ladder], userTurns: [] });
    expect(s.credited).toBe(1);
    expect(s.how).toEqual(["expanded"]);
    const row = c.store.row(ladder);
    expect(row?.uses).toBe(1);
    expect(row?.reinforced_days).toBe(1);
    expect(c.store.returnsOf(ladder).map((r) => r.source)).toEqual(["awake"]);
    expect(row?.return_days).toBe(1);
  });

  test("once per lived day: drawn on again the same day, refused", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [], userTurns: ["x"] });
    shown(c, "s1", 2, {});
    const again = c.creditReferences("s1", { assistantTurns: ["The orchard ladder again."], expansions: [], userTurns: ["y"] });
    expect(again.credited).toBe(0);
    expect(c.store.row(ladder)?.uses).toBe(0.5);
  });

  test(`at most ${ENGAGED_MAX_PER_BOUNDARY} engaged credits per boundary; opened ones are never capped`, () => {
    const c = brain();
    c.store.advanceClock("2026-08-25");
    const ids: string[] = [];
    const words = ["quince", "medlar", "loquat", "pawpaw", "feijoa"];
    for (const w of words) ids.push(fact(c, `The ${w} tree in the north corner`, `Planted the ${w} in spring.`));
    filler(c, 40);
    c.store.advanceClock("2026-08-26");
    const surfaced: GateState["surfaced"] = {};
    for (const id of ids) surfaced[id] = { turn: 1, tier: "footnoted", trains: true };
    shown(c, "s1", 1, surfaced);
    const s = c.creditReferences("s1", {
      assistantTurns: [words.map((w) => `the ${w} tree is fine`).join(". ")],
      expansions: [],
      userTurns: ["how is the garden?"],
    });
    expect(s.engaged).toBe(5);
    expect(s.credited).toBe(ENGAGED_MAX_PER_BOUNDARY);
    expect(s.engagedCapped).toBe(5 - ENGAGED_MAX_PER_BOUNDARY);
  });

  test("never revives what a newer memory replaced: superseded or faded-under-newer is refused by name", () => {
    const { c, ladder, hive } = setup();
    c.store.updatePhysics(hive, { fade: 0.5 });
    shown(c, "s1", 1, {
      [ladder]: { turn: 1, tier: "footnoted", trains: true },
      [hive]: { turn: 1, tier: "footnoted", trains: true },
    });
    const s = c.creditReferences("s1", {
      assistantTurns: ["Use pine needles in the smoker, and the orchard ladder."],
      expansions: [],
      userTurns: ["x"],
    });
    expect(s.ids).toEqual([ladder]);
    expect(s.refused["faded-under-newer"]).toBe(1);
    expect(c.store.row(hive)?.uses).toBe(0);

    // Superseded: the newer version is the one that holds.
    const head = c.store.supersede(ladder, {
      type: "memory",
      kind: "fact",
      title: "The orchard ladder came back from repair with two new rungs",
      body: "Picked up Wednesday after all.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    });
    expect(c.store.row(ladder)?.superseded_by).toBe(head);
    c.store.advanceClock("2026-08-27");
    shown(c, "s1", 2, { [ladder]: { turn: 2, tier: "footnoted", trains: true } });
    const later = c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [], userTurns: ["x"] });
    expect(later.credited).toBe(0);
    // A superseded row is archived in this store, so it is not even a
    // candidate; the `superseded` refusal is the second lock for any row that
    // carries the pointer and stays live.
    expect(later.engaged).toBe(0);
    expect(c.store.row(ladder)?.uses).toBe(0.5);
  });

  test("the window: a footnote shown long before the judged stretch is not a candidate", () => {
    const { c, ladder } = setup();
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    // Judge turns 1..6 with replies that do not draw on it.
    shown(c, "s1", 6, {});
    c.creditReferences("s1", { assistantTurns: ["unrelated"], expansions: [], userTurns: ["x"] });
    shown(c, "s1", 7, {});
    const s = c.creditReferences("s1", { assistantTurns: ["Take the orchard ladder."], expansions: [], userTurns: ["x"] });
    expect(s.engaged).toBe(0);
  });

  test("words past the footnote's clip were never shown, so they never match", () => {
    const c = brain();
    c.store.advanceClock("2026-08-25");
    const pad = "a ".repeat(80);
    const long = fact(c, `${pad}and the zeppelin hangar`, "body");
    filler(c, 30);
    c.store.advanceClock("2026-08-26");
    shown(c, "s1", 1, { [long]: { turn: 1, tier: "footnoted", trains: true } });
    const s = c.creditReferences("s1", { assistantTurns: ["The zeppelin hangar is huge."], expansions: [], userTurns: ["x"] });
    expect(s.engaged).toBe(0);
  });
});

// ── the host seam: tool inputs and the boundary's row ────────────────────────

describe("transcript and boundary (G1b)", () => {
  test("tool inputs ride beside the turns, positioned like expansions; this package's own tools are left out", () => {
    const lines = [
      { type: "user", message: { role: "user", content: "check the ladder" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "python3 tools/orchard_ladder.py" } },
            { type: "tool_use", id: "t2", name: "mcp__counterparts__session_end", input: { memories: [{ title: "x" }] } },
          ],
        },
      },
    ];
    const read = parseTranscript(lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(read.toolInputs?.length).toBe(1);
    expect(read.toolInputs?.[0]?.text).toContain("orchard_ladder");
    expect(read.toolInputs?.[0]?.atTurn).toBe(2);
    // The turn list does not grow (a live cursor indexes it).
    expect(read.turns.length).toBe(2);
  });

  test("the plugin install's names for this package's tools are left out too (review of #371)", () => {
    // Under the Claude Code plugin the same server's tools are
    // `mcp__plugin_counterparts_counterparts__<tool>` (docs/plugin.md). A
    // write-up restating a footnote must not train it there either.
    const lines = [
      { type: "user", message: { role: "user", content: "wrap up" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Writing it up." },
            {
              type: "tool_use",
              id: "t1",
              name: "mcp__plugin_counterparts_counterparts__session_end",
              input: { memories: [{ title: "The orchard ladder came back from repair" }] },
            },
            { type: "tool_use", id: "t2", name: "mcp__plugin_counterparts_counterparts__chapter", input: { title: "Day 3", text: "orchard ladder" } },
            { type: "tool_use", id: "t3", name: "mcp__plugin_other_tools__lookup", input: { query: "orchard ladder" } },
          ],
        },
      },
    ];
    const read = parseTranscript(lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(read.toolInputs?.map((t) => t.text)).toEqual([JSON.stringify({ query: "orchard ladder" })]);
  });

  test("a Stop's recall.credit row says how each credit was earned", () => {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
    );
    open.push(a.counterpart);
    const c = a.counterpart;
    c.store.advanceClock("2026-08-25");
    const ladder = fact(c, "The orchard ladder came back from repair with a new rung", "Picked up Tuesday.");
    filler(c, 30);
    c.store.advanceClock("2026-08-26");
    shown(c, "s1", 1, { [ladder]: { turn: 1, tier: "footnoted", trains: true } });
    const hook: HookInput = {
      sessionId: "s1",
      scope: "proj",
      at: "2026-08-26",
      turns: [
        { role: "user", text: "How do I reach the high branches?" },
        { role: "assistant", text: "Checking the shed first." },
      ],
      toolInputs: [{ atTurn: 2, text: JSON.stringify({ command: "ls ~/shed/orchard-ladder" }) }],
    };
    recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
    a.stop(hook);
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["engaged"]).toBe(1);
    expect(payload["ids"]).toEqual([ladder]);
    expect(payload["how"]).toEqual(["engaged"]);
    expect(payload["engagedCapped"]).toBe(0);
  });
});
