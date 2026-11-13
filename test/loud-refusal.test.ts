/**
 * WHICH GATE REFUSED THE LOUD TIER (2026-11-13, observation only; the Wren
 * findings' P3). The `recall.decision` row carries `loudRefusal`: the gate
 * that kept a memory's words off the turn (`by`, a `LOUD_GATES` code, the
 * furthest any candidate got) and the top candidates that did not show loud,
 * ids and numbers only, capped.
 *
 * Three things are held here: each gate's code, from the real `gate` over
 * hand-built candidates; the ranking, cap and size of the row; and one turn
 * through the real UserPromptSubmit hook on a temp store whose row names the
 * gate that refused. That the row is ONLY observation — the same bytes and
 * memories with it on or off — is `near-miss-logging.test.ts`'s twin test,
 * whose new keys include it (it rides `STOP_COUNTS`).
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import type { Candidate } from "../src/core/recall/activate.js";
import { floorUnit, gate } from "../src/core/recall/gate.js";
import type { CandidateVerdict, GateInput } from "../src/core/recall/gate.js";
import { LOUD_GATES, loudRefusal } from "../src/core/recall/index.js";
import type { LoudGate } from "../src/core/recall/index.js";
import { freshGateState } from "../src/core/recall/session.js";
import { TUNABLES } from "../src/core/recall/tunables.js";
import type { RecallTunables } from "../src/core/recall/tunables.js";
import type { MemoryPhysics } from "../src/core/types.js";

function cand(id: string, body: string, activation: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    id,
    kind: "fact",
    doc: { id, type: "memory", body } as Candidate["doc"],
    physics: { salience: { relevance: 0.5, emotional: 0, predictive: 0.5 } } as unknown as MemoryPhysics,
    strength: 1,
    sal: 0.5, // modulates the bar by exactly 1
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
    ...extra,
  };
}

/** Ten background memories, mean 10 and sd ~2.83: admission bar ~14.5, loud bar ~17. */
function background(): Candidate[] {
  const words = ["alpha", "bravo", "charlie", "delta", "echo"];
  return [6, 8, 10, 12, 14, 6, 8, 10, 12, 14].map((a, i) => cand(`bg${i}`, `${words[i % 5]} note number ${i} kiwi${i}`, a));
}

const STORE = 200;
const UNIT = floorUnit(STORE);

function run(targets: Candidate[], extra: Partial<GateInput> = {}, t: RecallTunables = TUNABLES) {
  return gate({ candidates: [...background(), ...targets], state: freshGateState("s"), storeSize: STORE, affectStated: false, turn: 1, ...extra }, t);
}

/** The code the row gives the one candidate `id`, judged alone and not shown. */
function codeOf(r: ReturnType<typeof gate>, id: string): ReturnType<typeof loudRefusal> {
  return loudRefusal(r.verdicts.filter((v) => v.id === id), r.surfaced.map((c) => c.id), [], TUNABLES);
}

describe("each gate has its code, from the real gate", () => {
  test("hard gates and boundaries: dark, dedup, floor, bar, echo, project", () => {
    expect(codeOf(run([cand("t", "uncued", 0, { cue: 0 })]), "t").by).toBe("dark");

    const seen = freshGateState("s");
    const dedup = gate({ candidates: [...background(), cand("t", "seen already zebra", 30)], state: { ...seen, surfaced: { t: { turn: 1, tier: "surfaced", trains: true } } }, storeSize: STORE, affectStated: false, turn: 2 }, TUNABLES);
    expect(codeOf(dedup, "t").by).toBe("dedup");

    const floor = codeOf(run([cand("t", "weak zebra", 0.5)]), "t");
    expect(floor.by).toBe("floor");
    expect(floor.top[0]).toEqual({ id: "t", gate: "floor", act: 0.5, limit: Math.round(TUNABLES.FLOOR_GLOBAL_UNITS * UNIT * 100) / 100 });
    // `by`'s own number rides on `lead`.
    expect(floor.lead).toEqual(floor.top[0]);

    const barRun = run([cand("t", "middling zebra", 12)]);
    const bar = codeOf(barRun, "t");
    expect(bar.by).toBe("bar");
    const faced = barRun.verdicts.find((v) => v.id === "t")?.bar as number;
    expect(bar.top[0]?.limit).toBe(Math.round(faced * 100) / 100);
    expect(bar.top[0]?.act).toBeLessThan(bar.top[0]?.limit as number);

    expect(codeOf(run([cand("t", "my own zebra", 30)], { echo: new Set(["t"]) }), "t").by).toBe("echo");
    expect(codeOf(run([cand("t", "their zebra", 30)], { elsewhere: (id) => id === "t" }), "t").by).toBe("project");
  });

  test("the loud tier's checks, in their order: temporal, told, cold, cuefrac, strong, loudbar", () => {
    expect(codeOf(run([cand("t", "a dated zebra", 30, { maxTier: "footnoted" })]), "t").by).toBe("temporal");
    expect(codeOf(run([cand("t", "a starter zebra", 30, { told: true })]), "t").by).toBe("told");
    expect(codeOf(run([cand("t", "a lone zebra", 30)], { livedSize: 1 }), "t").by).toBe("cold");

    const cf = codeOf(run([cand("t", "a recent zebra", 30, { cueFraction: 0.2 })]), "t");
    expect(cf.top[0]).toEqual({ id: "t", gate: "cuefrac", act: 30, limit: TUNABLES.MIN_CUE_FRACTION, value: 0.2 });

    // Past the loud bar (~17), under the strong floor (4.5 units, ~20.7).
    const strong = codeOf(run([cand("t", "a fair zebra", 19)]), "t");
    expect(strong.top[0]).toEqual({ id: "t", gate: "strong", act: 19, limit: Math.round(TUNABLES.FLOOR_STRONG_DEFAULT_UNITS * UNIT * 100) / 100 });

    // Past the strong floor; a loud bar raised out of reach.
    const loudRun = run([cand("t", "a strong zebra", 25)], {}, { ...TUNABLES, SNR_STRONG: 20 });
    const loudbar = codeOf(loudRun, "t");
    expect(loudbar.by).toBe("loudbar");
    expect(loudbar.top[0]?.limit as number).toBeGreaterThan(25);
  });

  test("after the checks: inhibited, outranked, and trimmed by the render", () => {
    const dup = run([cand("a", "the zebra crossing on fifth street", 30), cand("b", "the zebra crossing on fifth street", 29)]);
    expect(dup.surfaced.map((c) => c.id)).toEqual(["a"]);
    expect(codeOf(dup, "b").top[0]?.gate).toBe("inhibited");

    const two = run([cand("a", "the zebra crossing on fifth street", 30), cand("b", "a giraffe at the city zoo", 29)]);
    expect(two.surfaced.map((c) => c.id)).toEqual(["a"]);
    // `b` lost the loud slot; unshown, it is `outranked`.
    expect(codeOf(two, "b").top[0]).toEqual({ id: "b", gate: "outranked", act: 29 });
    // A memory showed loud: nothing refused the tier, no lead; what was shown
    // (loud or as a footnote) is not in `top`.
    const quiet = two.footnotes.map((c) => c.id);
    expect(quiet).toContain("b");
    const out = loudRefusal(two.verdicts, ["a"], quiet, TUNABLES);
    expect(out.by).toBeNull();
    expect("lead" in out).toBe(false);
    expect(out.top.some((r) => r.id === "a" || r.id === "b")).toBe(false);

    // The gate surfaced it; the render cut it for bytes.
    expect(loudRefusal(two.verdicts, [], [], TUNABLES).by).toBe("trimmed");
  });
});

/** A hand-built verdict: only the fields `loudRefusal` reads matter. */
function verdict(id: string, v: CandidateVerdict["verdict"], activation: number, extra: Partial<CandidateVerdict> = {}): CandidateVerdict {
  return { id, kind: "fact", verdict: v, activation, cue: activation, temporal: 0, semantic: 0, arrival: 0, hops: 0, cueFraction: 1, sal: 0.5, strength: 1, trains: true, bar: 5, ...extra };
}

describe("the row: by and lead from the furthest, top from the unshown, capped, small", () => {
  test("by is the furthest gate any candidate reached, even a footnoted one, with its number on lead; quiet pointers are left out", () => {
    const vs = [
      verdict("mem_floor", "below-floor", 0.5, { limit: 1 }),
      verdict("mem_bar", "below-bar", 3),
      verdict("mem_cf_a", "footnoted", 9, { loudBlockedBy: "cue-fraction", cueFraction: 0.3, limit: 0.5 }),
      verdict("mem_cf_b", "footnoted", 11, { loudBlockedBy: "cue-fraction", cueFraction: 0.4, limit: 0.5 }),
      verdict("mem_pointer", "footnoted", 50, { via: "link" }),
    ];
    const r = loudRefusal(vs, [], ["mem_cf_a", "mem_cf_b", "mem_pointer"], TUNABLES);
    expect(r.by).toBe("cuefrac");
    expect(r.lead).toEqual({ id: "mem_cf_b", gate: "cuefrac", act: 11, limit: 0.5, value: 0.4 });
    // Only the unshown, closest to their gate first: 3/5 = 0.6 of the bar, 0.5/1 of the floor.
    expect(r.top.map((x) => x.id)).toEqual(["mem_bar", "mem_floor"]);
    expect(r.top[0]).toEqual({ id: "mem_bar", gate: "bar", act: 3, limit: 5 });
  });

  test("the d17 shape: footnotes fill nothing in top; an unshown memory at ~0.87 of its admission bar is named", () => {
    const vs = [
      // Three footnotes refused the loud tier at the strong floor (the turn's best, and `by`).
      verdict("mem_foot_1", "footnoted", 12.87, { loudBlockedBy: "below-strong-floor", limit: 23.43 }),
      verdict("mem_foot_2", "footnoted", 12.64, { loudBlockedBy: "below-strong-floor", limit: 23.43 }),
      verdict("mem_foot_3", "footnoted", 12.1, { loudBlockedBy: "below-strong-floor", limit: 23.43 }),
      // Unshown, below their admission bars: stronger in activation, further from their bars.
      verdict("mem_far_1", "below-bar", 11.2, { bar: 16.9 }),
      verdict("mem_far_2", "below-bar", 11.1, { bar: 16.0 }),
      verdict("mem_far_3", "below-bar", 10.9, { bar: 15.8 }),
      verdict("mem_far_4", "below-bar", 10.5, { bar: 15.1 }),
      verdict("mem_far_5", "below-bar", 10.2, { bar: 14.9 }),
      verdict("mem_far_6", "below-bar", 9.9, { bar: 14.6 }),
      // The guitarist: 9.41 against 10.86, 0.87 of its bar.
      verdict("mem_dea85a8850b2", "below-bar", 9.41, { bar: 10.86 }),
      verdict("mem_dark", "dark-uncued", 0),
    ];
    const r = loudRefusal(vs, [], ["mem_foot_1", "mem_foot_2", "mem_foot_3"], TUNABLES);
    expect(r.by).toBe("strong");
    expect(r.lead).toEqual({ id: "mem_foot_1", gate: "strong", act: 12.87, limit: 23.43 });
    expect(r.top.some((x) => x.id.startsWith("mem_foot"))).toBe(false);
    expect(r.top[0]).toEqual({ id: "mem_dea85a8850b2", gate: "bar", act: 9.41, limit: 10.86 });
    expect(r.top.length).toBe(TUNABLES.LOUD_REFUSAL_ROWS);
    // A gate with no threshold comes after every one with.
    expect(r.top.some((x) => x.id === "mem_dark")).toBe(false);
  });

  test("no cued candidate: empty; the codes are the documented fifteen, in order", () => {
    expect(loudRefusal([], [], [], TUNABLES)).toEqual({ by: "empty", top: [] });
    expect(loudRefusal([verdict("p", "dark-uncued", 0, { via: "link" })], [], [], TUNABLES)).toEqual({ by: "empty", top: [] });
    expect([...LOUD_GATES]).toEqual(["dark", "dedup", "floor", "bar", "echo", "project", "temporal", "told", "cold", "cuefrac", "strong", "loudbar", "inhibited", "outranked", "trimmed"]);
  });

  test(`at most ${String(TUNABLES.LOUD_REFUSAL_ROWS)} rows, two decimals, ids and numbers only`, () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      verdict(`mem_abcdef0123${String(i).padStart(2, "0")}`, "footnoted", 1000.123456 + i, { loudBlockedBy: "below-strong-floor", limit: 2000.987654, primed: { link: 0.3333, train: 0.1, from: ["used"] } }),
    );
    const r = loudRefusal(many, [], [], TUNABLES);
    expect(r.top.length).toBe(TUNABLES.LOUD_REFUSAL_ROWS);
    for (const row of [...r.top, r.lead]) {
      if (row === undefined) throw new Error("no lead");
      expect(Object.keys(row).every((k) => ["id", "gate", "act", "limit", "value"].includes(k))).toBe(true);
      for (const n of [row.act, row.limit, row.value]) if (n !== undefined) expect(Math.round(n * 100) / 100).toBe(n);
      // The strong floor compares activation less priming: that is `value`.
      expect(row.value).toBe(Math.round((row.act - 0.4333) * 100) / 100);
    }
    expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThan(TUNABLES.LOUD_REFUSAL_BYTES);
  });

  test("the byte cap is enforced: long ids drop rows from the end of top until the field is under it", () => {
    const long = (i: number): string => `mem_${"x".repeat(90)}${String(i).padStart(2, "0")}`;
    const many = Array.from({ length: 12 }, (_, i) => verdict(long(i), "below-bar", 9 - i * 0.1, { bar: 10 }));
    const r = loudRefusal(many, [], [], TUNABLES);
    const bytes = new TextEncoder().encode(JSON.stringify(r)).length;
    expect(bytes).toBeLessThan(TUNABLES.LOUD_REFUSAL_BYTES);
    expect(r.top.length).toBeGreaterThan(0);
    expect(r.top.length).toBeLessThan(TUNABLES.LOUD_REFUSAL_ROWS);
    // What is kept is the head of the ranking, in order.
    expect(r.top.map((x) => x.id)).toEqual(many.slice(0, r.top.length).map((v) => v.id));
    // One more row would have been at or past the cap.
    const withOne = { ...r, top: [...r.top, { id: long(99), gate: "bar" as const, act: 8.88, limit: 10 }] };
    expect(new TextEncoder().encode(JSON.stringify(withOne)).length).toBeGreaterThanOrEqual(TUNABLES.LOUD_REFUSAL_BYTES);
  });
});

describe("through the real hook, on a temp store", () => {
  let root: string;
  const closers: { close(): void }[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "counterparts-loud-refusal-"));
    setSystemTime(new Date("2026-11-13T15:00:00.000Z"));
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

  test("a one-memory store: the row names cold start as the gate that refused, with the memory that reached it as its lead", () => {
    const dir = join(root, "store");
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, timeZone: "America/Denver" }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
    closers.push(a.counterpart);
    const id = a.counterpart.store.put({ type: "memory", kind: "fact", body: "The guitarist tuned the twelve string before the zebra gig.", salience: { claimed: 0.5 } });
    const scope = "/work/band";
    const input = toHookInput(
      { session_id: "s-1", hook_event_name: "UserPromptSubmit", cwd: scope, prompt: "did the guitarist tune the twelve string before the zebra gig?" },
      { scope, timeZone: "America/Denver", env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
    );
    const out = a.userPromptSubmit(input);
    expect(out.surfaced).toEqual([]);
    expect(out.footnotes).toContain(id);
    const rows = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, order: "asc" }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    const refusal = rows[0]?.["loudRefusal"] as { by: LoudGate; lead?: { id: string; gate: LoudGate }; top: { id: string; gate: LoudGate }[] };
    expect(refusal.by).toBe("cold");
    // The memory was shown, as a footnote: it is the lead, and not in `top` (the unshown).
    expect(refusal.lead).toMatchObject({ id, gate: "cold" });
    expect(refusal.top.some((r) => r.id === id)).toBe(false);
    // Ids and numbers only: no word of the memory or the prompt.
    const text = JSON.stringify(refusal);
    for (const word of ["guitarist", "twelve", "zebra"]) expect(text).not.toContain(word);
  });
});
