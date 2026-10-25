/**
 * N1 (2026-10-25): WHAT STOPPED A MEMORY, COUNTED — observation only. Each
 * `recall.decision` row carries, beside `echoSkipped` and `projectSkipped`,
 * how many candidates habituation alone, a near miss of the bar (with the
 * margin used), a full tier, the render's bytes and lateral inhibition kept
 * from showing; `adapter.recall` carries the same counts flat, with who
 * started the turn (`startedBy`).
 *
 * The guarantee is that this is ONLY observation: the same prompts, through
 * the real UserPromptSubmit hook and the real delivery (`deliverTurn`), on two
 * byte-identical stores, one counting and one with the counting switched off
 * (`recall.STOP_COUNTS`), hand over the same bytes, the same memories in the
 * same order, and write decision rows that differ by the new keys alone.
 *
 * Hermetic: every test opens fresh temp data dirs and removes them; nothing
 * here can reach a live store.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { deliverTurn } from "../src/adapters/claude-code/envelope.js";
import { RECALL_DECISION_EVENT, RECALL_DECISION_FIELDS, RECALL_DELIVERED_EVENT } from "../src/core/counterpart-events.js";
import type { RecallResult } from "../src/core/recall/index.js";
import { TUNABLES as RECALL, stopCounts } from "../src/core/recall/index.js";
import type { CandidateVerdict } from "../src/core/recall/gate.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/bakery";
const ZONE = "America/Denver";
const NEW_KEYS = ["habituationCut", "nearMiss", "capped", "budgetTrimmed", "inhibited"] as const;

/** Ordinary background, so rarity can discriminate (recall §9 G4). */
const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The bread flour is kept in the second cupboard.",
];

/** What the prompts reach: several, so a tier can fill and a budget can bind. */
const BAKERY = [
  "The sourdough starter died after two weeks of neglect in the cold pantry.",
  "A sourdough starter wants feeding twice a day when it lives on the counter.",
  "The rye levain doubled overnight once it moved beside the warm oven.",
  "Sourdough loaves spread flat when the starter is past its peak.",
  "The pantry runs cold in winter, which slows every starter and dough.",
  "Feeding the starter with whole wheat flour made it rise faster.",
  "The oven's warm spot is the top shelf near the back wall.",
  "A neglected starter can be revived with three days of steady feeding.",
];

const PROMPTS = [
  "my sourdough starter died in the pantry, what went wrong?",
  "how should I feed a starter so the loaves don't spread flat?",
  "is the warm oven a good place for the rye levain?",
];

let root: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-near-miss-"));
  setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
});

afterEach(() => {
  setSystemTime();
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

type Adapter = ReturnType<typeof openAdapter>;

function config(dir: string, budget: number): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: budget, timeZone: ZONE };
}

function open(dir: string, budget = 9_000): Adapter {
  const a = openAdapter(config(dir, budget), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** One seeded store, closed, copied byte for byte: the two runs start identical. */
function twins(budget = 9_000): { on: Adapter; off: Adapter } {
  const seed = join(root, "seed");
  const a = open(seed);
  findable(a.counterpart.store);
  for (const body of [...FILLER, ...BAKERY]) a.counterpart.store.put({ type: "memory", kind: "fact", body });
  a.counterpart.close();
  cpSync(seed, join(root, "on"), { recursive: true });
  cpSync(seed, join(root, "off"), { recursive: true });
  const on = open(join(root, "on"), budget);
  const off = open(join(root, "off"), budget);
  return { on, off };
}

function tune(a: Adapter, values: Partial<Record<keyof typeof RECALL, unknown>>): void {
  Object.assign(a.counterpart.recall.tunables as unknown as Record<string, unknown>, values);
}

function hookInput(dir: string, session: string, text: string, env: Record<string, string> = { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }) {
  return toHookInput({ session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text }, { scope: SCOPE, timeZone: ZONE, env, dataDir: dir });
}

/** One prompt through the hook AND the real delivery: what the host would print. */
function turn(a: Adapter, session: string, text: string, env?: Record<string, string>) {
  const input = hookInput(a.counterpart.store.dir, session, text, env);
  const out = a.userPromptSubmit(input);
  const delivered = deliverTurn("user-prompt-submit", out, {}, null, a, input);
  return { out, stdout: delivered.stdout };
}

function rows(a: Adapter, name: string): Record<string, unknown>[] {
  return a.counterpart.store.eventLog({ name, order: "asc" }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

function without(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Captures the in-process decision of each hook turn (verdicts and trims), leaving the call as it was. */
function capture(a: Adapter): RecallResult[] {
  const seen: RecallResult[] = [];
  const c = a.counterpart as unknown as { recallForTurn: (...args: unknown[]) => RecallResult };
  const real = c.recallForTurn.bind(a.counterpart);
  c.recallForTurn = (...args: unknown[]) => {
    const r = real(...args);
    seen.push(r);
    return r;
  };
  return seen;
}

describe("N1: what stopped a memory is counted, and only counted", () => {
  test("the same prompts through the hook: identical bytes and memories with the counts on and off; rows differ by the new keys only", () => {
    const { on, off } = twins();
    tune(off, { STOP_COUNTS: false });
    // Tight enough that every count has something to say (a full tier, a
    // budget that binds, a wide margin), so "identical" is not "nothing ran".
    for (const a of [on, off]) tune(a, { SNR_GLOBAL: 0.3, MAX_FOOTNOTES: 2, MAX_SURFACED: 1, NEAR_MISS_MARGIN: 0.9 });

    let shown = 0;
    for (const text of PROMPTS) {
      const a = turn(on, "s-1", text);
      const b = turn(off, "s-1", text);
      expect(Buffer.compare(Buffer.from(a.stdout, "utf8"), Buffer.from(b.stdout, "utf8"))).toBe(0);
      expect(a.out.injection).toBe(b.out.injection);
      expect(a.out.surfaced).toEqual(b.out.surfaced);
      expect(a.out.footnotes).toEqual(b.out.footnotes);
      expect(a.out.bytes).toBe(b.out.bytes);
      expect(a.out.sentinel).toBe(b.out.sentinel);
      expect(a.out.reason).toBe(b.out.reason);
      shown += a.out.surfaced.length + a.out.footnotes.length;
    }
    expect(shown).toBeGreaterThan(0);

    const dOn = rows(on, RECALL_DECISION_EVENT);
    const dOff = rows(off, RECALL_DECISION_EVENT);
    expect(dOn.length).toBe(PROMPTS.length);
    expect(dOff.length).toBe(PROMPTS.length);
    for (let i = 0; i < dOn.length; i++) {
      const rowOn = dOn[i] as Record<string, unknown>;
      const rowOff = dOff[i] as Record<string, unknown>;
      for (const k of NEW_KEYS) {
        expect(k in rowOn).toBe(true);
        expect(k in rowOff).toBe(false);
      }
      expect(without(rowOn, [...NEW_KEYS, "elapsedMs"])).toEqual(without(rowOff, ["elapsedMs"]));
    }
    // Something was stopped on the counting side, and said so.
    const stopped = dOn.reduce((n, r) => n + (r["capped"] as number) + ((r["nearMiss"] as { count: number }).count) + (r["budgetTrimmed"] as number), 0);
    expect(stopped).toBeGreaterThan(0);

    const aOn = rows(on, RECALL_DELIVERED_EVENT);
    const aOff = rows(off, RECALL_DELIVERED_EVENT);
    expect(aOn.length).toBe(PROMPTS.length);
    expect(aOn.every((r) => "nearMissCount" in r && r["startedBy"] === "person")).toBe(true);
    expect(aOff.some((r) => "nearMissCount" in r)).toBe(false);
    for (let i = 0; i < aOn.length; i++) {
      expect(without(aOn[i] as Record<string, unknown>, ["habituationCut", "nearMissCount", "capped", "budgetTrimmed", "inhibited", "elapsedMs"])).toEqual(without(aOff[i] as Record<string, unknown>, ["elapsedMs"]));
    }
  });

  test("the row's counts are what the turn decided: capped, trimmed and near misses by its verdicts, the margin recorded", () => {
    const { on } = twins();
    tune(on, { SNR_GLOBAL: 0.3, MAX_FOOTNOTES: 1, MAX_SURFACED: 0, NEAR_MISS_MARGIN: 0.5 });
    const seen = capture(on);
    turn(on, "s-2", PROMPTS[0] as string);
    const d = seen[0]?.decision;
    if (d === undefined) throw new Error("no decision captured");
    const row = rows(on, RECALL_DECISION_EVENT)[0] as Record<string, unknown>;
    const delivered = rows(on, RECALL_DELIVERED_EVENT)[0] as Record<string, unknown>;

    const of = (v: CandidateVerdict["verdict"]) => d.verdicts.filter((x) => x.verdict === v);
    expect(row["capped"]).toBe(of("capped").length);
    expect(row["capped"] as number).toBeGreaterThan(0);
    expect(row["inhibited"]).toBe(of("inhibited").length);
    const near = of("below-bar").filter((v) => v.habituated !== true && v.activation >= 0.5 * v.bar).length;
    expect(row["nearMiss"]).toEqual({ margin: 0.5, count: near });
    expect(row["habituationCut"]).toBe(0);
    expect(row["budgetTrimmed"]).toBe(d.trimmed.filter((x) => x.lane !== "belief" && x.lane !== "affect").length);
    // The keys sit beside the skips, in the surface set's order.
    const fields = RECALL_DECISION_FIELDS as readonly string[];
    expect(fields.indexOf("habituationCut")).toBe(fields.indexOf("crossProjectLifted") + 1);

    // The adapter's row: the same counts, flat, the turn to join on, who started it.
    expect(delivered["turn"]).toBe(row["turn"]);
    expect(delivered["capped"]).toBe(row["capped"]);
    expect(delivered["nearMissCount"]).toBe(near);
    expect(delivered["habituationCut"]).toBe(0);
    expect(delivered["inhibited"]).toBe(row["inhibited"]);
    expect(delivered["budgetTrimmed"]).toBe(row["budgetTrimmed"]);
    expect(delivered["startedBy"]).toBe("person");
  });

  test("a budget that binds is counted as trimmed, a memory at a time", () => {
    // Room for the frame and little else: the render trims what the gate admitted.
    const { on } = twins(420);
    tune(on, { SNR_GLOBAL: 0.3 });
    const seen = capture(on);
    turn(on, "s-3", PROMPTS[0] as string);
    const d = seen[0]?.decision;
    if (d === undefined) throw new Error("no decision captured");
    const trimmedMemories = d.trimmed.filter((x) => x.lane === "surfaced" || x.lane === "footnote").length;
    expect(trimmedMemories).toBeGreaterThan(0);
    expect(rows(on, RECALL_DECISION_EVENT)[0]?.["budgetTrimmed"]).toBe(trimmedMemories);
  });

  test("habituation's lift alone, counted as its cut and not as a near miss", () => {
    const { on, off } = twins();
    // Without habituation, which memory does the first prompt show?
    const plain = turn(off, "s-4", PROMPTS[0] as string).out;
    const target = plain.surfaced[0] ?? plain.footnotes[0];
    if (target === undefined) throw new Error("the prompt showed nothing to habituate");
    // Rated 0 in two sessions this week: habituated; a lift no reach clears.
    for (const session of ["r-1", "r-2"]) {
      on.counterpart.store.appendEvent({ name: "recall.rated", day: on.counterpart.store.livedDay(), ref: session, payload: { session, ratings: [{ id: target, score: 0 }] } });
    }
    tune(on, { HABITUATION_BAR_LIFT: 1_000, NEAR_MISS_MARGIN: 0.999 });
    const seen = capture(on);
    const out = turn(on, "s-4", PROMPTS[0] as string).out;
    expect([...out.surfaced, ...out.footnotes]).not.toContain(target);
    const v = seen[0]?.decision.verdicts.find((x) => x.id === target);
    expect(v?.verdict).toBe("below-bar");
    expect(v?.habituated).toBe(true);
    const row = rows(on, RECALL_DECISION_EVENT)[0] as Record<string, unknown>;
    expect(row["habituationCut"]).toBe(1);
    const near = (seen[0]?.decision.verdicts ?? []).filter((x) => x.verdict === "below-bar" && x.habituated !== true && x.activation >= 0.001 * x.bar).length;
    expect((row["nearMiss"] as { count: number }).count).toBe(near);
  });

  test("who started the turn: a host frame reads host, an unattended session unattended", () => {
    const { on } = twins();
    turn(on, "s-5", "<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>\nsourdough starter");
    turn(on, "s-6", PROMPTS[1] as string, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0" });
    const by = rows(on, RECALL_DELIVERED_EVENT).map((r) => r["startedBy"]);
    expect(by).toEqual(["host", "unattended"]);
  });

  test("a quiet turn counts nothing stopped, and still carries the margin", () => {
    const { on } = twins();
    turn(on, "s-7", "what time does the tram to the airport leave");
    const row = rows(on, RECALL_DECISION_EVENT)[0] as Record<string, unknown>;
    expect(row["nearMiss"]).toEqual({ margin: RECALL.NEAR_MISS_MARGIN, count: expect.any(Number) });
    expect(row["capped"]).toBe(0);
    expect(row["budgetTrimmed"]).toBe(0);
  });
});

describe("stopCounts: attribution, read off the verdicts", () => {
  const t = { ...RECALL, NEAR_MISS_MARGIN: 0.1, HABITUATION_BAR_LIFT: 0.5 };
  const v = (id: string, verdict: CandidateVerdict["verdict"], activation: number, bar: number, extra: Partial<CandidateVerdict> = {}): CandidateVerdict =>
    ({ id, kind: "fact", verdict, activation, bar, cue: 1, temporal: 0, semantic: 0, arrival: 0, hops: 0, cueFraction: 1, sal: 0.5, strength: 1, trains: true, ...extra }) as CandidateVerdict;

  test("each verdict lands in one count", () => {
    const verdicts = [
      v("near", "below-bar", 0.95, 1),
      v("far", "below-bar", 0.5, 1),
      // Bar 1.5 = 1 × (1 + 0.5): cleared the bar it would have faced without the lift.
      v("hab", "below-bar", 1.2, 1.5, { habituated: true }),
      // Habituated, but short of its plain bar (1.0) too: not habituation's
      // cut, and far from the bar it faced (1.5): no near miss either.
      v("hab-short", "below-bar", 0.9, 1.5, { habituated: true }),
      // Near its own bar: a near miss.
      v("near-2", "below-bar", 1.85, 2),
      // Only the cross-project lift kept it back: counted there, not here.
      v("cross", "below-bar", 0.99, 1),
      v("cap", "capped", 2, 1),
      v("inh", "inhibited", 2, 1),
      v("shown", "footnoted", 2, 1),
      v("echo", "echo-skipped", 2, 1),
      v("floor", "below-floor", 0.1, 1),
    ];
    const c = stopCounts(verdicts, ["cross"], [{ lane: "footnote" }, { lane: "belief" }, { lane: "surfaced" }, { lane: "affect" }], t);
    expect(c).toEqual({ habituationCut: 1, nearMiss: { margin: 0.1, count: 2 }, capped: 1, budgetTrimmed: 2, inhibited: 1 });
  });

  test("nothing decided, nothing counted", () => {
    expect(stopCounts([], [], [], t)).toEqual({ habituationCut: 0, nearMiss: { margin: 0.1, count: 0 }, capped: 0, budgetTrimmed: 0, inhibited: 0 });
  });
});
