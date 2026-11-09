/**
 * LT2 part 1 (2026-11-09): WHERE A TURN'S RECALL TIME GOES — measurement only.
 * Each `recall.decision` row carries `steps`, ms per step of the pass
 * (`core/recall/steps.ts#STEP_NAMES`), and doctor's `Recall steps` line reads
 * the week's p50 of each.
 *
 * The guarantee is that this is ONLY measurement: the same prompts, through the
 * real UserPromptSubmit hook and the real delivery (`deliverTurn`), on two
 * byte-identical stores, one timing and one with the timing switched off
 * (`recall.STEP_TIMING`), hand over the same bytes, the same memories in the
 * same order, and write decision rows that differ by `steps` (and the clock's
 * own `elapsedMs`) alone.
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
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { RECALL_DECISION_EVENT, RECALL_DECISION_FIELDS } from "../src/core/counterpart-events.js";
import { STEP_NAMES, StepClock, TUNABLES as RECALL } from "../src/core/recall/index.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/bakery";
const ZONE = "America/Denver";

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
];

const BAKERY = [
  "The sourdough starter died after two weeks of neglect in the cold pantry.",
  "A sourdough starter wants feeding twice a day when it lives on the counter.",
  "The rye levain doubled overnight once it moved beside the warm oven.",
  "Sourdough loaves spread flat when the starter is past its peak.",
  "The pantry runs cold in winter, which slows every starter and dough.",
  "Feeding the starter with whole wheat flour made it rise faster.",
];

const PROMPTS = [
  "my sourdough starter died in the pantry, what went wrong?",
  "how should I feed a starter so the loaves don't spread flat?",
  "is the warm oven a good place for the rye levain?",
  // Reaches nothing: a quiet turn is timed too, with the steps it ran.
  "zzqx vvplor",
];

let root: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-lt2-steps-"));
  setSystemTime(new Date("2026-11-09T15:00:00.000Z"));
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

function config(dir: string): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE };
}

function open(dir: string): Adapter {
  const a = openAdapter(config(dir), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** One seeded store, closed, copied byte for byte: the two runs start identical. */
function twins(): { on: Adapter; off: Adapter } {
  const seed = join(root, "seed");
  const a = open(seed);
  findable(a.counterpart.store);
  for (const body of [...FILLER, ...BAKERY]) a.counterpart.store.put({ type: "memory", kind: "fact", body });
  a.counterpart.close();
  cpSync(seed, join(root, "on"), { recursive: true });
  cpSync(seed, join(root, "off"), { recursive: true });
  return { on: open(join(root, "on")), off: open(join(root, "off")) };
}

function tune(a: Adapter, values: Partial<Record<keyof typeof RECALL, unknown>>): void {
  Object.assign(a.counterpart.recall.tunables as unknown as Record<string, unknown>, values);
}

/** One prompt through the hook AND the real delivery: what the host would print. */
function turn(a: Adapter, session: string, text: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: a.counterpart.store.dir },
  );
  const out = a.userPromptSubmit(input);
  const delivered = deliverTurn("user-prompt-submit", out, {}, null, a, input);
  return { out, stdout: delivered.stdout };
}

function rows(a: Adapter): Record<string, unknown>[] {
  return a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, order: "asc" }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

function without(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

describe("LT2 part 1: recall's steps are timed, and only timed", () => {
  test("the same prompts through the hook: identical bytes with the timing on and off; rows differ by `steps` alone", () => {
    const { on, off } = twins();
    tune(off, { STEP_TIMING: false });

    let shown = 0;
    for (const text of PROMPTS) {
      const a = turn(on, "s-1", text);
      const b = turn(off, "s-1", text);
      expect(Buffer.compare(Buffer.from(a.stdout, "utf8"), Buffer.from(b.stdout, "utf8"))).toBe(0);
      expect(a.out.injection).toBe(b.out.injection);
      expect(a.out.surfaced).toEqual(b.out.surfaced);
      expect(a.out.footnotes).toEqual(b.out.footnotes);
      expect(a.out.bytes).toBe(b.out.bytes);
      expect(a.out.reason).toBe(b.out.reason);
      shown += a.out.surfaced.length + a.out.footnotes.length;
    }
    // "Identical" is not "nothing ran": the turns showed memories.
    expect(shown).toBeGreaterThan(0);

    const dOn = rows(on);
    const dOff = rows(off);
    expect(dOn.length).toBe(PROMPTS.length);
    expect(dOff.length).toBe(PROMPTS.length);
    for (let i = 0; i < dOn.length; i++) {
      const rowOn = dOn[i] as Record<string, unknown>;
      const rowOff = dOff[i] as Record<string, unknown>;
      expect("steps" in rowOn).toBe(true);
      expect("steps" in rowOff).toBe(false);
      expect(without(rowOn, ["steps", "elapsedMs"])).toEqual(without(rowOff, ["elapsedMs"]));
    }
  });

  test("a rendered turn names every step, each a non-negative number of ms; a quiet one the steps it ran", () => {
    const { on } = twins();
    turn(on, "s-2", PROMPTS[0] as string);
    // Its own session, so no cue carries in from the turn before.
    turn(on, "s-2q", PROMPTS[3] as string);
    const [rendered, quiet] = rows(on);
    expect(rendered?.["reason"]).toBe("rendered");
    const steps = rendered?.["steps"] as Record<string, number>;
    // Every step, in the pass's order (the row's keys are STEP_NAMES order).
    expect(Object.keys(steps)).toEqual([...STEP_NAMES]);
    for (const v of Object.values(steps)) {
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // The brief's named steps are all there by those names.
    for (const k of ["cue", "embed", "spread", "rank", "gate", "settledOver", "habituation", "render"]) expect(k in steps).toBe(true);

    expect(quiet?.["reason"]).toBe("no-candidates");
    const q = quiet?.["steps"] as Record<string, number>;
    for (const k of ["arrivals", "embed", "gateLoad", "cue", "rest", "record"]) expect(k in q).toBe(true);
    // The gate never ran on a turn nothing reached.
    expect("gate" in q).toBe(false);
    // On the hashed field list, beside the other timing.
    const fields = RECALL_DECISION_FIELDS as readonly string[];
    expect(fields.indexOf("steps")).toBe(fields.indexOf("lateMs") + 1);
  });

  test("doctor's `Recall steps` line reads the week's p50 per step off those rows", () => {
    const { on } = twins();
    for (const text of PROMPTS.slice(0, 3)) turn(on, "s-3", text);
    const store = on.counterpart.store;
    const findings = doctorFindings({
      configPath: join(root, "absent-config.json"),
      configReason: "absent",
      config: config(store.dir),
      dir: store.dir,
      store,
      today: "2026-11-09",
      refusals: {},
    });
    const line = findings.find((f) => f.key === "recall-steps");
    if (line === undefined) throw new Error(`no recall-steps finding in ${findings.map((f) => f.key).join(", ")}`);
    expect(line.severity).toBe("green");
    expect(line.title).toBe("Recall steps");
    expect(line.detail).toContain("3 timed turns");
    expect(line.detail).toContain("p50 ms by step, largest first:");
    expect(line.data["turns"]).toBe(3);
    // The median of each step is the median of what the rows carried.
    const carried = rows(on).map((r) => (r["steps"] as Record<string, number>)["cue"] as number).sort((a, b) => a - b);
    expect(line.data["p50.cue"]).toBe(carried[1] as number);
    for (const name of STEP_NAMES) expect(typeof line.data[`p50.${name}`]).toBe("number");
    // The largest step named first is the largest median.
    const medians = STEP_NAMES.map((n) => line.data[`p50.${n}`] as number);
    const first = /largest first: ([A-Za-z]+) /.exec(line.detail)?.[1];
    expect(line.data[`p50.${first ?? ""}`]).toBe(Math.max(...medians));
  });

  test("a session-start reading leaves the line out (it is never red)", () => {
    const { on } = twins();
    turn(on, "s-4", PROMPTS[0] as string);
    const store = on.counterpart.store;
    const findings = doctorFindings({
      configPath: join(root, "absent-config.json"),
      configReason: "absent",
      config: config(store.dir),
      dir: store.dir,
      store,
      today: "2026-11-09",
      refusals: {},
      budgetMs: 60_000,
    });
    expect(findings.some((f) => f.key === "recall-steps")).toBe(false);
  });

  test("the clock tiles: laps charge the time since the last, and a step lapped twice sums", () => {
    let t = 0;
    const clock = new StepClock(() => t);
    t = 2;
    clock.lap("cue");
    t = 5;
    clock.lap("render");
    t = 6.004;
    clock.lap("settledOver");
    t = 9;
    clock.lap("render");
    expect(clock.snapshot()).toEqual({ cue: 2, settledOver: 1, render: 6 });
  });
});
