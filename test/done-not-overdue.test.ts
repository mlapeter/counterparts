/**
 * A DONE MEMORY IS NEVER OVERDUE (SO1 step 2, 2026-11-07, lightly held).
 *
 * On Mike's store on 11-07, memories written `status: done` with a date
 * already behind them ("Scheduled Routine night test PASSED", "Handoff for
 * 11-07 written", "Chart essay live … ledger L-0032") read as overdue in the
 * wake's Coming up. The date was when it happened, never a reminder.
 *
 * What this file pins, through the doors (MCP `remember` / `session_end`, the
 * SessionStart hook, `Counterpart#comingUp`, `Prospective#plainDue`):
 *
 *   1. the write: done + a passed eventDate (no repeat, no `updates`) stores
 *      the date as occurredOn and says so in `facts.dropped`; an occurredOn
 *      sent too and different is kept, the eventDate dropped; a future date
 *      with done is left alone;
 *   2. the read: a done row with a passed date (one written before this, put
 *      straight in the store) neither arrives, nor counts overdue, nor is told
 *      late as a plain reminder; the same row not done still is;
 *   3. a repeat is untouched: a done at a weekly reminder closes this
 *      occurrence only and the next comes back; a repeating row that is itself
 *      marked done still arrives on its next occurrence.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import { startOfLocalDay } from "../src/core/time.js";

const ZONE = "UTC";
const SCOPE = "/work/studio";
const SESSION = "sess_done_not_overdue";

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-done-not-overdue-"));
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
  rmSync(dir, { recursive: true, force: true });
});

function clock(ymd: string, hour = 9): void {
  setSystemTime(new Date(startOfLocalDay(ymd, ZONE) + hour * 3_600_000));
}

function adapter(): ReturnType<typeof openAdapter> {
  const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

function server(a: ReturnType<typeof openAdapter>): McpServer {
  return new McpServer({ counterpart: a.counterpart, session: SESSION, scope: SCOPE });
}

/** Move the frozen clock and the store's lived day to `ymd`. */
function dayOf(a: ReturnType<typeof openAdapter>, ymd: string, hour = 9): void {
  clock(ymd, hour);
  a.counterpart.store.advanceClock(ymd);
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = (await s.call("remember", args)).structuredContent;
  expect(body["stored"]).toBe(true);
  return body;
}

/**
 * The "Coming up" lane of the wake a new session here gets, as the hook builds
 * it, after the turn-end worker has lived the boundary: its lines, up to the
 * blank line that ends it (a done memory may still show elsewhere, as work).
 */
async function wake(a: ReturnType<typeof openAdapter>, session: string): Promise<string> {
  expect((await runOnce({ config: { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE }, embedder: null })).ran).toBe(true);
  const input = toHookInput({ session_id: session, hook_event_name: "SessionStart", cwd: SCOPE }, { scope: SCOPE, timeZone: ZONE, env: {} });
  const lines = (a.sessionStart(input).injection ?? "").split("\n");
  const at = lines.indexOf("Coming up:");
  expect(at).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out.join("\n");
}

function comingUpIds(a: ReturnType<typeof openAdapter>): { overdue: string[]; all: string[] } {
  const c = a.counterpart.comingUp({ scope: SCOPE });
  return { overdue: c.overdue.map((x) => x.id), all: [...c.today, ...c.overdue, ...c.later].map((x) => x.id) };
}

function facts(body: Record<string, unknown>): Record<string, unknown> {
  return (body["facts"] ?? {}) as Record<string, unknown>;
}

function droppedNote(body: Record<string, unknown>, field: string): string {
  const d = (facts(body)["dropped"] ?? []) as { field: string; note: string }[];
  return d.find((x) => x.field === field)?.note ?? "";
}

describe("the write: a done with a passed date keeps it as when it happened", () => {
  test("remember: done + an eventDate two days back is stored as occurredOn, said, and the next wake neither lists it nor counts it overdue", async () => {
    const a = adapter();
    const s = server(a);
    dayOf(a, "2026-11-07");
    // A control: the same shape, not done, is a real overdue reminder.
    const open = await remember(s, { title: "Send the kiln invoice", text: "Send the kiln repair invoice to the landlord.", eventDate: "2026-11-05" });
    const body = await remember(s, { title: "Night test PASSED", text: "The scheduled night test ran and passed on the studio machine.", eventDate: "2026-11-05", status: "done" });
    const id = body["id"] as string;

    expect(facts(body)["occurredOn"]).toBe("2026-11-05");
    expect(facts(body)["status"]).toBe("done");
    expect(droppedNote(body, "eventDate")).toContain("kept as occurredOn");
    // Not echoed as a reminder, and no "already passed" reminder note.
    expect(body["reminder"]).toBeUndefined();
    expect(body["reminderHint"]).toBeUndefined();
    const row = a.counterpart.store.row(id);
    expect(row?.event_date ?? null).toBeNull();
    expect(row?.occurred_on).toBe("2026-11-05");

    dayOf(a, "2026-11-08");
    const text = await wake(a, "s-next");
    expect(text).not.toContain("Night test PASSED");
    expect(text).toContain("Send the kiln repair invoice");
    const up = comingUpIds(a);
    expect(up.all).not.toContain(id);
    expect(up.overdue).toContain(open["id"] as string);
  });

  test("an occurredOn sent too, and different, is kept; the eventDate is dropped and said", async () => {
    const a = adapter();
    const s = server(a);
    dayOf(a, "2026-11-07");
    const body = await remember(s, { title: "Chart essay live", text: "The chart essay went live and the ledger has it as L-0032.", eventDate: "2026-11-06", occurredOn: "2026-11-04", status: "done" });
    expect(facts(body)["occurredOn"]).toBe("2026-11-04");
    expect(droppedNote(body, "eventDate")).toContain('occurredOn "2026-11-04" was sent too');
    const row = a.counterpart.store.row(body["id"] as string);
    expect(row?.event_date ?? null).toBeNull();
    expect(row?.occurred_on).toBe("2026-11-04");
  });

  test("session_end: the same for an entry, and its sibling without done keeps its date", async () => {
    const a = adapter();
    const s = server(a);
    dayOf(a, "2026-11-07");
    const out = (
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { title: "Handoff for 11-06 written", content: "Wrote the handoff for the 11-06 session and left it in the notes folder.", kind: "fact", eventDate: "2026-11-06", status: "done" },
          { title: "Renew the studio lease", content: "Renew the studio lease with the landlord before it lapses.", kind: "fact", eventDate: "2026-11-06" },
        ],
      })
    ).structuredContent;
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    expect(outcomes.map((o) => o["stored"])).toEqual([true, true]);
    const [done, open] = outcomes as [Record<string, unknown>, Record<string, unknown>];
    expect(facts(done)["occurredOn"]).toBe("2026-11-06");
    expect(droppedNote(done, "eventDate")).toContain("kept as occurredOn");
    expect(a.counterpart.store.row(done["id"] as string)?.event_date ?? null).toBeNull();
    expect(a.counterpart.store.row(open["id"] as string)?.event_date).toBe("2026-11-06");

    dayOf(a, "2026-11-08");
    const up = comingUpIds(a);
    expect(up.all).not.toContain(done["id"] as string);
    expect(up.overdue).toContain(open["id"] as string);
    expect(await wake(a, "s-next")).not.toContain("Handoff for 11-06 written");
  });

  test("a future date with done is left alone (ambiguous, not this step)", async () => {
    const a = adapter();
    const s = server(a);
    dayOf(a, "2026-11-07");
    const body = await remember(s, { title: "Deploy done, check logs", text: "The deploy is done; the logs get a look on the 10th.", eventDate: "2026-11-10", status: "done" });
    expect(body["reminder"]).toMatchObject({ eventDate: "2026-11-10" });
    expect(droppedNote(body, "eventDate")).toBe("");
    const row = a.counterpart.store.row(body["id"] as string);
    expect(row?.event_date).toBe("2026-11-10");
    expect(row?.occurred_on ?? null).toBeNull();
  });
});

describe("the read: a done row with a passed date (written before this) is no reminder", () => {
  test("not arriving, not overdue, not told late as plain; the same row not done is all three", async () => {
    const a = adapter();
    dayOf(a, "2026-11-04");
    const store = a.counterpart.store;
    const salience = { relevance: 0.8, emotional: 0.5, predictive: 0.8 };
    const meta = { [CUE_MODE_META]: "plain" };
    const done = store.put({ type: "memory", kind: "fact", title: "Chart essay live", body: "The chart essay went live; ledger L-0032.", learnedOn: "2026-11-04", eventDate: "2026-11-05", status: "done", salience, meta, origin: { scope: SCOPE } });
    const open = store.put({ type: "memory", kind: "fact", title: "Pay the glaze supplier", body: "Pay the glaze supplier's invoice.", learnedOn: "2026-11-04", eventDate: "2026-11-05", salience, meta, origin: { scope: SCOPE } });
    // On its day neither is past: both arrive (a done dated today is left as it was).
    dayOf(a, "2026-11-05");
    expect(a.counterpart.prospective.horizon({ at: "2026-11-05" }).items.map((i) => i.memoryId).sort()).toEqual([done, open].sort());

    dayOf(a, "2026-11-07");
    const arriving = a.counterpart.prospective.horizon({ at: "2026-11-07" }).items.map((i) => i.memoryId);
    expect(arriving).not.toContain(done);
    expect(arriving).toContain(open);
    expect(a.counterpart.prospective.deriveFor(done, "2026-11-07")?.blockedBy).toContain("done");
    const up = comingUpIds(a);
    expect(up.all).not.toContain(done);
    expect(up.overdue).toContain(open);
    const late = a.counterpart.prospective.plainDue({ at: "2026-11-07" }).map((d) => d.memoryId);
    expect(late).not.toContain(done);
    expect(late).toContain(open);
    const text = await wake(a, "s-read");
    expect(text).not.toContain("Chart essay live");
    expect(text).toContain("Pay the glaze supplier");
  });
});

describe("a repeat is untouched", () => {
  test("a done at a weekly reminder closes this occurrence only; it comes back next week", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-10-13");
    const weekly = (await remember(s, { title: "Weekly backup", text: "Every Tuesday, back up the store before the day's work.", eventDate: "2026-10-06", recurring: "weekly" }))["id"] as string;
    dayOf(a, "2026-10-20", 8);
    expect(c.prospective.horizon({ at: "2026-10-20" }).items.map((i) => i.memoryId)).toContain(weekly);
    const body = await remember(s, { title: "Backup ran, Oct 20", text: "Ran the store backup at 08:40.", updates: weekly, status: "done" });
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: true, occurrence: "2026-10-20", recurring: "weekly", next: "2026-10-27" });
    expect(droppedNote(body, "eventDate")).toBe("");
    expect(c.prospective.horizon({ at: "2026-10-20" }).items.map((i) => i.memoryId)).not.toContain(weekly);
    expect(c.store.row(weekly)?.event_date).toBe("2026-10-06");
    dayOf(a, "2026-10-27");
    expect(c.prospective.horizon({ at: "2026-10-27" }).items.map((i) => i.memoryId)).toContain(weekly);
    expect(comingUpIds(a).all).toContain(weekly);
  });

  test("a repeating memory written done with a passed anchor keeps its date and still comes round", async () => {
    const a = adapter();
    const s = server(a);
    dayOf(a, "2026-10-21");
    const body = await remember(s, { title: "Water the kiln-room plants", text: "Water the kiln-room plants every Tuesday.", eventDate: "2026-10-20", recurring: "weekly", status: "done" });
    const id = body["id"] as string;
    expect(droppedNote(body, "eventDate")).toBe("");
    expect(a.counterpart.store.row(id)?.event_date).toBe("2026-10-20");
    dayOf(a, "2026-10-27");
    expect(a.counterpart.prospective.horizon({ at: "2026-10-27" }).items.map((i) => i.memoryId)).toContain(id);
  });
});
