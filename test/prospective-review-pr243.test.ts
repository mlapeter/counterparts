/**
 * PR #243's adversarial review (2026-09-26) — the fixes, one describe each:
 *
 *   - a plain beat is CLAIMED ONLY WHEN THE ENVELOPE CARRIES IT: a full wake at
 *     SessionStart defers it to the first prompt instead of spending it on a
 *     line the terminal never shows; the update notice can never cost a plain
 *     line that fit; a lost race strips the line from the model's copy too;
 *   - the host-mode page writer's headless child is told nothing;
 *   - the latch holds across two real processes;
 *   - an explicit `eventDate` skips the salience floor (owner decision), and a
 *     faded or archived memory still never arrives;
 *   - a quiet fire row carries its calendar date, so the gauge counts it on the
 *     day it was asked in any zone;
 *   - a store with nothing dated delivers exactly what it did before.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import type { PlainReminder } from "../src/core/counterpart.js";
import type { PutInput, Store } from "../src/core/store/index.js";
import type { Salience } from "../src/core/types.js";
import {
  CUE_MODE_META,
  PROSPECTIVE_FIRE_EVENT,
  PROSPECTIVE_PLAIN_EVENT,
  TUNABLES,
  derive,
} from "../src/core/prospective/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { openAdapter, plainContextLine, plainLine, withoutPlain } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import { deliverTurn, hostDelivery, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { TUNABLES as ADAPTER_TUNABLES } from "../src/adapters/config.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-pr243-"));
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

const SALIENT: Partial<Salience> = { relevance: 0.7, emotional: 0.7, predictive: 0.7 };
/** The authored default claim a `note` gets when its author claims nothing. */
const DEFAULTED: Partial<Salience> = { relevance: 0.25, emotional: 0.25, predictive: 0.25 };

let n = 0;
function dated(s: Store, date: string, input: Partial<PutInput> = {}): string {
  n += 1;
  return s.put({
    type: "memory",
    kind: "fact",
    body: `A dated plan number ${n}, with enough words in it to be a memory.`,
    learnedOn: "2026-08-25",
    salience: SALIENT,
    eventDate: date,
    ...input,
  });
}

function hooks(budget = 20_000): ReturnType<typeof openAdapter> {
  const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: budget, owner: true };
  const a = openAdapter(config, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
  open.push(a.counterpart);
  return a;
}

function input(over: Partial<HookInput> = {}): HookInput {
  return { sessionId: "s1", scope: "proj", turns: [], at: "2026-10-15", ...over };
}

const plainRows = (s: Store): number => s.eventLog({ name: PROSPECTIVE_PLAIN_EVENT }).length;

// ═══════════════════════════════════════════════════════════════════════════
// Claim only what the envelope carries
// ═══════════════════════════════════════════════════════════════════════════

describe("a plain beat is claimed only when its line is certainly leaving", () => {
  test("a FULL wake at SessionStart: nothing claimed, the line leaves the model's copy too, the first prompt says it", () => {
    const a = hooks();
    const id = dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const woke = a.sessionStart(input());
    expect(woke.plain?.map((r) => r.memoryId)).toEqual([id]);
    // A wake the size of the owner's (~9 KB) leaves no room in the host's
    // 10,000-character envelope for the systemMessage.
    const full = { ...woke, injection: `${woke.injection ?? ""}\n${"x".repeat(ADAPTER_TUNABLES.HOST_OUTPUT_CHARS)}` };
    const doors = { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i: HookInput, due: readonly PlainReminder[]) => a.claimPlain(i, due) };
    const start = deliverTurn("session-start", full, { hook_event_name: "SessionStart" }, [null, null], doors, input());
    expect(start.stdout).not.toContain("pay your taxes");
    expect(start.dropped).not.toBeNull();
    expect(plainRows(a.counterpart.store)).toBe(0);

    // The first prompt's envelope is small: said there, once, and claimed.
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    const said = deliverTurn("user-prompt-submit", turn, {}, null, doors, input());
    expect((JSON.parse(said.stdout) as Record<string, unknown>)["systemMessage"]).toBe("Today: pay your taxes");
    expect(plainRows(a.counterpart.store)).toBe(1);
    const again = a.userPromptSubmit(input({ prompt: "and again" }));
    expect(again.plain).toBeUndefined();
  });

  test("the person's lines are a field of their own: a turn whose recall fills the model's field to the cap still says all three", () => {
    const a = hooks();
    for (const what of ["pay your taxes", "call the plumber", "renew the passport"]) {
      dated(a.counterpart.store, "2026-10-15", { title: what, meta: { [CUE_MODE_META]: "plain" } });
    }
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    expect(turn.plain).toHaveLength(3);
    // The model's field at exactly the host's cap (measured 2026-10-10: each
    // field is capped on its own, and the escaped envelope may be longer).
    const full = { ...turn, injection: `${turn.injection ?? ""}\n${"y".repeat(ADAPTER_TUNABLES.HOST_OUTPUT_CHARS - (turn.injection ?? "").length - 1)}` };
    const doors = { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i: HookInput, due: readonly PlainReminder[]) => a.claimPlain(i, due) };
    const out = deliverTurn("user-prompt-submit", full, {}, null, doors, input());
    expect(out.stdout.length).toBeGreaterThan(ADAPTER_TUNABLES.HOST_OUTPUT_CHARS);
    const parsed = JSON.parse(out.stdout) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
    expect(parsed.systemMessage.split("\n")).toHaveLength(3);
    expect(parsed.hookSpecificOutput.additionalContext).toBe(full.injection);
    expect(plainRows(a.counterpart.store)).toBe(3);
  });

  test("more plain lines than the person's field holds: the ones that fit are said and claimed, the rest wait", () => {
    const a = hooks();
    dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    const first = turn.plain?.[0];
    if (first === undefined) throw new Error("no plain record");
    // Ninety lines of 120 characters: past the 10,000 one field holds.
    const due = Array.from({ length: 90 }, (_, i) => ({ ...first, memoryId: `mem_${String(i)}`, what: `${String(i).padStart(3, "0")} ${"w".repeat(116)}` }));
    let claimed: readonly PlainReminder[] = [];
    let gave = -1;
    const doors = {
      updateNotice: () => null,
      markUpdateNotice: () => false,
      claimPlain: (_i: HookInput, d: readonly PlainReminder[]) => (claimed = d),
      noteGaveWay: (_i: HookInput, part: string, count: number) => {
        if (part === "plain") gave = count;
      },
    };
    const out = deliverTurn("user-prompt-submit", { injection: "recall", ask: null, plain: due }, {}, null, doors, input());
    const message = (JSON.parse(out.stdout) as { systemMessage: string }).systemMessage;
    const fits = Math.floor((ADAPTER_TUNABLES.HOST_OUTPUT_CHARS + 1) / (plainLine(due[0] ?? first).length + 1));
    expect(message.split("\n")).toHaveLength(fits);
    expect(message.length).toBeLessThanOrEqual(ADAPTER_TUNABLES.HOST_OUTPUT_CHARS);
    expect(claimed.map((d) => d.memoryId)).toEqual(due.slice(0, fits).map((d) => d.memoryId));
    expect(gave).toBe(90 - fits);
  });

  test("the update notice never costs a plain line that fit", () => {
    const a = hooks();
    dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    // Room in the person's field for the plain line, not for the plain line
    // AND an update notice as long as the field.
    const line = "Today: pay your taxes";
    let marked = false;
    const out = deliverTurn(
      "user-prompt-submit",
      turn,
      {},
      null,
      {
        updateNotice: () => `Counterparts was updated. ${"z".repeat(ADAPTER_TUNABLES.HOST_OUTPUT_CHARS - 40)}`,
        markUpdateNotice: () => (marked = true),
        claimPlain: (i, due) => a.claimPlain(i, due),
      },
      input(),
    );
    expect((JSON.parse(out.stdout) as Record<string, unknown>)["systemMessage"]).toBe(line);
    expect(marked).toBe(false);
    expect(out.dropped).not.toBeNull();
    expect(plainRows(a.counterpart.store)).toBe(1);
  });

  test("a claim lost to another process strips the line from the terminal AND the model's copy", () => {
    const a = hooks();
    dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    expect(turn.injection).toContain("pay your taxes");
    // The other process won: this one's claim comes back empty.
    const out = deliverTurn("user-prompt-submit", turn, {}, null, { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: () => [] }, input());
    expect(out.stdout).not.toContain("pay your taxes");
    expect(out.stdout.startsWith("Now: ")).toBe(true);
    // And doors that cannot claim show nothing either.
    const none = deliverTurn("user-prompt-submit", turn, {}, null, { updateNotice: () => null, markUpdateNotice: () => false }, input());
    expect(none.stdout).not.toContain("pay your taxes");
  });

  test("withoutPlain takes out exactly the dropped ones", () => {
    const r = (id: string, what: string): PlainReminder => ({
      memoryId: id,
      windowKey: "d:2026-10-15",
      eventDate: "2026-10-15",
      precision: "day",
      beat: "day",
      firstDay: "2026-10-15",
      lastDay: "2026-10-15",
      what,
    });
    const a = r("mem_a", "pay taxes");
    const b = r("mem_b", "call mum");
    const res = {
      injection: `Now: x\n${plainContextLine(a)}\n${plainContextLine(b)}\nrecall`,
      ask: null,
      notices: ["Today: pay taxes", "Today: call mum"],
      plain: [a, b],
    };
    const out = withoutPlain(res, [a]);
    expect(out.injection).toBe(`Now: x\n${plainContextLine(b)}\nrecall`);
    expect(out.notices).toEqual(["Today: call mum"]);
    expect(out.plain).toEqual([b]);
    const empty = withoutPlain(res, [a, b]);
    expect(empty.plain).toBeUndefined();
    expect(empty.notices).toBeUndefined();
  });

  test("a plain line told at a prompt is not ALSO handed over as a quiet cue that turn", () => {
    const a = hooks();
    const id = dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const turn = a.userPromptSubmit(input({ prompt: "zygomorphic vellichor quixotry" }));
    expect(turn.plain?.map((r) => r.memoryId)).toEqual([id]);
    expect(turn.footnotes ?? []).not.toContain(id);
    expect(a.counterpart.store.prospectiveFor(id)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The headless nightly run's child is told nothing
// ═══════════════════════════════════════════════════════════════════════════

describe("the nightly run's headless session", () => {
  test("toHookInput marks it, and SessionStart and a prompt then offer no plain line", () => {
    const marked = toHookInput({ session_id: "s9" }, { scope: "proj", env: { COUNTERPARTS_NIGHT_RUN: "run-1" } });
    expect(marked.nightRun).toBe(true);
    expect(toHookInput({ session_id: "s9" }, { scope: "proj", env: {} }).nightRun).toBeUndefined();
    // The removed host-mode writer's variable marks nothing any more (2026-09-29).
    const old = toHookInput({ session_id: "s9" }, { scope: "proj", env: { COUNTERPARTS_PAGE_WRITER: "2026-10-14" } });
    expect(old.nightRun).toBeUndefined();

    const a = hooks();
    dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const child = input({ nightRun: true });
    expect(a.sessionStart(child).plain).toBeUndefined();
    expect(a.userPromptSubmit({ ...child, prompt: "write the page" }).plain).toBeUndefined();
    expect(plainRows(a.counterpart.store)).toBe(0);
    // The owner's own session, afterwards, still gets it.
    expect(a.sessionStart(input()).plain).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The latch across two real processes
// ═══════════════════════════════════════════════════════════════════════════

describe("two hook processes racing for one beat", () => {
  test("both see it due, both try to claim it at once, exactly one is told", async () => {
    const setup = Counterpart.open({ dir: join(dir, "store"), owner: true });
    const id = dated(setup.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    setup.close();

    const go = join(dir, "go");
    const counterpart = resolve(import.meta.dir, "../src/core/counterpart.ts");
    const child = `
      import { existsSync, writeFileSync } from "node:fs";
      import { Counterpart } from ${JSON.stringify(counterpart)};
      const [store, work, go, me] = process.argv.slice(2);
      const c = Counterpart.open({ dir: store, owner: true });
      const due = c.plainDueToday({ at: "2026-10-15" });
      writeFileSync(work + "/ready-" + me, String(due.length));
      const until = Date.now() + 10_000;
      while (!existsSync(go) && Date.now() < until) Bun.sleepSync(1);
      const won = due.filter((r) => c.claimPlainReminder(r, { at: "2026-10-15" }));
      c.close();
      console.log(JSON.stringify({ due: due.length, won: won.length }));
    `;
    const script = join(dir, "child.ts");
    writeFileSync(script, child);
    const bun = process.execPath;
    const procs = ["a", "b"].map((me) =>
      Bun.spawn([bun, script, join(dir, "store"), dir, go, me], { stdout: "pipe", stderr: "pipe", env: { ...process.env } }),
    );
    const until = Date.now() + 10_000;
    while (!(existsSync(join(dir, "ready-a")) && existsSync(join(dir, "ready-b"))) && Date.now() < until) {
      await Bun.sleep(5);
    }
    writeFileSync(go, "");
    const outs = await Promise.all(procs.map(async (p) => {
      await p.exited;
      const text = (await new Response(p.stdout).text()).trim();
      if (text.length === 0) throw new Error(`child said nothing: ${await new Response(p.stderr).text()}`);
      return JSON.parse(text) as { due: number; won: number };
    }));
    expect(outs.map((o) => o.due)).toEqual([1, 1]);
    expect(outs.map((o) => o.won).sort()).toEqual([0, 1]);

    const after = Counterpart.open({ dir: join(dir, "store"), owner: true });
    open.push(after);
    const rows = after.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT });
    expect(rows.map((r) => r.ref)).toEqual([id]);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Owner decision 2026-09-26: an explicit eventDate skips the salience floor
// ═══════════════════════════════════════════════════════════════════════════

const NOTHING = "zygomorphic vellichor quixotry";
const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
];

describe("an explicit eventDate is its own importance signal", () => {
  test("a QUIET note at the authored default salience comes back as a footnote on its day, and spends its fire", async () => {
    const s = openServer({ dir, session: "sess_floor", scope: "/scope/one", owner: true });
    open.push(s.counterpart);
    for (const body of FILLER) s.counterpart.store.put({ type: "memory", kind: "fact", body });
    const body = (
      await s.call("remember", {
        text: "The passport renewal appointment is at the consulate on the fourth.",
        title: "passport renewal appointment",
        eventDate: "2026-09-04",
      })
    ).structuredContent;
    expect(body["stored"]).toBe(true);
    const id = body["id"] as string;
    const sal = s.counterpart.store.read(id).physics.salience;
    // Well under the 0.6 floor: nothing but the date is carrying it.
    expect(Math.max(sal.relevance, sal.emotional, sal.predictive)).toBeLessThan(TUNABLES.SALIENCE_FLOOR);

    const turn = s.counterpart.recallForTurn({ sessionId: "t1", text: NOTHING }, { at: "2026-09-04" });
    expect(turn.decision.footnotes).toContain(id);
    expect(turn.decision.surfaced).not.toContain(id);
    const fired = s.counterpart.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT });
    expect(fired.map((r) => r.ref)).toEqual([id]);
    // The calendar day rides the row, so the gauge counts it on that day in any zone.
    expect(JSON.parse(fired[0]?.payload ?? "{}")["date"]).toBe("2026-09-04");
  });

  test("the floor still gates a date a CALLER extracted; decay and archival still hold for an explicit one", () => {
    const c = Counterpart.open({ dir, owner: true });
    open.push(c);
    // Explicit, dull: eligible.
    const dull = dated(c.store, "2026-09-04", { salience: DEFAULTED });
    expect(c.prospective.deriveFor(dull, "2026-09-04")?.reason).toBe("eligible");
    // No column date, the same dull memory, a caller-extracted date: the floor.
    const undated = c.store.put({ type: "memory", kind: "fact", body: "Something dull with no date of its own at all.", learnedOn: "2026-08-25", salience: DEFAULTED });
    expect(c.prospective.deriveFor(undated, "2026-09-04", [{ date: "2026-09-04" }])?.reason).toBe("below-salience-floor");
    // Faded to nothing (no salience at all): never arrives, explicit or not.
    const faded = dated(c.store, "2026-09-04", { salience: { relevance: 0, emotional: 0, predictive: 0 } });
    expect(c.prospective.deriveFor(faded, "2026-09-04")?.blockedBy).toContain("faded");
    // Archived: never arrives.
    const gone = dated(c.store, "2026-09-04", { salience: DEFAULTED });
    c.store.archive(gone, "done already");
    expect(c.prospective.deriveFor(gone, "2026-09-04")?.blockedBy).toContain("archived");
    const arrived = c.prospective.arrivals({ at: "2026-09-04" }).arrivals.map((a) => a.memoryId);
    expect(arrived).toContain(dull);
    expect(arrived).not.toContain(faded);
    expect(arrived).not.toContain(gone);
    expect(arrived).not.toContain(undated);
  });

  test("the predicate itself: explicitDate lifts the floor and nothing else", () => {
    const base = {
      id: "mem_x",
      kind: "fact" as const,
      salience: { novelty: null, relevance: 0.2, emotional: 0.2, predictive: 0.2, claimed: null },
      archived: false,
      learnedOn: "2026-08-25",
      journal: false,
    };
    const dates = [{ date: "2026-09-04" }];
    expect(derive(base, dates, "2026-09-04", TUNABLES).reason).toBe("below-salience-floor");
    expect(derive({ ...base, explicitDate: true }, dates, "2026-09-04", TUNABLES).reason).toBe("eligible");
    expect(derive({ ...base, explicitDate: true, faded: true }, dates, "2026-09-04", TUNABLES).reason).toBe("faded");
    expect(derive({ ...base, explicitDate: true, archived: true }, dates, "2026-09-04", TUNABLES).reason).toBe("archived");
    expect(derive({ ...base, explicitDate: true, journal: true }, dates, "2026-09-04", TUNABLES).reason).toBe("journal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Upgrade: a store with nothing dated delivers exactly what it did before
// ═══════════════════════════════════════════════════════════════════════════

describe("a store with nothing dated", () => {
  test("SessionStart and a prompt carry no plain records, and the delivery is plain hostDelivery", () => {
    const a = hooks();
    a.counterpart.store.put({ type: "memory", kind: "fact", body: "An ordinary memory with no date on it at all." });
    const doors = { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i: HookInput, due: readonly PlainReminder[]) => a.claimPlain(i, due) };
    const woke = a.sessionStart(input());
    expect(woke.plain).toBeUndefined();
    expect(woke.notices).toBeUndefined();
    expect(deliverTurn("session-start", woke, {}, [null, null], doors, input())).toEqual(
      hostDelivery("session-start", woke, {}, [null, null]),
    );
    const turn = a.userPromptSubmit(input({ prompt: "hello" }));
    expect(turn.plain).toBeUndefined();
    expect(deliverTurn("user-prompt-submit", turn, {}, null, doors, input())).toEqual(
      hostDelivery("user-prompt-submit", turn, {}, null),
    );
    expect(plainRows(a.counterpart.store)).toBe(0);
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT })).toEqual([]);
  });
});
