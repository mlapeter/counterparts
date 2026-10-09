/**
 * A REPEAT IS KEPT ALIVE BY COMING ROUND (2026-10-09, the owner's decision on
 * question 1 of #339's review) — through the real hook path, one simulated day
 * at a time: the prompt hook (`userPromptSubmit`, whose recall spends a quiet
 * fire), the envelope that claims a plain line (`deliverTurn`), and the evening
 * boundary (`sessionEnd`, which advances the lived-day clock and runs the
 * nightly prune).
 *
 *   - the FIRST delivery of each occurrence — a quiet fire, or a plain line
 *     claimed — counts as one use of the memory, at the `surfaced` tier;
 *   - once per occurrence: a quiet weekly fired twice in one window, or a plain
 *     weekly fired in its lead and told on its day, is credited once;
 *   - a one-off date is unchanged, and a repeat whose `recurring` was dropped
 *     is credited no more and fades to the prune like any memory;
 *   - a live repeat is refused by the prune by name (`recurring`): a yearly one
 *     is used once a year, and one use does not outlast 365 lived days at the
 *     default salience. It still fades: a QUIET yearly that faded is refused
 *     `faded` at its next occurrence, unchanged (named, not fixed).
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlainReminder } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, pruneVerdict, strength } from "../src/core/physics/index.js";
import { CUE_MODE_META, RECURRING_META } from "../src/core/prospective/index.js";
import type { CycleReport } from "../src/core/sleep/index.js";
import { recurrenceOfRow } from "../src/core/store/index.js";
import type { Store } from "../src/core/store/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
import { addDays } from "../src/core/time.js";
import type { Kind } from "../src/core/types.js";
import { ClaudeCodeAdapter, openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import { deliverTurn } from "../src/adapters/claude-code/bin/hook.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-recurring-reinforce-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** The authored default claim a `note` gets when its author claims nothing. */
const DEFAULTED = { relevance: 0.25, emotional: 0.25, predictive: 0.25 };
const CONFIG = (): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: 20_000, owner: true });
const RUNNER = { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) };

function hooks(): ClaudeCodeAdapter {
  const a = openAdapter(CONFIG(), RUNNER);
  open.push(a.counterpart);
  return a;
}

/** A reminder written straight to the store: the default salience, as a silent note gets. */
function reminder(
  s: Store,
  r: { title: string; date: string; rule: string | null; mode: "plain" | "quiet"; learnedOn: string; kind?: Kind },
): string {
  return s.put({
    type: "memory",
    kind: r.kind ?? "fact",
    title: r.title,
    body: `${r.title}, as it was said, with enough words in it to be a memory.`,
    learnedOn: r.learnedOn,
    salience: DEFAULTED,
    eventDate: r.date,
    meta: { [CUE_MODE_META]: r.mode, ...(r.rule === null ? {} : { [RECURRING_META]: r.rule }) },
  });
}

function doors(a: ClaudeCodeAdapter): Parameters<typeof deliverTurn>[4] {
  return {
    updateNotice: () => null,
    markUpdateNotice: () => false,
    claimPlain: (i: HookInput, due: readonly PlainReminder[]) => a.claimPlain(i, due),
  };
}

/** One prompt through the hooks on `date`: recall (which spends quiet fires),
 *  then the envelope (which claims the plain lines it carries). The person's
 *  line, or null. */
function morning(a: ClaudeCodeAdapter, date: string, session = `s-${date}`): string | null {
  const input: HookInput = { sessionId: session, scope: "proj", turns: [], at: date, prompt: "what is on for today" };
  const turn = a.userPromptSubmit(input);
  const out = deliverTurn("user-prompt-submit", turn, {}, null, doors(a), input);
  // With nothing for the person the envelope is the plain context text; a
  // line for the person makes it JSON with a `systemMessage`.
  if (!out.stdout.startsWith("{")) return null;
  const said = (JSON.parse(out.stdout) as { systemMessage?: unknown }).systemMessage;
  return typeof said === "string" ? said : null;
}

/** The evening boundary: the lived-day clock, then the whole cycle, prune included. */
async function evening(a: ClaudeCodeAdapter, date: string): Promise<CycleReport> {
  return (await a.counterpart.sessionEnd({ date, at: date })).cycle;
}

function blocked(cycle: CycleReport, reason: string): number {
  return cycle.phases.find((p) => p.phase === "prune")?.skipped[`blocked:${reason}`] ?? 0;
}

function uses(s: Store, id: string): number {
  return s.row(id)?.uses ?? Number.NaN;
}

// ═══════════════════════════════════════════════════════════════════════════

describe("each occurrence that reaches the person counts as a use", () => {
  test("a DAILY plain repeat over 200 lived days: said every morning, credited once a day, never let go", async () => {
    const a = hooks();
    const s = a.counterpart.store;
    const id = reminder(s, { title: "take the blue pill", date: "2026-10-10", rule: "daily", mode: "plain", learnedOn: "2026-10-09" });
    await evening(a, "2026-10-09");
    let date = "2026-10-09";
    let told = 0;
    for (let i = 0; i < 200; i++) {
      date = addDays(date, 1);
      if (morning(a, date)?.includes("take the blue pill") === true) told += 1;
      // A second prompt that day says nothing more and credits nothing more.
      expect(morning(a, date, `s-${date}-later`)).toBeNull();
      await evening(a, date);
    }
    const row = s.row(id);
    if (row === undefined) throw new Error("the repeat is gone");
    expect(told).toBe(200);
    expect(row.archived).toBe(0);
    expect(row.uses).toBe(0.25 * 200);
    expect(row.reinforced_days).toBe(200);
    const day = s.livedDay();
    expect(row.last_used_day).toBe(day - 1);
    const p = rowToPhysics(row);
    expect(strength(p, day)).toBeGreaterThan(PHYSICS.THETA_SEM - 0.01);
    // The counterfactual: never credited, the same memory would have been
    // under the floor and past the dwell long before day 200 (~152).
    const unused = { ...p, uses: 0, lastUsedDay: p.birthDay };
    expect(strength(unused, day)).toBeLessThan(PHYSICS.PHI_PRUNE);
    expect(pruneVerdict(unused, day, { inLiveRevisionChain: false }).prune).toBe(true);
    // A schedule earns no RETURN: the credit is `surfaced`, so the core's
    // lanes do not move on the calendar alone.
    expect(row.return_days).toBe(0);
  });

  test("a YEARLY plain repeat survives three years: credited each May 14, kept between by the prune's `recurring` gate", async () => {
    const a = hooks();
    const s = a.counterpart.store;
    const id = reminder(s, { title: "call Ruth for her birthday", date: "1955-05-14", rule: "yearly", mode: "plain", learnedOn: "2027-05-01", kind: "person" });
    // Its QUIET twin, a month later in the year (named, not fixed: see below).
    const quiet = reminder(s, { title: "send Ada a card", date: "1958-06-20", rule: "yearly", mode: "quiet", learnedOn: "2027-05-01", kind: "person" });
    await evening(a, "2027-05-01");
    const told: string[] = [];
    let refusedByRecurring = 0;
    let wouldHavePruned = 0;
    let date = "2027-05-01";
    while (date < "2030-05-20") {
      date = addDays(date, 1);
      if (morning(a, date)?.includes("call Ruth") === true) told.push(date);
      const cycle = await evening(a, date);
      const row = s.row(id);
      if (row === undefined || row.archived !== 0) throw new Error(`the yearly repeat was let go on ${date}`);
      if (blocked(cycle, "recurring") > 0) refusedByRecurring += 1;
      // Without the gate the floor prune would have taken it on this night.
      if (pruneVerdict(rowToPhysics(row), cycle.day, { inLiveRevisionChain: false }).prune) wouldHavePruned += 1;
    }
    expect(told).toEqual(["2027-05-14", "2028-05-14", "2029-05-14", "2030-05-14"]);
    // Once per occurrence, at the surfaced tier.
    expect(uses(s, id)).toBe(0.25 * 4);
    // The gap is real: one use a year does not outlast it, and the gate is
    // what held it.
    expect(wouldHavePruned).toBeGreaterThan(100);
    expect(refusedByRecurring).toBeGreaterThanOrEqual(wouldHavePruned);
    expect(s.row(quiet)?.archived).toBe(0);

    // NAMED, NOT FIXED (the owner kept fading): the quiet twin fired and was
    // credited at its first occurrence, 50 lived days after it was noted;
    // a year later it had faded, and prospective's `faded` refusal (§12 G10)
    // still holds — alive, unpruned, and not cued.
    expect(s.prospectiveFor(quiet).map((r) => r.window_key)).toEqual(["d:2027-06-20"]);
    expect(uses(s, quiet)).toBe(0.25);
    expect(a.counterpart.prospective.deriveFor(quiet, "2028-06-20", [], s.livedDay())?.blockedBy).toContain("faded");
  });

  test("a QUIET weekly fired twice in each window is credited once per window, on its first fire", async () => {
    const a = hooks();
    const s = a.counterpart.store;
    const id = reminder(s, { title: "water the fig tree", date: "2026-10-12", rule: "weekly", mode: "quiet", learnedOn: "2026-10-09" });
    await evening(a, "2026-10-09");
    const creditedOn: string[] = [];
    const firstFireOn: string[] = [];
    let date = "2026-10-09";
    while (date < "2026-11-02") {
      date = addDays(date, 1);
      const before = uses(s, id);
      const windows = s.prospectiveFor(id).length;
      // Two sessions a day: the second is refused by once-a-lived-day.
      morning(a, date);
      morning(a, date, `s-${date}-later`);
      if (s.prospectiveFor(id).length > windows) firstFireOn.push(date);
      if (uses(s, id) > before) creditedOn.push(date);
      await evening(a, date);
    }
    // Each Monday's window spent its whole budget, on two lived days...
    expect(s.prospectiveFor(id).map((r) => [r.window_key, r.fires])).toEqual([
      ["d:2026-10-12", 2],
      ["d:2026-10-19", 2],
      ["d:2026-10-26", 2],
      ["d:2026-11-02", 2],
    ]);
    // ...and eight fires are four occurrences: four credits, each on the day
    // its window first fired, and none on the second.
    expect(firstFireOn).toHaveLength(4);
    expect(creditedOn).toEqual(firstFireOn);
    expect(uses(s, id)).toBe(0.25 * 4);
  });

  test("a PLAIN weekly fired quietly before its day and told on it is ONE occurrence, credited once", async () => {
    const a = hooks();
    const s = a.counterpart.store;
    const id = reminder(s, { title: "put the bins out", date: "2026-10-12", rule: "weekly", mode: "plain", learnedOn: "2026-10-09" });
    await evening(a, "2026-10-09");
    const told: string[] = [];
    const creditedOn: string[] = [];
    let date = "2026-10-09";
    while (date < "2026-10-26") {
      date = addDays(date, 1);
      const before = uses(s, id);
      if (morning(a, date)?.includes("put the bins out") === true) told.push(date);
      if (uses(s, id) > before) creditedOn.push(date);
      await evening(a, date);
    }
    expect(told).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    // A plain item still arrives as a quiet cue before its day: each Monday's
    // window was reached first by a fire in its lead, so the Monday line, the
    // same occurrence, credited nothing more.
    const leadFires = s.prospectiveFor(id).filter((r) => r.fires > 0).map((r) => r.window_key);
    expect(leadFires).toEqual(["d:2026-10-12", "d:2026-10-19", "d:2026-10-26"]);
    expect(creditedOn).toHaveLength(3);
    for (const d of creditedOn) expect(told).not.toContain(d);
    expect(uses(s, id)).toBe(0.25 * 3);
  });
});

describe("what is not a repeat is not credited", () => {
  test("a ONE-OFF date, plain or quiet, is told or fired and credited nothing — and the floor prune lets it go as before", async () => {
    const a = hooks();
    const s = a.counterpart.store;
    const plain = reminder(s, { title: "renew the passport", date: "2026-10-12", rule: null, mode: "plain", learnedOn: "2026-10-09" });
    const quiet = reminder(s, { title: "the plumber comes round", date: "2026-10-14", rule: null, mode: "quiet", learnedOn: "2026-10-09" });
    await evening(a, "2026-10-09");
    const born = rowToPhysics(s.row(plain) ?? (undefined as never)).birthDay;
    const told: string[] = [];
    const pruned = new Map<string, string>();
    let date = "2026-10-09";
    for (let i = 0; i < 180; i++) {
      date = addDays(date, 1);
      if (morning(a, date)?.includes("renew the passport") === true) told.push(date);
      const cycle = await evening(a, date);
      expect(blocked(cycle, "recurring")).toBe(0);
      for (const r of cycle.pruned) if (!pruned.has(r.id)) pruned.set(r.id, date);
    }
    expect(told).toEqual(["2026-10-12"]);
    expect(s.prospectiveFor(quiet).length).toBe(1);
    for (const id of [plain, quiet]) {
      const row = s.row(id);
      expect(row?.uses).toBe(0);
      expect(row?.last_used_day).toBe(born);
      expect(row?.archived_reason).toBe("pruned");
      expect(pruned.has(id)).toBe(true);
    }
  });

  test("dropping `recurring` (updates + recurring: null) stops the credit, and the memory fades to the prune like any other", async () => {
    let clock = Date.parse("2026-10-09T12:00:00Z");
    const server: McpServer = openServer({ dir, session: "sess_drop", scope: "/scope/one", owner: true, now: () => clock, timeZone: "UTC" });
    open.push(server.counterpart);
    const a = new ClaudeCodeAdapter({ counterpart: server.counterpart, config: CONFIG(), ...RUNNER });
    const s = server.counterpart.store;
    const note = async (args: Record<string, unknown>): Promise<string> => {
      const body = (await server.call("note", args)).structuredContent;
      expect(body["stored"]).toBe(true);
      return body["id"] as string;
    };
    const old = await note({ text: "Take the blue pill with breakfast every morning, the small round one.", eventDate: "2026-10-10", remind: "plain", recurring: "daily" });
    await evening(a, "2026-10-09");
    let date = "2026-10-09";
    const day = async (): Promise<{ said: string | null; cycle: CycleReport }> => {
      date = addDays(date, 1);
      clock += 86_400_000;
      const said = morning(a, date);
      return { said, cycle: await evening(a, date) };
    };
    for (let i = 0; i < 5; i++) expect((await day()).said).toContain("blue pill");
    expect(uses(s, old)).toBe(0.25 * 5);

    const id = await note({ text: "The blue pill was only for this week; the doctor stopped it on the fourteenth.", updates: old, recurring: null });
    expect(s.readProse(id).meta[RECURRING_META]).toBeUndefined();
    expect(s.recurringMemories()).toEqual([]);
    for (const m of [old, id]) {
      const row = s.row(m);
      if (row !== undefined) expect(recurrenceOfRow(row)).toBeNull();
    }
    const after = uses(s, id);
    let letGo: string | null = null;
    for (let i = 0; i < 220 && letGo === null; i++) {
      const { said, cycle } = await day();
      expect(said ?? "").not.toContain("blue pill");
      expect(blocked(cycle, "recurring")).toBe(0);
      if (cycle.pruned.some((r) => r.id === id)) letGo = date;
    }
    expect(uses(s, id)).toBe(after);
    expect(letGo).not.toBeNull();
    expect(s.row(id)?.archived_reason).toBe("pruned");
  });
});
