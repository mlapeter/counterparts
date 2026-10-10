/**
 * ONE BUDGET PER HOOK ENVELOPE (2026-09-29, audit item 9).
 *
 * Everything one SessionStart or one UserPromptSubmit prints is measured
 * against the host's one cap (`TUNABLES.HOST_OUTPUT_CHARS`), and a crowded day
 * gives way in a stated order:
 *
 *   SessionStart — notices, then the write-up pointer, then the first-launch
 *   question, then today's plain reminders (to the first prompt); the wake is
 *   never cut at delivery (it trims itself at the boundary, identity last).
 *   Proved through the real delivery (`deliverTurn`): a reminder reaches the
 *   person only in the JSON form, and the asks give way before it (review of
 *   #285, S2). Since 2026-10-10 each field of that form is measured on its
 *   own, as the host measures it, so the reminder's line costs the model's
 *   field nothing.
 *
 *   UserPromptSubmit — the update notice, then the turn's recall (sized to what
 *   the other lines leave), and last the reserved lines: the dream's, today's
 *   plain reminders, the clock.
 *
 * And the plain-stdout fallback is checked against the cap: past it, the
 * delivery says so (`overCap`) rather than printing a preview silently.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 * The wake's SIZE is set by replacing `counterpart.wake` on the one adapter a
 * test opens — the one way to put a wake at an exact number of bytes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
import type { WakeResult } from "../src/core/self/index.js";
import { SCOPE_ASK_OPEN, TUNABLES, openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, ClaudeCodeAdapter, HookInput } from "../src/adapters/claude-code/index.js";
import { WRITE_UP_ASK_COUNT_KEY, WRITE_UP_ASK_DATE_KEY, WRITE_UP_OPEN } from "../src/adapters/claude-code/hooks.js";
import { deliverTurn, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import { recordSession } from "../src/adapters/sessions.js";

const DAY = 86_400_000;
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
let root: string;
let storeDir: string;
let PROJ: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-envelope-")));
  storeDir = join(root, "store");
  PROJ = join(root, "proj");
  mkdirSync(PROJ, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const today = (): string => new Date().toISOString().slice(0, 10);

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: storeDir, owner: true, injectionBudgetBytes: 9_000, ...over };
}

function adapter(mode: "on" | "unset"): ClaudeCodeAdapter {
  return openAdapter(config(), {
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
    ...(mode === "unset" ? {} : { scope: { mode: "on", matched: PROJ, entry: null } }),
  });
}

/**
 * A wake of exactly `bytes` bytes, whatever the store holds — made of ordinary
 * wake-shaped lines (a newline and quotes on each, which the JSON form escapes),
 * padded to the byte.
 */
function fixWake(a: ClaudeCodeAdapter, bytes: number): void {
  const line = '- 2026-09-01 · The relief valve is seated first, or the loop loses "pressure".\n';
  let text = "";
  while (Buffer.byteLength(text + line, "utf8") <= bytes) text += line;
  text += "w".repeat(bytes - Buffer.byteLength(text, "utf8"));
  const fake: WakeResult & { budgetBytes: number | null } = {
    text,
    ok: true,
    reason: "loaded" as WakeResult["reason"],
    bytes: Buffer.byteLength(text, "utf8"),
    sentinel: null,
    reading: null,
    preface: null,
    budgetBytes: 9_000,
  };
  (a.counterpart as unknown as { wake: () => typeof fake }).wake = () => fake;
}

/** Seed: one plain reminder due today, and one session that ended owing a write-up. */
function seed(): void {
  // A clock the seed turns: the ended session's six pieces are ten minutes
  // apart, so what it left unwritten owes a write-up (`core/coverage/`).
  let clock = Date.now();
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => clock });
  try {
    c.store.put({
      type: "memory",
      kind: "fact",
      title: "pay the quarterly estimate",
      body: "Pay the quarterly estimated tax today, before the bank closes.",
      eventDate: today(),
      meta: { [CUE_MODE_META]: "plain" },
      salience: { relevance: 0.8, emotional: 0.5, predictive: 0.8 },
    });
    const at = Date.now() - 2 * DAY;
    recordSession(storeDir, { sessionId: "old-1", scope: PROJ, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < 6; i++) {
      clock = at + i * 10 * 60_000;
      turns.push(
        { role: "user", text: `${String(i)}: the reservoir loop keeps its pressure only when the relief valve is seated first. `.repeat(2) },
        { role: "assistant", text: "Understood." },
      );
      c.captureSpans({ session: "old-1", scope: PROJ, turns: [...turns] });
    }
    expect(c.episodeAsk("old-1", { turns: 9, bytes: 6_000 }).asked).toBe(true);
    c.boundary({ session: "old-1", scope: PROJ, kind: "session-end" });
    recordSession(storeDir, { sessionId: "old-1", scope: PROJ, phase: "end", at: at + 1_000 });
  } finally {
    c.close();
  }
}

interface Delivered {
  /** Everything printed. */
  stdout: string;
  /** The JSON form was printed (a person-facing line rode it). */
  json: boolean;
  /** Today's reminder reached the person. */
  reminderShown: boolean;
  question: boolean;
  pointer: boolean;
  /** `part`s of the `adapter.envelope.gave-way` events, in order. */
  gaveWay: string[];
  /** The reminder is still due afterwards (not claimed). */
  stillDue: boolean;
}

/** The model's field of a printed envelope: `additionalContext`, or the plain stdout. */
function contextOf(stdout: string): string {
  return stdout.startsWith("{")
    ? (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
    : stdout;
}

/** One SessionStart THROUGH THE REAL DELIVERY (`deliverTurn`), in an unset directory. */
function startDelivered(sessionId: string, wakeBytes: number): Delivered {
  // A fresh day's pointer allowance for each start, so a walk over wake sizes
  // measures room and never the day's count.
  const c = Counterpart.open({ dir: storeDir, owner: true });
  c.store.setMeta(WRITE_UP_ASK_DATE_KEY, "1999-01-01");
  c.store.setMeta(WRITE_UP_ASK_COUNT_KEY, "0");
  c.close();
  const a = adapter("unset");
  try {
    fixWake(a, wakeBytes);
    const input: HookInput = { sessionId, scope: PROJ, at: today() };
    const out = a.sessionStart(input);
    const d = deliverTurn("session-start", out, {}, [null, null], a, input);
    const json = d.stdout.startsWith("{");
    const context = json ? (JSON.parse(d.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : d.stdout;
    const message = json ? (JSON.parse(d.stdout) as { systemMessage: string }).systemMessage : "";
    return {
      stdout: d.stdout,
      json,
      reminderShown: message.includes("pay the quarterly estimate"),
      question: context.includes(SCOPE_ASK_OPEN),
      pointer: context.includes(WRITE_UP_OPEN),
      gaveWay: a.events("adapter.envelope.gave-way").map((e) => String(e.data["part"])),
      stillDue: a.counterpart.plainDueToday({ at: today() }).length > 0,
    };
  } finally {
    a.counterpart.close();
  }
}

describe("SessionStart, THROUGH THE DELIVERY: the reminder is the last thing to give way (review of #285, S2)", () => {
  test("a roomy morning: the reminder, the question and the pointer all go out", () => {
    seed();
    const d = startDelivered("s-roomy", 3_000);
    expect(d).toMatchObject({ json: true, reminderShown: true, question: true, pointer: true, stillDue: false });
    expect(d.gaveWay).toEqual([]);
  });

  test("THE ASKS GIVE WAY TO THE REMINDER: on the largest wake the reminder still fits beside, neither ask goes; with room for the question but not both, the question goes and the pointer waits", () => {
    // Walk down from a wake the reminder cannot fit beside at all — a FRESH
    // store each step, since a reminder shown once is claimed for the day.
    let largest: { w: number; d: Delivered } | null = null;
    let oneAsk: Delivered | null = null;
    // From just under the host's cap: since 2026-10-10 the reminder's line is
    // its own field, so it rides whenever the wake and its lead fit the model's.
    for (let w = 9_990; w >= 7_000 && oneAsk === null; w -= 10) {
      storeDir = join(root, `store-${String(w)}`);
      seed();
      const d = startDelivered(`s-walk-${String(w)}`, w);
      if (largest === null && d.reminderShown) largest = { w, d };
      // (Walking down, a pointer-only morning can come first: the pointer is
      // smaller than the question and may take room the question could not
      // use. That is not the order being broken; the question is never the
      // one displaced. The case that shows the order is room for the question
      // but not both.)
      if (largest !== null && d.question && !d.pointer) oneAsk = d;
      if (largest !== null && d.question && d.pointer) break;
    }
    expect(largest).not.toBeNull();
    // The reminder is shown and claimed, and it is the ASKS that gave way.
    expect(largest?.d).toMatchObject({ json: true, reminderShown: true, question: false, pointer: false, stillDue: false });
    expect(largest?.d.gaveWay).toEqual(["question", "pointer"]);
    // Each field within the host's cap, in characters as the host counts; the whole object may be longer.
    expect(contextOf(largest?.d.stdout ?? "{}").length).toBeLessThanOrEqual(TUNABLES.HOST_OUTPUT_CHARS);
    // With room for one of the two, the question has it and the pointer waits.
    expect(oneAsk).not.toBeNull();
    expect(oneAsk).toMatchObject({ reminderShown: true, question: true, pointer: false });
    expect(oneAsk?.gaveWay).toEqual(["pointer"]);
  });

  test("the review's P3 morning — a 9,000-byte wake of ordinary lines: the reminder rides beside it now (each field on its own, measured 2026-10-10), and the asks use what is left of the model's field", () => {
    seed();
    const d = startDelivered("s-full", 9_000);
    expect(d).toMatchObject({ json: true, reminderShown: true, stillDue: false, question: true });
    expect(d.gaveWay).not.toContain("plain");
    expect(bytes(contextOf(d.stdout))).toBeLessThanOrEqual(TUNABLES.HOST_OUTPUT_CHARS);
    // The escaped object is past the old 9,500-character rule, which cost this morning its reminder.
    expect(d.stdout.length).toBeGreaterThan(9_500);
  });

  test("a wake that leaves the model's field no room even alone: the reminder waits for the first prompt (unclaimed, recorded by the delivery)", () => {
    seed();
    const d = startDelivered("s-overfull", 10_200);
    expect(d.json).toBe(false);
    expect(d.reminderShown).toBe(false);
    expect(d.stillDue).toBe(true);
    expect(d.gaveWay).toContain("plain");
  });

});

describe("UserPromptSubmit: the turn's recall is what gives way", () => {
  function prompt(stubLines: string | null): { injection: string; events: { name: string; data: Record<string, unknown> }[] } {
    const a = adapter("on");
    try {
      const c = a.counterpart;
      for (let i = 0; i < 12; i += 1) {
        c.store.put({
          type: "memory",
          kind: "fact",
          body: `The relief valve on loop ${String(i)} must be seated before the reservoir is filled, or it loses pressure.`,
          salience: { relevance: 0.9, emotional: 0.6, predictive: 0.9 },
          physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
        });
      }
      if (stubLines !== null) {
        // What a crowded morning hands a prompt: a carried share and the
        // dream's lines, reserved before recall is sized. Stubbed here — the
        // dream module owns their words.
        (a as unknown as { dreamLines: () => unknown }).dreamLines = () => ({ text: stubLines, told: null, note: null });
      }
      const input: HookInput = { sessionId: "s-turn", scope: PROJ, at: today(), prompt: "how do I keep the reservoir loop's pressure up — the relief valve?" };
      recordSession(storeDir, { sessionId: "s-turn", scope: PROJ, phase: "start" });
      const out = a.userPromptSubmit(input);
      return { injection: out.injection ?? "", events: a.events().map((e) => ({ name: e.name, data: e.data })) };
    } finally {
      a.counterpart.close();
    }
  }

  test("a normal turn: recall gets its whole configured budget, and nothing gives way", () => {
    const turn = prompt(null);
    expect(turn.events.find((e) => e.name === "adapter.envelope.gave-way")).toBeUndefined();
    expect(turn.events.find((e) => e.name === "adapter.recall")?.data["budget"]).toBe(9_000);
  });

  test("a crowded turn: recall is sized to what the reserved lines leave, and the whole stays under the cap", () => {
    const share = `${"A morning share, carried whole, about the night's dream. ".repeat(140)}\n`;
    expect(bytes(share)).toBeGreaterThan(7_500);
    const turn = prompt(share);
    const gave = turn.events.find((e) => e.name === "adapter.envelope.gave-way");
    expect(gave?.data["part"]).toBe("recall");
    const budget = turn.events.find((e) => e.name === "adapter.recall")?.data["budget"] as number;
    expect(budget).toBe(gave?.data["budget"] as number);
    expect(budget).toBeLessThan(9_000);
    // The reserved line went out whole, and the envelope is under the cap.
    expect(turn.injection).toContain(share.trimEnd());
    expect(bytes(turn.injection)).toBeLessThanOrEqual(TUNABLES.HOST_OUTPUT_CHARS);
  });
});

describe("UserPromptSubmit: a turn with NO room left for recall", () => {
  test("recall goes quiet at a budget of 0 — nothing throws, and the reserved lines still go out", () => {
    const a = adapter("on");
    try {
      const c = a.counterpart;
      for (let i = 0; i < 6; i += 1) {
        c.store.put({
          type: "memory",
          kind: "fact",
          body: `The relief valve on loop ${String(i)} must be seated before the reservoir is filled.`,
          salience: { relevance: 0.9, emotional: 0.6, predictive: 0.9 },
        });
      }
      // Past the whole host cap on its own: no room is left for recall at all.
      const share = `${"A morning share, carried whole, about the night's dream. ".repeat(177)}\n`;
      expect(bytes(share)).toBeGreaterThan(TUNABLES.HOST_OUTPUT_CHARS);
      (a as unknown as { dreamLines: () => unknown }).dreamLines = () => ({ text: share, told: null, note: null });
      recordSession(storeDir, { sessionId: "s-full", scope: PROJ, phase: "start" });
      const out = a.userPromptSubmit({ sessionId: "s-full", scope: PROJ, at: today(), prompt: "the relief valve on the reservoir loop?" });
      expect(out.ok).toBe(true);
      expect(out.injection ?? "").toContain(share.trimEnd());
      const budget = a.events().find((e) => e.name === "adapter.recall")?.data["budget"];
      expect(budget).toBe(0);
      expect(out.surfaced ?? []).toEqual([]);
      expect(out.footnotes ?? []).toEqual([]);
    } finally {
      a.counterpart.close();
    }
  });
});

describe("the plain-stdout fallback is checked", () => {
  test("past the host's cap the delivery says so; under it, nothing is said", () => {
    const over = hostDelivery("user-prompt-submit", { injection: "x".repeat(TUNABLES.HOST_OUTPUT_CHARS + 1), ask: null }, {});
    expect(over.overCap).toEqual({ chars: TUNABLES.HOST_OUTPUT_CHARS + 1, limitChars: TUNABLES.HOST_OUTPUT_CHARS });
    const under = hostDelivery("user-prompt-submit", { injection: "x".repeat(9_000), ask: null }, {});
    expect(under.overCap).toBeUndefined();
    // ...and the same when a notice had to be dropped to fall back to plain.
    const dropped = hostDelivery("session-start", { injection: "y".repeat(TUNABLES.HOST_OUTPUT_CHARS + 5), ask: null }, {}, ["a red doctor line"]);
    expect(dropped.dropped).not.toBeNull();
    expect(dropped.overCap?.chars).toBe(TUNABLES.HOST_OUTPUT_CHARS + 5);
  });
});

// The first-ask thresholds the seeding relies on (an asked session owes in full).
test("seeding assumption: a 9-turn ask is past the first-ask threshold", () => {
  expect(SELF_TUNABLES.FIRST_ASK_TURNS).toBeLessThanOrEqual(9);
});
