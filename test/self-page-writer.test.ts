/**
 * THE NIGHTLY PAGE WRITER (S2) — which day it reads, what it is handed, the
 * claim that stops two of them running, the ask beside the wake, the door that
 * writes `by: "writer"`, and the row every attempt leaves.
 *
 * Its own file, for the reason `test/self-page-console.test.ts` gives for
 * being one: the mechanism crosses `self/`, the hook adapter, the MCP server,
 * doctor and the fired view, and the tests that prove it belong together rather
 * than scattered a few at a time through five suites.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, made in
 * `beforeEach` and removed in `afterEach` whether or not an expectation failed.
 *
 * The page bodies and the memories here are NEUTRAL PLACEHOLDER PROSE. A
 * fixture that reads like a real first-person identity is a fixture somebody
 * later mistakes for one.
 *
 * NO TEST HERE STARTS A REAL HOST SESSION, launches `claude`, or reaches a
 * network. Host mode is proved against a stub executable this file writes into
 * its own temp directory; what genuinely needs a real machine is written down
 * in the PR, not run.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import {
  PAGE_CORE_HEADING,
  PAGE_LATELY_HEADING,
  PAGE_WRITER_MODES,
  PAGE_WRITER_OPEN,
  SELF_PAGE_WRITER_EVENT,
  SELF_TUNABLES,
  dayBefore,
  dayMemories,
  hasDayBefore,
  lastPageWriterRun,
  pageWriterAbout,
  pageWriterClaimOpen,
  pageWriterDue,
  pageWriterRuns,
  pageWriterStatus,
  writerInstruction,
} from "../src/core/self/index.js";
import {
  ClaudeCodeAdapter,
  MCP_SELF_PAGE_TOOL,
  PAGE_WRITER_ENV,
  loadConfig,
  openAdapter,
  pageWriterFindings,
  pageWriterMode,
  planPageWriter,
  runPageWriter,
} from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { MECHANISMS, firedReport } from "../src/adapters/fired.js";
import { DURABLE_EVENT_NAMES } from "../src/adapters/dashboard/registries.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { readSession, recordSession } from "../src/adapters/sessions.js";
import { dateOf } from "../src/core/store/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;
const SCOPE = "/scope/writer";

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-writer-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed by the test */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function counterpart(over: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, budgetBytes: BUDGET_BYTES, ...over });
  open.push(c);
  return c;
}

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: BUDGET_BYTES, owner: true, ...over };
}

/**
 * An adapter over the temp store, with this directory's scope ANSWERED.
 *
 * Answered deliberately: an `unset` directory raises the first-launch question
 * at SessionStart, which takes the one ask field, and every test here would then
 * be measuring that instead. The one test that is about the collision says
 * `scope: "unset"` for itself.
 */
function adapter(
  over: Partial<AdapterConfig> = {},
  mode: ScopeVerdict["mode"] = "on",
): ClaudeCodeAdapter {
  const a = openAdapter(config(over), {
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 1 }),
    scope: { mode, matched: SCOPE, entry: null },
  });
  open.push(a.counterpart);
  return a;
}

function hook(sessionId: string, over: Partial<HookInput> = {}): HookInput {
  return { hook: "session-start", sessionId, scope: SCOPE, ...over } as HookInput;
}

const PAGE = `## ${PAGE_CORE_HEADING}\n\nCore: placeholder.\n\n## ${PAGE_LATELY_HEADING}\n\nLately: placeholder.`;

/** Memories dated to the day the writer will be asked about. */
function seedYesterday(c: Counterpart, bodies: readonly string[]): string[] {
  const about = pageWriterAbout(c.store.today());
  return bodies.map((body) =>
    c.store.put({ type: "memory", kind: "fact", body, learnedOn: about }),
  );
}

// ── the date, and day 0 ──────────────────────────────────────────────────────

describe("which day a run is about", () => {
  test("it is always yesterday, by the calendar, and it never chases a backlog", () => {
    expect(dayBefore("2026-09-20")).toBe("2026-09-19");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(pageWriterAbout("2026-09-20")).toBe("2026-09-19");
    // A date that will not read is not a date, and produces no target rather
    // than a guess — the caller turns that into `no-previous-day`.
    expect(dayBefore("not-a-date")).toBe("");
  });

  test("a store with no yesterday is owed nothing, and leaves NO row for it", () => {
    const c = counterpart();
    c.store.put({ type: "memory", kind: "fact", body: "Something learned this morning." });
    expect(hasDayBefore(c.store, c.store.today())).toBe(false);
    const due = c.pageWriterDue({ mode: "session" });
    expect(due.due).toBe(false);
    expect(due.due === false ? due.reason : "").toBe("no-previous-day");
    // The first boundary on a brand-new store writes nothing at all. Day 0 has
    // no night, and a row saying so on a store one hour old is a line people
    // learn to read past.
    expect(pageWriterRuns(c.store)).toEqual([]);
  });

  test("a store that has lived a day IS owed one", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    expect(hasDayBefore(c.store, c.store.today())).toBe(true);
    const due = c.pageWriterDue({ mode: "session" });
    expect(due.due).toBe(true);
    expect(due.about).toBe(pageWriterAbout(c.store.today()));
  });
});

// ── the claim ────────────────────────────────────────────────────────────────

describe("the once-a-night claim", () => {
  test("off and observer are NAMED refusals, not a bare false", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const off = c.pageWriterDue({ mode: "off" });
    expect(off.due === false ? off.reason : "").toBe("off");

    c.close();
    const o = counterpart({ observer: true });
    const obs = o.pageWriterDue({ mode: "session" });
    expect(obs.due === false ? obs.reason : "").toBe("observer");
  });

  test("the first row claims the night; a second boundary is told so", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    expect(c.recordPageWriterRun({ about, mode: "session", outcome: "asked" })).toBe(true);
    const again = c.pageWriterDue({ mode: "session" });
    expect(again.due).toBe(true);
    expect(again.due === true ? again.attempt : 0).toBe(2);
    // ...and once the allowance is spent, nobody else is asked.
    c.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    const spent = c.pageWriterDue({ mode: "session" });
    expect(spent.due === false ? spent.reason : "").toBe("asks-spent");
    expect(SELF_TUNABLES.PAGE_WRITER_ASKS_PER_DAY).toBe(2);
  });

  test("ANY terminal row closes the night, including 'nothing to say'", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    c.recordPageWriterRun({ about, mode: "host", outcome: "nothing-to-say" });
    const due = c.pageWriterDue({ mode: "session" });
    expect(due.due === false ? due.reason : "").toBe("already-claimed");
  });

  test("an observer records nothing at all — not even its own run row", () => {
    const writer = counterpart();
    seedYesterday(writer, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(writer.store.today());
    writer.close();
    const o = counterpart({ observer: true });
    expect(o.recordPageWriterRun({ about, mode: "session", outcome: "asked" })).toBe(false);
    expect(pageWriterRuns(o.store)).toEqual([]);
  });
});

// ── what the day came to ─────────────────────────────────────────────────────

describe("how a night reads afterwards", () => {
  test("a claim made TODAY is a run in flight; one made on a day that ended is 'nothing to say', and says it is derived", () => {
    const c = counterpart();
    const today = c.store.today();
    const about = pageWriterAbout(today);
    c.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    const live = pageWriterStatus(c.store, about, today);
    expect(live.outcome).toBe("asked");
    expect(live.derived).toBe(false);
    expect(pageWriterClaimOpen(c.store, about, today)).toBe(true);

    // The same claim read on the NEXT day: the session was handed the day and
    // nothing came back. Nobody reported that; the reading is ours, and says so.
    const tomorrow = dateOf(Date.parse(`${today}T00:00:00Z`) + 86_400_000);
    const over = pageWriterStatus(c.store, about, tomorrow);
    expect(over.outcome).toBe("nothing-to-say");
    expect(over.derived).toBe(true);
    expect(pageWriterClaimOpen(c.store, about, tomorrow)).toBe(false);
  });

  test("a long-lived store reads the NEWEST rows, not the oldest — `eventLog` cuts the wrong end", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    // Six hundred rows of history, then today's claim. `store.eventLog` orders
    // by seq ASC and cuts at a limit, so an unbounded read of this name on a
    // store that has run for two years hands back the first rows ever written —
    // and every reading here would answer about a month that is over.
    for (let i = 0; i < 600; i += 1) {
      c.recordPageWriterRun({
        about: dayBefore(about, 600 - i),
        mode: "session",
        outcome: "nothing-to-say",
        day: 0,
      });
    }
    c.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    expect(lastPageWriterRun(c.store)?.about).toBe(about);
    expect(pageWriterRuns(c.store, { about })).toHaveLength(1);
    expect(c.pageWriterDue({ mode: "session" }).due).toBe(true);
  });

  test("a terminal row wins over the claim it answers, and is never 'derived'", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    c.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    c.recordPageWriterRun({ about, mode: "session", outcome: "revised", bytesAfter: 120 });
    const status = c.pageWriterStatus(about);
    expect(status.outcome).toBe("revised");
    expect(status.derived).toBe(false);
    expect(status.attempts).toBe(2);
    expect(lastPageWriterRun(c.store)?.outcome).toBe("revised");
  });
});

// ── what the writer is handed ────────────────────────────────────────────────

describe("what the writer reads", () => {
  test("one day only — today's rows do not go into a run about yesterday", () => {
    const c = counterpart();
    seedYesterday(c, ["Yesterday one.", "Yesterday two."]);
    c.store.put({ type: "memory", kind: "fact", body: "Today, which is not yet over." });
    const about = pageWriterAbout(c.store.today());
    const built = c.pageWriterInput({ about });
    expect(built.memories.map((m) => m.statement).sort()).toEqual([
      "Yesterday one.",
      "Yesterday two.",
    ]);
  });

  test("confidential rows are held back, and the holding back is COUNTED", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    c.store.put({ type: "memory", kind: "fact", body: "An ordinary placeholder.", learnedOn: about });
    c.store.put({
      type: "memory",
      kind: "fact",
      body: "A placeholder the owner marked private.",
      learnedOn: about,
      meta: { confidential: true },
    });
    const built = c.pageWriterInput({ about });
    expect(built.memories).toHaveLength(1);
    expect(built.memories[0]?.statement).toBe("An ordinary placeholder.");
    expect(built.omitted).toBe(1);
    // A filter nobody can see firing is a filter nobody can trust: the count
    // reaches the run's own row.
    c.recordPageWriterRun({
      about,
      mode: "session",
      outcome: "asked",
      considered: built.memories.length,
      omitted: built.omitted,
    });
    expect(pageWriterRuns(c.store)[0]?.omitted).toBe(1);
  });

  test("the budget cuts by salience, from the end, and what did not fit is counted", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    for (let i = 0; i < 6; i += 1) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `Placeholder number ${String(i)}: ${"padding that makes this row large enough to price. ".repeat(4)}`,
        learnedOn: about,
      });
    }
    const built = c.pageWriterInput({ about, budgetBytes: 400 });
    expect(built.memories.length).toBeGreaterThan(0);
    expect(built.memories.length).toBeLessThan(6);
    expect(built.dropped).toBe(6 - built.memories.length);
    expect(built.bytes).toBeLessThanOrEqual(400);
    // The COUNT ceiling bites independently of the bytes.
    const capped = dayMemories(c.store, {
      about,
      day: c.store.livedDay(),
      budgetBytes: 1_000_000,
      max: 2,
    });
    expect(capped.memories).toHaveLength(2);
    expect(capped.dropped).toBe(4);
  });

  test("a memory whose prose will not read is skipped, never a throw", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    const ids = seedYesterday(c, ["Readable placeholder.", "About to become unreadable."]);
    const gone = ids[1] as string;
    const path = c.store.absolutePath(c.store.row(gone)?.prose_path ?? "");
    rmSync(path, { force: true });
    const built = c.pageWriterInput({ about });
    expect(built.memories.map((m) => m.statement)).toEqual(["Readable placeholder."]);
  });

  test("a statement is ONE LINE here — a body carrying newlines cannot forge bullets", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    c.store.put({
      type: "memory",
      kind: "fact",
      body: "First line.\n- A forged bullet.\n\nAnd more.",
      learnedOn: about,
    });
    const built = c.pageWriterInput({ about });
    expect(built.memories[0]?.statement).toBe("First line. - A forged bullet. And more.");
    const text = writerInstruction(built, { tool: "self_page" });
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });
});

describe("the instruction the writer reads", () => {
  test("it is context and not a command, and says that leaving the page alone is an answer", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const text = writerInstruction(c.pageWriterInput({ about }), { tool: "self_page" });
    expect(text.startsWith(PAGE_WRITER_OPEN)).toBe(true);
    expect(text).toContain("context, not an instruction");
    expect(text).toContain("leaving the page exactly as it stands is the right answer");
    expect(text).toContain(about);
    expect(text).toContain("A placeholder thing noticed yesterday.");
    expect(text).toContain("nothing has been written here yet");
    expect(text).toContain("Amend it; do not start over");
  });

  test("with a page standing, it carries the page whole and names its version", () => {
    const c = counterpart();
    c.revisePage(PAGE, { reason: "a placeholder first page", by: "owner" });
    const about = pageWriterAbout(c.store.today());
    const text = writerInstruction(c.pageWriterInput({ about }), { tool: "self_page" });
    expect(text).toContain(PAGE);
    expect(text).toContain("version 0");
    expect(text).toContain("`ifVersion`");
  });

  test("a day with nothing in it says so rather than pretending", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    // The store has SOMETHING before today, but nothing on the target date.
    c.store.put({ type: "memory", kind: "fact", body: "Older.", learnedOn: dayBefore(about) });
    const text = writerInstruction(c.pageWriterInput({ about }), { tool: "self_page" });
    expect(text).toContain(`Nothing was written down on ${about}`);
  });
});

// ── the ask, beside the wake ─────────────────────────────────────────────────

describe("session mode: the ask at SessionStart", () => {
  test("THE WAKE IS UNTOUCHED — byte for byte, with the writer off and with it on", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.revisePage(PAGE, { reason: "a placeholder first page", by: "owner" });
    seeder.rebrief({ budgetBytes: BUDGET_BYTES });
    seeder.close();

    const offAdapter = adapter({ pageWriter: { mode: "off" } });
    const off = offAdapter.sessionStart(hook("sess_off"));
    offAdapter.counterpart.close();

    const onAdapter = adapter({ pageWriter: { mode: "session" } });
    const on = onAdapter.sessionStart(hook("sess_on"));

    expect(on.injection).toBe(off.injection);
    expect(on.bytes).toBe(off.bytes);
    expect(on.sentinel).toBe(off.sentinel);
    // The ONLY difference is the field that was always the channel for an ask.
    expect(off.ask).toBeNull();
    expect(on.ask).not.toBeNull();
    expect(on.ask ?? "").toContain(PAGE_WRITER_OPEN);
  });

  test("off writes no row at all; session mode claims the night and records the ask", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(seeder.store.today());
    seeder.close();

    const offAdapter = adapter({ pageWriter: { mode: "off" } });
    offAdapter.sessionStart(hook("sess_off"));
    expect(pageWriterRuns(offAdapter.counterpart.store)).toEqual([]);
    offAdapter.counterpart.close();

    const a = adapter({ pageWriter: { mode: "session" } });
    a.sessionStart(hook("sess_on"));
    const runs = pageWriterRuns(a.counterpart.store);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe("asked");
    expect(runs[0]?.about).toBe(about);
    expect(runs[0]?.mode).toBe("session");
    expect(runs[0]?.considered).toBe(1);
    expect(readSession(dir, "sess_on")?.pageWriterFor).toBe(about);
  });

  test("the SAME session is not asked twice — a compaction re-firing SessionStart asks nothing", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.close();
    const a = adapter({ pageWriter: { mode: "session" } });
    const first = a.sessionStart(hook("sess_one"));
    const second = a.sessionStart(hook("sess_one"));
    expect(first.ask).not.toBeNull();
    expect(second.ask).toBeNull();
    expect(pageWriterRuns(a.counterpart.store)).toHaveLength(1);
  });

  test("a THIRD session on the same day is not asked: the allowance is two", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.close();
    const a = adapter({ pageWriter: { mode: "session" } });
    expect(a.sessionStart(hook("sess_1")).ask).not.toBeNull();
    expect(a.sessionStart(hook("sess_2")).ask).not.toBeNull();
    expect(a.sessionStart(hook("sess_3")).ask).toBeNull();
    expect(pageWriterRuns(a.counterpart.store)).toHaveLength(2);
  });

  test("no room under the reported ceiling: DEFERRED, never truncated, and the night stays owed", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.rebrief({ budgetBytes: 900 });
    seeder.close();
    const a = adapter({ pageWriter: { mode: "session" }, injectionBudgetBytes: 900 });
    const out = a.sessionStart(hook("sess_tight"));
    expect(out.ask).toBeNull();
    // Nothing claimed: the next session is offered the same day.
    expect(pageWriterRuns(a.counterpart.store)).toEqual([]);
    expect(a.counterpart.pageWriterDue({ mode: "session" }).due).toBe(true);
    // ...and the wake itself still went.
    expect(out.bytes).toBeGreaterThan(0);
  });

  test("the first-launch scope question wins the field, and the night stays owed", () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.close();
    // `unset` ⇒ the first-launch question is due, and it takes the field.
    const a = adapter({ pageWriter: { mode: "session" } }, "unset");
    const out = a.sessionStart(hook("sess_scope"));
    expect(out.ask ?? "").toContain("<counterparts-scope>");
    expect(out.ask ?? "").not.toContain(PAGE_WRITER_OPEN);
    expect(pageWriterRuns(a.counterpart.store)).toEqual([]);
    expect(a.counterpart.pageWriterDue({ mode: "session" }).due).toBe(true);
  });
});

// ── the door that writes `by: "writer"` ──────────────────────────────────────

describe("the writer's own door on the page", () => {
  test("a marked session writes `by: writer` and closes the night as revised", async () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(seeder.store.today());
    seeder.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    seeder.close();
    recordSession(dir, { sessionId: "sess_w", scope: SCOPE, phase: "start", pageWriterFor: about });

    const s = openServer({ dir, session: "sess_w", scope: SCOPE, owner: true });
    open.push(s.counterpart);
    const res = await s.call("self_page", { body: PAGE, reason: "the night's revision" });
    expect(res.isError ?? false).toBe(false);
    expect(s.counterpart.selfPage()?.by).toBe("writer");
    const status = s.counterpart.pageWriterStatus(about);
    expect(status.outcome).toBe("revised");
    expect(status.derived).toBe(false);
  });

  test("an UNMARKED session is an ordinary session, and leaves the writer's log alone", async () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    seeder.close();
    recordSession(dir, { sessionId: "sess_p", scope: SCOPE, phase: "start" });
    const s = openServer({ dir, session: "sess_p", scope: SCOPE, owner: true });
    open.push(s.counterpart);
    await s.call("self_page", { body: PAGE, reason: "an ordinary amendment" });
    expect(s.counterpart.selfPage()?.by).toBe("session");
    expect(pageWriterRuns(s.counterpart.store)).toEqual([]);
  });

  test("the mark cannot be forged from the tool call, and a closed night does not reopen", async () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(seeder.store.today());
    // The night is already answered, so the mark is stale.
    seeder.recordPageWriterRun({ about, mode: "session", outcome: "revised" });
    seeder.close();
    recordSession(dir, { sessionId: "sess_s", scope: SCOPE, phase: "start", pageWriterFor: about });
    const s = openServer({ dir, session: "sess_s", scope: SCOPE, owner: true });
    open.push(s.counterpart);
    // `by` is not an argument of the tool at all; and the stale mark is refused.
    await s.call("self_page", { body: PAGE, reason: "after the night closed", by: "writer" });
    expect(s.counterpart.selfPage()?.by).toBe("session");
  });

  test("a REFUSED revision is recorded as the writer having run and been turned away", async () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(seeder.store.today());
    seeder.recordPageWriterRun({ about, mode: "session", outcome: "asked" });
    seeder.close();
    recordSession(dir, { sessionId: "sess_r", scope: SCOPE, phase: "start", pageWriterFor: about });
    const s = openServer({ dir, session: "sess_r", scope: SCOPE, owner: true });
    open.push(s.counterpart);
    const res = await s.call("self_page", { body: "x".repeat(SELF_TUNABLES.PAGE_MAX_BYTES + 1) });
    expect(res.isError ?? false).toBe(true);
    const status = s.counterpart.pageWriterStatus(about);
    expect(status.outcome).toBe("refused");
    expect(status.run?.detail).toBe("too-large");
    expect(s.counterpart.selfPage()).toBeNull();
  });
});

// ── the configuration switch ─────────────────────────────────────────────────

describe("the mode switch", () => {
  test("absent means `session`, because a page that only forms for people who found a config key is not the product", () => {
    expect(pageWriterMode({})).toBe("session");
    expect(pageWriterMode({ pageWriter: { mode: "host" } })).toBe("host");
    expect(pageWriterMode({ pageWriter: { mode: "off" } })).toBe("off");
    // An instrument is off whatever the file says.
    expect(pageWriterMode({ observer: true, pageWriter: { mode: "host" } })).toBe("off");
  });

  test("it is read STRICTLY — a half-written block stands the configuration down rather than resolving to `host`", () => {
    expect(loadConfig({ dataDir: "/x", pageWriter: { mode: "session" } }).ok).toBe(true);
    for (const bad of [
      { mode: "hosts" },
      { mode: 1 },
      {},
      [],
      "host",
      { mode: "host", command: "" },
      { mode: "host", timeoutMs: 0 },
    ]) {
      const loaded = loadConfig({ dataDir: "/x", pageWriter: bad });
      expect(loaded.ok, JSON.stringify(bad)).toBe(false);
      expect(loaded.config.observer, JSON.stringify(bad)).toBe(true);
    }
  });

  test("every mode the core names is a mode the configuration accepts", () => {
    for (const mode of PAGE_WRITER_MODES) {
      expect(loadConfig({ dataDir: "/x", pageWriter: { mode } }).ok, mode).toBe(true);
    }
  });
});

// ── the surfaces ─────────────────────────────────────────────────────────────

describe("the surfaces that report it", () => {
  test("the durable name is registered everywhere the registries demand", () => {
    expect(DURABLE_EVENT_NAMES).toContain(SELF_PAGE_WRITER_EVENT);
    const row = MECHANISMS.find((m) => m.id === "page-writer");
    expect(row).toBeDefined();
    expect(row?.evidence).toEqual({ kind: "event", names: [SELF_PAGE_WRITER_EVENT] });
  });

  test("the fired view moves from never-fired to firing when a night runs", () => {
    const c = counterpart();
    const today = dateOf(c.store.now());
    const blind = firedReport(c.store, today).rows.find((r) => r.id === "page-writer");
    expect(["never", "new"]).toContain(blind?.state ?? "");
    c.recordPageWriterRun({
      about: pageWriterAbout(c.store.today()),
      mode: "session",
      outcome: "nothing-to-say",
    });
    const row = firedReport(c.store, today).rows.find((r) => r.id === "page-writer");
    expect(row?.state).toBe("firing");
    expect(row?.firedInWindow).toBe(1);
  });

  test("doctor is GREEN on a store younger than a day, and says which it is", () => {
    const c = counterpart();
    const f = pageWriterFindings(c.store, config())[0];
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain("never run");
    expect(f?.detail).toContain("no day before");
    expect(f?.data["young"]).toBe(true);
    // A line that nags from the day it lands is a line people read past.
    expect(f?.fix).toBe("");
  });

  test("doctor is GREEN on a night that had nothing to say, and says so in words", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    c.recordPageWriterRun({ about, mode: "host", outcome: "nothing-to-say" });
    const f = pageWriterFindings(c.store, config())[0];
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain("nothing-to-say");
    expect(f?.detail).toContain(about);
  });

  test("doctor goes AMBER, with a fix, on a night that failed — and never red", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    c.recordPageWriterRun({
      about: pageWriterAbout(c.store.today()),
      mode: "host",
      outcome: "failed",
      detail: "watchdog",
    });
    const f = pageWriterFindings(c.store, config())[0];
    expect(f?.severity).toBe("amber");
    expect(f?.fix.length).toBeGreaterThan(0);
    expect(f?.detail).toContain("watchdog");
  });

  test("doctor is GREEN when it is off and nothing has been written; AMBER once a page stands", () => {
    const c = counterpart();
    const off = config({ pageWriter: { mode: "off" } });
    expect(pageWriterFindings(c.store, off)[0]?.severity).toBe("green");
    c.revisePage(PAGE, { reason: "a placeholder first page", by: "owner" });
    const f = pageWriterFindings(c.store, off)[0];
    expect(f?.severity).toBe("amber");
    expect(f?.fix).toContain("pageWriter");
  });
});

// ── host mode, against a STUB ────────────────────────────────────────────────

describe("host mode, proved against a stub `claude`", () => {
  let binDir: string;

  /** The configuration under test here: host mode, and a stub for the CLI. */
  function host(over: Partial<AdapterConfig> = {}): AdapterConfig {
    return config({ pageWriter: { mode: "host" }, ...over });
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "counterparts-writer-bin-"));
  });
  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  /** A stub that records the argv and environment it was given, then exits. */
  function stub(body: string): string {
    const path = join(binDir, "claude-stub");
    writeFileSync(
      path,
      ["#!/bin/sh", `printf '%s\\n' "$@" > ${JSON.stringify(join(binDir, "argv"))}`, "env > " + JSON.stringify(join(binDir, "env")), body].join("\n"),
      "utf8",
    );
    chmodSync(path, 0o755);
    return path;
  }

  test("the launcher's plan: one pre-approved tool, no window, the data dir pinned last", () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    const plan = planPageWriter({
      config: config({ pageWriter: { mode: "host", command: "/usr/local/bin/claude" } }),
      about,
      prompt: writerInstruction(c.pageWriterInput({ about }), { tool: "self_page" }),
      baseEnv: { PATH: "/usr/bin", COUNTERPARTS_DATA_DIR: "/somewhere/else" },
    });
    expect(plan.ok).toBe(true);
    expect(plan.command).toBe("/usr/local/bin/claude");
    // `-p` is what makes it windowless and what makes SessionStart hooks run.
    expect(plan.args).toContain("-p");
    expect(plan.args.join(" ")).toContain("--allowedTools");
    expect(plan.args.join(" ")).toContain(MCP_SELF_PAGE_TOOL);
    // ONE tool, and it is the page's. A writer that could call anything else
    // would be a session, not a writer.
    const allowed = plan.args[plan.args.indexOf("--allowedTools") + 1] ?? "";
    expect(allowed.split(",")).toEqual([MCP_SELF_PAGE_TOOL]);
    // The package's own values are written LAST, so nothing a caller exported
    // can redirect the run (§2.13).
    expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(dir);
    expect(plan.env["PATH"]).toBe("/usr/bin");
    expect(plan.timeoutMs).toBeGreaterThan(0);
  });

  test("it refuses by NAME rather than starting something it cannot account for", () => {
    const c = counterpart();
    const about = pageWriterAbout(c.store.today());
    expect(
      planPageWriter({ config: { ...host(), observer: true }, about, prompt: "x" }).reason,
    ).toBe("OBSERVER");
    expect(planPageWriter({ config: { ...host(), dataDir: "" }, about, prompt: "x" }).reason).toBe(
      "NO_DATA_DIR",
    );
    expect(
      planPageWriter({
        config: config({ pageWriter: { mode: "session" } }),
        about,
        prompt: "x",
      }).reason,
    ).toBe("NOT_HOST_MODE");
  });

  test("a run against the stub claims the night, then closes it from the STORE and not from stdout", async () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    const command = stub("exit 0");
    const outcome = await runPageWriter({
      counterpart: c,
      config: config({ pageWriter: { mode: "host", command } }),
    });
    expect(outcome.ran).toBe(true);
    // The stub wrote nothing, so the night had nothing to say — and that is
    // read from the page, not from anything the child printed.
    expect(outcome.outcome).toBe("nothing-to-say");
    const runs = pageWriterRuns(c.store, { about });
    expect(runs.map((r) => r.outcome)).toEqual(["nothing-to-say", "started"]);
    expect(readFileSync(join(binDir, "argv"), "utf8")).toContain(PAGE_WRITER_OPEN);
  });

  test("a child that DID write the page closes the night as revised, read from the page and not from stdout", async () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(c.store.today());
    // The starter stands in for the child at the one seam that matters: it
    // writes the page through the real door, as the MCP tool inside a real
    // child would, and then exits clean. What proves the design is that
    // `runPageWriter` reads the OUTCOME from the store afterwards.
    const outcome = await runPageWriter({
      counterpart: c,
      config: config({ pageWriter: { mode: "host", command: stub("exit 0") } }),
      start: async () => {
        c.revisePage(PAGE, { reason: "the night's revision", by: "writer" });
        return await Promise.resolve({ code: 0, timedOut: false, error: null });
      },
    });
    expect(outcome.outcome).toBe("revised");
    expect(c.pageWriterStatus(about).outcome).toBe("revised");
    expect(c.selfPage()?.by).toBe("writer");
  });

  test("the windowless child's own door: the pinned date, not the tool's word, is what writes `by: writer`", async () => {
    const seeder = counterpart();
    seedYesterday(seeder, ["A placeholder thing noticed yesterday."]);
    const about = pageWriterAbout(seeder.store.today());
    seeder.recordPageWriterRun({ about, mode: "host", outcome: "started" });
    seeder.close();
    // No session record at all — a windowless child's id is minted by the host
    // after the launcher is gone, which is exactly why the date is pinned.
    const s = openServer({
      dir,
      session: "sess_host",
      scope: SCOPE,
      owner: true,
      env: { [PAGE_WRITER_ENV]: about },
    });
    open.push(s.counterpart);
    await s.call("self_page", { body: PAGE, reason: "the night's revision" });
    expect(s.counterpart.selfPage()?.by).toBe("writer");
    expect(s.counterpart.pageWriterStatus(about).outcome).toBe("revised");
  });

  test("a stub that fails is recorded as failed, and the page is untouched", async () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    c.revisePage(PAGE, { reason: "a placeholder first page", by: "owner" });
    const about = pageWriterAbout(c.store.today());
    const command = stub("exit 3");
    const outcome = await runPageWriter({
      counterpart: c,
      config: config({ pageWriter: { mode: "host", command } }),
    });
    expect(outcome.outcome).toBe("failed");
    expect(c.pageWriterStatus(about).outcome).toBe("failed");
    expect(c.selfPage()?.body).toBe(PAGE);
  });

  test("the WORKER's watchdog outranks the child's: an abort kills it and the night reads `failed`", async () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    c.revisePage(PAGE, { reason: "a placeholder first page", by: "owner" });
    const about = pageWriterAbout(c.store.today());
    const controller = new AbortController();
    // A stub that would outlive the worker if nothing stopped it. The worker's
    // watchdog is five minutes and the child's ten; without the signal the
    // worker would hold the store open for twice the life it promises.
    const command = stub("sleep 30");
    const run = runPageWriter({
      counterpart: c,
      config: config({ pageWriter: { mode: "host", command } }),
      signal: controller.signal,
    });
    controller.abort();
    const outcome = await run;
    expect(outcome.outcome).toBe("failed");
    expect(outcome.detail).toBe("watchdog");
    expect(c.pageWriterStatus(about).outcome).toBe("failed");
    expect(c.selfPage()?.body).toBe(PAGE);
  });

  test("two runs cannot both claim one night", async () => {
    const c = counterpart();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const command = stub("exit 0");
    const cfg = config({ pageWriter: { mode: "host", command } });
    await runPageWriter({ counterpart: c, config: cfg });
    const second = await runPageWriter({ counterpart: c, config: cfg });
    expect(second.ran).toBe(false);
    expect(second.outcome).toBe("skipped");
  });
});
