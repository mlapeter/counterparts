/**
 * Group 5, prospective (2026-10-11, review 07 C3–C5; the group-5 builder,
 * lightly held):
 *
 *   - a plain DAY reminder whose day passed untold is told once, LATE, inside
 *     its grace — never twice, never after the grace, never for a memory
 *     written after its day, never for a month or a range;
 *   - a dated memory the session names in `drewOn` is acted on: its open
 *     window is referenced and fires no more (a plain one keeps its day);
 *   - the dashboard lists a repeating date at its next occurrence.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed afterwards; every
 * word is invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import type { PutInput } from "../src/core/store/index.js";
import { RECURRING_META } from "../src/core/store/index.js";
import { CUE_MODE_META, PROSPECTIVE_PLAIN_EVENT, TUNABLES } from "../src/core/prospective/index.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { openAdapter, plainLine } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import { deliverTurn } from "../src/adapters/claude-code/bin/hook.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { mechanismPanel } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { addDays } from "../src/core/time.js";

const GRACE = TUNABLES.GRACE_DAYS;
const PLAIN = { [CUE_MODE_META]: "plain" } as const;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-group5-"));
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir });
  open.push(c);
  return c;
}

let n = 0;
function dated(c: Counterpart, date: string, input: Partial<PutInput> = {}): string {
  n += 1;
  return c.store.put({
    type: "memory",
    kind: "fact",
    title: `water the fern ${String(n)}`,
    body: `Water the fern on the landing, number ${String(n)}, before the pot dries out.`,
    learnedOn: "2026-10-01",
    salience: { relevance: 0.3, emotional: 0.2, predictive: 0.3 },
    eventDate: date,
    ...input,
  });
}

const told = (c: Counterpart, at: string): { id: string; beat: string; late: boolean }[] =>
  c.plainReminders({ at }).map((r) => ({ id: r.memoryId, beat: r.beat, late: r.late === true }));

describe("a missed plain day is told once, late, within its grace", () => {
  test("no session on its day: told the next session, once, marked late — and never again", () => {
    const c = brain();
    const id = dated(c, "2026-10-15", { meta: PLAIN });
    // Nobody came on the 15th.
    expect(told(c, "2026-10-17")).toEqual([{ id, beat: "day", late: true }]);
    expect(told(c, "2026-10-17")).toEqual([]);
    for (let k = 3; k <= GRACE + 2; k++) expect(told(c, addDays("2026-10-15", k))).toEqual([]);
    // One latch, the day's own, marked late.
    const rows = c.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedup_key).toBe(`${PROSPECTIVE_PLAIN_EVENT}:${id}:d:2026-10-15:day`);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject({ beat: "day", late: true, date: "2026-10-17" });
  });

  test("told on its day, it is never told late", () => {
    const c = brain();
    const id = dated(c, "2026-10-15", { meta: PLAIN });
    expect(told(c, "2026-10-15")).toEqual([{ id, beat: "day", late: false }]);
    for (let k = 1; k <= GRACE + 1; k++) expect(told(c, addDays("2026-10-15", k))).toEqual([]);
  });

  test("never after the grace: the last grace day still tells it, the day after does not", () => {
    const c = brain();
    const a = dated(c, "2026-10-15", { meta: PLAIN });
    const b = dated(c, "2026-10-15", { meta: PLAIN });
    expect(told(c, addDays("2026-10-15", GRACE + 1))).toEqual([]);
    expect(told(c, addDays("2026-10-15", GRACE)).map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  test("a memory written after its day was never missed; a quiet one is never told", () => {
    const c = brain();
    dated(c, "2026-10-15", { meta: PLAIN, learnedOn: "2026-10-16" });
    dated(c, "2026-10-15", { meta: { [CUE_MODE_META]: "quiet" } });
    dated(c, "2026-10-15", { meta: PLAIN, learnedOn: "" });
    expect(told(c, "2026-10-17")).toEqual([]);
  });

  test("a month or a range keeps its two beats and gets no late one", () => {
    const c = brain();
    dated(c, "2026-09", { meta: PLAIN });
    dated(c, "2026-10-01..2026-10-10", { meta: PLAIN });
    expect(told(c, "2026-10-12")).toEqual([]);
  });

  test("what is due today comes first, what is owed late after it", () => {
    const c = brain();
    const late = dated(c, "2026-10-14", { meta: PLAIN });
    const today = dated(c, "2026-10-16", { meta: PLAIN });
    expect(told(c, "2026-10-16")).toEqual([
      { id: today, beat: "day", late: false },
      { id: late, beat: "day", late: true },
    ]);
  });

  test("told late, it leaves Arriving, and doctor's reading counts it said", () => {
    const c = brain();
    const id = dated(c, "2026-10-15", { meta: PLAIN });
    const lane = (at: string): string[] => c.prospective.horizon({ at }).items.map((i) => i.memoryId);
    expect(lane("2026-10-16")).toEqual([id]);
    expect(told(c, "2026-10-16")).toEqual([{ id, beat: "day", late: true }]);
    expect(lane("2026-10-17")).toEqual([]);
    // Still a cue for recall, as a reminder told on its day is.
    expect(c.prospective.arrivals({ at: "2026-10-17" }).arrivals.map((a) => a.memoryId)).toEqual([id]);
    expect(c.prospective.arrivals({ at: "2026-10-16" }).suppressed.map((s) => s.reason)).toEqual(["told-plainly-today"]);
  });

  test("a weekly repeat missed is owed late until its next lead; a daily one never is", () => {
    const c = brain();
    // Thursdays, from 2026-10-01; the 10-08 occurrence went untold.
    const weekly = dated(c, "2026-10-01", { meta: { ...PLAIN, [RECURRING_META]: "weekly" }, learnedOn: "2026-09-30" });
    dated(c, "2026-10-01", { meta: { ...PLAIN, [RECURRING_META]: "daily" }, learnedOn: "2026-09-30" });
    const daily = c.plainReminders({ at: "2026-10-09" });
    expect(daily.map((r) => [r.memoryId === weekly ? "weekly" : "daily", r.eventDate, r.late === true])).toEqual([
      ["daily", "2026-10-09", false],
      ["weekly", "2026-10-08", true],
    ]);
    // The 10-15 occurrence's lead opens 10-12: the 10-08 one is no longer owed.
    expect(c.plainReminders({ at: "2026-10-12" }).filter((r) => r.memoryId === weekly)).toEqual([]);
  });

  test("a yearly date missed is told late the next day, for that year's occurrence", () => {
    const c = brain();
    const id = dated(c, "1990-05-14", { meta: { ...PLAIN, [RECURRING_META]: "yearly" }, learnedOn: "2026-05-01" });
    const r = c.plainReminders({ at: "2026-05-15" });
    expect(r.map((x) => [x.memoryId, x.windowKey, x.late === true])).toEqual([[id, "d:2026-05-14", true]]);
    expect(c.plainReminders({ at: "2026-05-16" })).toEqual([]);
  });

  test("through the hooks: SessionStart the day after says it late, to the person and the model, once", () => {
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000 };
    const a = openAdapter(config, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    const id = dated(a.counterpart, "2026-10-12", { title: "renew the library card", meta: PLAIN });
    const input: HookInput = { sessionId: "s1", scope: "proj", turns: [], at: "2026-10-13" };
    const result = a.sessionStart(input);
    expect(result.notices).toEqual(["This was for Mon 12 Oct 2026: renew the library card"]);
    expect(result.injection).toContain(`Plain reminder (they asked to be told) — This was for Mon 12 Oct 2026: renew the library card [${id}]`);
    const delivered = deliverTurn(
      "session-start",
      result,
      { hook_event_name: "SessionStart" },
      [null, null],
      { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) },
      input,
    );
    expect((JSON.parse(delivered.stdout) as Record<string, unknown>)["systemMessage"]).toBe(
      "This was for Mon 12 Oct 2026: renew the library card",
    );
    expect(a.userPromptSubmit({ ...input, prompt: "morning" }).notices).toBeUndefined();
    expect(a.sessionStart({ ...input, sessionId: "s2", at: "2026-10-14" }).notices).toBeUndefined();
  });

  test("the words say which day it was for", () => {
    expect(plainLine({ beat: "day", precision: "day", lastDay: "2026-10-12", what: "pay your taxes", late: true })).toBe(
      "This was for Mon 12 Oct 2026: pay your taxes",
    );
    expect(plainLine({ beat: "day", precision: "day", lastDay: "2026-10-12", what: "pay your taxes" })).toBe(
      "Today: pay your taxes",
    );
  });
});

/** A server and a store on the same injected clock (review of #411), so a write is learned on that day. */
function serverAt(iso: string): McpServer {
  const now = (): number => Date.parse(iso);
  const counterpart = Counterpart.open({ dir, now, timeZone: "UTC" });
  open.push(counterpart);
  return new McpServer({ counterpart, session: "sess_group5_r", scope: "/scope/group5", now });
}

async function noteAt(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const body = (await s.call("remember", args)).structuredContent;
  expect(body["stored"]).toBe(true);
  return body["id"] as string;
}

describe("the late beat, never twice and never wrong (review of #411)", () => {
  test("two processes reading the same missed day: exactly one claims it", () => {
    const a = brain();
    const id = dated(a, "2026-10-12", { meta: PLAIN });
    const b = brain();
    const da = a.plainDueToday({ at: "2026-10-13" });
    const db = b.plainDueToday({ at: "2026-10-13" });
    expect([...da, ...db].map((r) => [r.memoryId, r.late === true])).toEqual([[id, true], [id, true]]);
    const won = [a.claimPlainReminder(da[0]!, { at: "2026-10-13" }), b.claimPlainReminder(db[0]!, { at: "2026-10-13" })];
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(a.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);
  });

  test("an observer is told nothing late", () => {
    const a = brain();
    dated(a, "2026-10-12", { meta: PLAIN });
    a.close();
    open.length = 0;
    const o = Counterpart.open({ dir, observer: true });
    open.push(o);
    expect(o.plainReminders({ at: "2026-10-13" })).toEqual([]);
  });

  test("moved after its old day passed: the old day is never told late, the new one on time", async () => {
    const old = await noteAt(serverAt("2026-10-01T12:00:00Z"), {
      text: "Pay the quarterly estimated taxes on the twelfth.",
      eventDate: "2026-10-12",
      remind: "plain",
    });
    for (const c of open.splice(0)) c.close();
    const s = serverAt("2026-10-13T08:00:00Z");
    const moved = await noteAt(s, { text: "The quarterly estimated tax deadline moved to the twentieth.", updates: old, eventDate: "2026-10-20" });
    for (let k = 1; k <= 7; k++) expect(s.counterpart.plainReminders({ at: addDays("2026-10-12", k) }), String(k)).toEqual([]);
    expect(s.counterpart.plainReminders({ at: "2026-10-20" }).map((r) => [r.memoryId, r.late === true])).toEqual([[moved, false]]);
  });

  test("cancelled (eventDate null) before the late beat, or written after its day: nothing", async () => {
    const old = await noteAt(serverAt("2026-10-01T12:00:00Z"), {
      text: "Pay the quarterly estimated taxes on the twelfth.",
      eventDate: "2026-10-12",
      remind: "plain",
    });
    for (const c of open.splice(0)) c.close();
    const s = serverAt("2026-10-13T08:00:00Z");
    await noteAt(s, { text: "The quarterly estimated taxes are paid, so that is done.", updates: old, eventDate: null });
    await noteAt(s, { text: "There was a plumber visit on the twelfth.", eventDate: "2026-10-12", remind: "plain" });
    expect(s.counterpart.plainReminders({ at: "2026-10-13" })).toEqual([]);
    expect(s.counterpart.plainReminders({ at: "2026-10-14" })).toEqual([]);
  });
});

/** Record `ids` as footnoted to `sessionId`, as recall's own save would. */
function shown(c: Counterpart, sessionId: string, ids: readonly string[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn: 1, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn: 1, lastDay: c.store.livedDay(), surfaced }, 200);
}

describe("drewOn: a dated memory the session drew on is acted on", () => {
  function setup(): { c: Counterpart; quiet: string; plain: string } {
    const c = brain();
    c.store.advanceClock("2026-10-10");
    const quiet = dated(c, "2026-10-14", { meta: { [CUE_MODE_META]: "quiet" } });
    const plain = dated(c, "2026-10-14", { meta: PLAIN });
    c.store.advanceClock("2026-10-12");
    return { c, quiet, plain };
  }

  test("its open window stops: no more footnotes this window, and the credit still lands", () => {
    const { c, quiet } = setup();
    expect(c.prospective.arrivals({ at: "2026-10-12" }).arrivals.map((a) => a.memoryId)).toContain(quiet);
    shown(c, "s1", [quiet]);
    const r = c.creditDrewOn("s1", [quiet], { at: "2026-10-12" });
    expect(r.credited).toEqual([quiet]);
    expect(r.actedOn).toEqual([quiet]);
    for (const at of ["2026-10-13", "2026-10-14", "2026-10-16"]) {
      const a = c.prospective.arrivals({ at });
      expect(a.arrivals.map((x) => x.memoryId), at).not.toContain(quiet);
      expect(a.suppressed.find((s) => s.memoryId === quiet)?.reason, at).toBe("already-referenced");
    }
  });

  test("without the calendar day nothing is stopped; an id not shown stops nothing", () => {
    const { c, quiet } = setup();
    expect(c.creditDrewOn("s1", [quiet], { at: "2026-10-12" }).actedOn).toEqual([]);
    shown(c, "s1", [quiet]);
    expect(c.creditDrewOn("s1", [quiet]).actedOn).toEqual([]);
    expect(c.prospective.arrivals({ at: "2026-10-13" }).arrivals.map((x) => x.memoryId)).toContain(quiet);
  });

  test("a plain one keeps its day: still first under Arriving, and still told", () => {
    const { c, plain } = setup();
    shown(c, "s1", [plain]);
    expect(c.creditDrewOn("s1", [plain], { at: "2026-10-12" }).actedOn).toEqual([]);
    expect(c.prospective.horizon({ at: "2026-10-14" }).items[0]?.memoryId).toBe(plain);
    expect(told(c, "2026-10-14")).toEqual([{ id: plain, beat: "day", late: false }]);
  });

  test("a plain one drawn on in its grace before it was told late is still told late", () => {
    const c = brain();
    c.store.advanceClock("2026-10-10");
    const plain = dated(c, "2026-10-12", { meta: PLAIN });
    c.store.advanceClock("2026-10-13");
    shown(c, "s1", [plain]);
    expect(c.creditDrewOn("s1", [plain], { at: "2026-10-13" }).actedOn).toEqual([]);
    expect(told(c, "2026-10-13")).toEqual([{ id: plain, beat: "day", late: true }]);
  });

  test("through session_end, on the server's own calendar day, the answer says which were acted on", async () => {
    const SESSION = "sess_group5_1";
    const s = openServer({ dir, session: SESSION, scope: "/scope/group5", now: () => new Date("2026-10-12T12:00:00Z").getTime() });
    open.push(s.counterpart);
    const c = s.counterpart;
    c.store.advanceClock("2026-10-10");
    const quiet = dated(c, "2026-10-14", { meta: { [CUE_MODE_META]: "quiet" } });
    c.store.advanceClock("2026-10-12");
    shown(c, SESSION, [quiet]);
    const out = (await s.call("session_end", { session: SESSION, memories: [], drewOn: [quiet] })).structuredContent;
    expect(out["drewOn"]).toMatchObject({ credited: [quiet], actedOn: [quiet] });
    expect(c.prospective.arrivals({ at: "2026-10-13" }).suppressed.find((x) => x.memoryId === quiet)?.reason).toBe("already-referenced");
  });
});

describe("the dashboard lists repeating dates at their next occurrence", () => {
  test("a birthday from 1990 waits for its next May 14, saying it repeats, in date order", () => {
    const c = brain();
    c.store.advanceClock("2026-10-11");
    const once = dated(c, "2026-12-01");
    const soon = dated(c, "2026-10-20");
    const birthday = dated(c, "1990-05-14", { meta: { [RECURRING_META]: "yearly" }, learnedOn: "2026-10-01" });
    c.close();
    open.length = 0;
    const dash = Dashboard.open({ dir });
    try {
      const p = mechanismPanel(dash.source, "prospective").picture as unknown as {
        waiting: { id: string; date: string; repeats?: string }[];
        counts: { waiting: number };
      };
      expect(p.waiting.map((w) => [w.id, w.date, w.repeats ?? null])).toEqual([
        [soon, "2026-10-20", null],
        [once, "2026-12-01", null],
        [birthday, "2027-05-14", "every May 14"],
      ]);
      expect(p.counts.waiting).toBe(3);
    } finally {
      dash.close();
    }
  });

  test("the panel says how often it comes round", async () => {
    const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
    const panel = (await import(join(WEB, "mechanisms/prospective/panel.js"))) as { picture(p: unknown): string };
    const html = panel.picture({
      came: [],
      waiting: [{ id: "mem_000000000001", text: "a birthday", title: null, date: "2027-05-14", repeats: "every May 14" }],
      counts: { came: 0, waiting: 1 },
    });
    expect(html).toContain("every May 14");
  });
});
