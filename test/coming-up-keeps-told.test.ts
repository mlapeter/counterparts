/**
 * A TOLD PLAIN REMINDER STAYS IN THE DELIBERATE LOOKUPS (2026-11-18).
 *
 * A plain reminder whose last beat was told leaves the wake's horizon lane once
 * its day is past (2026-09-29, `Prospective#horizon`'s `toldForGood`), so the
 * wake doesn't say it again. The `coming up` door (`Counterpart#comingUp`, the
 * MCP handle) and the still-open door's dated list read that same lane, and the
 * reminder vanished from them too, though nobody closed it and it is still
 * owed (OW1). Now the lookups ask for the told ones too (`readCues`'
 * `includeTold`); the wake does not.
 *
 * Through the doors: MCP `remember`, the SessionStart hook (which tells it),
 * then the `coming up` and `still open` handles and the next wake.
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
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { startOfLocalDay } from "../src/core/time.js";

const ZONE = "UTC";
const SCOPE = "/work/studio";
const SESSION = "sess_coming_up_keeps_told";

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  dir = mkdtempSync(join(tmpdir(), "counterparts-coming-up-told-"));
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

/** The adapter on the store, the wake's shape on unless told (`readCues` serves the shaped wake). */
function adapter(shaped = true): ReturnType<typeof openAdapter> {
  const a = openAdapter(
    { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE },
    {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 1 }),
      embedder: null,
    },
  );
  closers.push(a.counterpart);
  if (shaped) a.counterpart.store.setMeta(WAKE_SHAPE_KEY, "on");
  return a;
}

function server(a: ReturnType<typeof openAdapter>): McpServer {
  return new McpServer({
    counterpart: a.counterpart,
    session: SESSION,
    scope: SCOPE,
  });
}

/** Move the frozen clock and the store's lived day to `ymd`. */
function dayOf(a: ReturnType<typeof openAdapter>, ymd: string, hour = 9): void {
  setSystemTime(new Date(startOfLocalDay(ymd, ZONE) + hour * 3_600_000));
  a.counterpart.store.advanceClock(ymd);
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const body = (await s.call("remember", args)).structuredContent;
  expect(body["stored"]).toBe(true);
  return body["id"] as string;
}

/** The wake a new session here gets, as the hook builds it: the whole injection, and its "Coming up" lane. */
async function wake(a: ReturnType<typeof openAdapter>, session: string): Promise<{ all: string; lane: string }> {
  expect(
    (
      await runOnce({
        config: { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE },
        embedder: null,
      })
    ).ran,
  ).toBe(true);
  const input = toHookInput(
    {
      session_id: session,
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: SCOPE,
    },
    { scope: SCOPE, timeZone: ZONE, env: {} },
  );
  const r = a.sessionStart(input);
  // The hook's delivery claims what its envelope carries (`envelope.ts#deliverTurn`): that is the telling.
  if (r.plain !== undefined && r.plain.length > 0) a.claimPlain(input, r.plain);
  const all = r.injection ?? "";
  const lines = all.split("\n");
  const at = lines.indexOf("Coming up:");
  const out: string[] = [];
  if (at >= 0) for (let i = at + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return { all, lane: out.join("\n") };
}

async function door(s: McpServer, handle: string): Promise<Record<string, unknown>> {
  return (await s.call("recall", { handle })).structuredContent;
}
const idsOf = (xs: unknown): string[] => ((xs ?? []) as { id: string }[]).map((x) => x.id);

/** A plain reminder for 11-05, written 11-04, told by the 11-05 wake. */
async function told(a: ReturnType<typeof openAdapter>, s: McpServer): Promise<string> {
  dayOf(a, "2026-11-04");
  const id = await remember(s, {
    title: "Ring the glazier",
    text: "Ring the glazier about the cracked kiln window.",
    eventDate: "2026-11-05",
    remind: "plain",
  });
  dayOf(a, "2026-11-05");
  const first = await wake(a, "s-told");
  expect(first.all).toContain("Ring the glazier");
  // The wake told it: the horizon's lane leaves it out from the day after.
  expect(a.counterpart.prospective.plainToldOn(id, "2026-11-05", () => true)).toBe(true);
  return id;
}

describe("a told plain reminder past its day", () => {
  for (const shaped of [true, false])
    test(`the coming up door and core comingUp still list it as overdue; the next wake does not say it again (shape ${shaped ? "on" : "off"})`, async () => {
      const a = adapter(shaped);
      expect((a.counterpart as unknown as { wakeShapeOn(): boolean }).wakeShapeOn()).toBe(shaped);
      const s = server(a);
      const id = await told(a, s);
      dayOf(a, "2026-11-07");
      // The wake's own lane leaves it out (2026-09-29), as before.
      expect(a.counterpart.prospective.horizon({ at: "2026-11-07" }).items.map((i) => i.memoryId)).not.toContain(id);
      const up = a.counterpart.comingUp({ scope: SCOPE });
      expect(up.overdue.map((c) => c.id)).toEqual([id]);
      expect([...up.today, ...up.passed, ...up.later, ...up.otherFolders].map((c) => c.id)).not.toContain(id);
      const d = await door(s, "coming up");
      expect(idsOf(d["overdue"])).toEqual([id]);
      expect(d["total"]).toBe(1);
      // The still-open door's dated list agrees: overdue, not passed.
      const open = ((await door(s, "still open"))["comingUp"] ?? []) as {
        id: string;
        overdue?: boolean;
        passed?: boolean;
      }[];
      expect(open.find((c) => c.id === id)).toMatchObject({ overdue: true });
      expect(open.find((c) => c.id === id)?.passed).toBeUndefined();
      // The next wake: not under Coming up, not counted.
      const next = await wake(a, "s-next");
      // Not vacuous: an absent lane reads "" (review of #854), so the whole wake is read too.
      expect(next.all).not.toContain("Ring the glazier");
      expect(next.lane).not.toMatch(/overdue/);
    });

  for (const close of [
    { how: "status done", args: { status: "done" } },
    { how: "its date dropped (eventDate null)", args: { eventDate: null } },
    // The close the tools teach (2026-11-18): it carried the date and plain mode over, so the reminder stayed owed.
    { how: "unresolved false", args: { unresolved: false } },
  ] as const) {
    test(`closed by ${close.how}, it stays out of the lookups and the wake`, async () => {
      const a = adapter();
      const s = server(a);
      const id = await told(a, s);
      dayOf(a, "2026-11-06");
      await remember(s, {
        title: "Rang the glazier",
        text: "Rang the glazier; the kiln window is booked in.",
        updates: id,
        ...close.args,
      });
      dayOf(a, "2026-11-07");
      const up = a.counterpart.comingUp({ scope: SCOPE });
      expect([...up.today, ...up.overdue, ...up.passed, ...up.later, ...up.otherFolders].map((c) => c.title).join("|")).not.toContain("glazier");
      const d = await door(s, "coming up");
      expect(d["total"]).toBe(0);
      const open = ((await door(s, "still open"))["comingUp"] ?? []) as {
        title: string;
      }[];
      expect(open.map((c) => c.title).join("|")).not.toContain("glazier");
      const next = await wake(a, "s-next");
      expect(next.lane).not.toContain("glazier");
      expect(next.all).not.toContain("Ring the glazier");
    });
  }

  test("a repeating one closed by unresolved false: this occurrence is done, the repeat stays", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Sweep the kiln room", text: "Sweep the kiln room every Thursday.", eventDate: "2026-11-05", recurring: "weekly", remind: "plain" });
    dayOf(a, "2026-11-05");
    expect((await wake(a, "s-told")).all).toContain("Sweep the kiln room");
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "Swept the kiln room", text: "Swept the kiln room this Thursday.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: true, occurrence: "2026-11-05", recurring: "weekly", next: "2026-11-12" });
    expect(c.store.row(id)?.event_date).toBe("2026-11-05");
    dayOf(a, "2026-11-07");
    const up = c.comingUp({ scope: SCOPE });
    expect([...up.today, ...up.overdue, ...up.passed].map((x) => x.id)).not.toContain(id);
    expect(idsOf((await door(s, "coming up"))["overdue"])).not.toContain(id);
    const open = ((await door(s, "still open"))["comingUp"] ?? []) as { id: string; overdue?: boolean }[];
    expect(open.filter((x) => x.overdue === true).map((x) => x.id)).not.toContain(id);
    expect((await wake(a, "s-next")).lane).not.toMatch(/overdue/);
    // Next week it comes round again.
    dayOf(a, "2026-11-12");
    expect(c.comingUp({ scope: SCOPE }).today.map((x) => x.id)).toContain(id);
  });

  test("a quiet dated thread closed by unresolved false is no reminder: its date carries over and reads Was, never overdue", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Hear back from the supplier", text: "Hear back from the supplier about the kiln part.", eventDate: "2026-11-05", unresolved: true });
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "The supplier answered", text: "The supplier answered: the kiln part ships Friday.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    const next = String(body["id"]);
    // The date moved to the revision, kept (`reminderMovedTo`).
    expect(c.store.row(next)?.event_date).toBe("2026-11-05");
    dayOf(a, "2026-11-08");
    const up = c.comingUp({ scope: SCOPE });
    expect(up.overdue).toEqual([]);
    expect(up.passed.map((x) => x.id)).toEqual([next]);
    const d = await door(s, "coming up");
    expect(idsOf(d["overdue"])).toEqual([]);
    expect(idsOf(d["passed"])).toEqual([next]);
    const lane = (await wake(a, "s-next")).lane;
    expect(lane).toContain(`- Was 11-05 · `);
    expect(lane).toContain(`[${next}]`);
    expect(lane).not.toMatch(/overdue/);
  });
});

/**
 * THE FOLLOW-UPS OF #854 (2026-11-19), through the same doors: MCP `remember`,
 * then `comingUp`, the `coming up` and `still open` handles and the next wake.
 */
describe("closing in words: the follow-ups", () => {
  for (const status of ["planned", "asked"] as const)
    test(`a quiet dated ${status} item closed by unresolved false carries no plan: Was, never overdue`, async () => {
      const a = adapter();
      const s = server(a);
      const c = a.counterpart;
      dayOf(a, "2026-11-04");
      const id = await remember(s, { title: "Fit the kiln shelf", text: "Fit the new kiln shelf on the 5th, before the firing.", eventDate: "2026-11-05", status });
      dayOf(a, "2026-11-06");
      const body = (await s.call("remember", { title: "Fitted the kiln shelf", text: "Fitted the kiln shelf; it sits level and the firing can go ahead.", updates: id, unresolved: false })).structuredContent;
      expect(body["stored"]).toBe(true);
      const next = String(body["id"]);
      // The date carries (a quiet item's date reads "Was"); the plan does not.
      expect(c.store.row(next)?.event_date).toBe("2026-11-05");
      expect(c.store.row(next)?.status ?? null).toBeNull();
      // Said, never silently lost.
      expect(body["facts"]).toMatchObject({ statusNotCarried: status });
      dayOf(a, "2026-11-08");
      const up = c.comingUp({ scope: SCOPE });
      expect(up.overdue).toEqual([]);
      expect(up.passed.map((x) => x.id)).toEqual([next]);
      const d = await door(s, "coming up");
      expect(idsOf(d["overdue"])).toEqual([]);
      const open = ((await door(s, "still open"))["comingUp"] ?? []) as { id: string; overdue?: boolean }[];
      expect(open.filter((x) => x.overdue === true).map((x) => x.id)).toEqual([]);
      const lane = (await wake(a, "s-next")).lane;
      expect(lane).toContain(`- Was 11-05 · `);
      expect(lane).not.toMatch(/overdue/);
    });

  test("a planned item whose close sends its own status keeps it; one that moves the date keeps the plan", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Fit the kiln shelf", text: "Fit the new kiln shelf on the 5th, before the firing.", eventDate: "2026-11-05", status: "planned" });
    dayOf(a, "2026-11-05");
    const moved = (await s.call("remember", { title: "Fit the kiln shelf on the 9th", text: "The kiln shelf fitting moved to the 9th; the bracket is late.", updates: id, unresolved: false, eventDate: "2026-11-09" })).structuredContent;
    expect(moved["stored"]).toBe(true);
    expect(c.store.row(String(moved["id"]))?.status).toBe("planned");
    const sent = (await s.call("remember", { title: "Kiln shelf still planned", text: "The kiln shelf is still planned for the 9th, confirmed with the fitter.", updates: String(moved["id"]), unresolved: false, status: "planned" })).structuredContent;
    expect(sent["stored"]).toBe(true);
    expect(c.store.row(String(sent["id"]))?.status).toBe("planned");
  });

  test("remind plain sent beside the close at a quiet thread spends it, never a new overdue reminder", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Hear back from the supplier", text: "Hear back from the supplier about the kiln part.", eventDate: "2026-11-05", unresolved: true });
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "The supplier answered", text: "The supplier answered: the kiln part ships on Friday.", updates: id, unresolved: false, remind: "plain" })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ cleared: true });
    expect(c.store.row(String(body["id"]))?.event_date).toBeNull();
    dayOf(a, "2026-11-08");
    const up = c.comingUp({ scope: SCOPE });
    expect([...up.today, ...up.overdue, ...up.passed, ...up.later].map((x) => x.title).join("|")).not.toContain("supplier");
    expect((await door(s, "coming up"))["total"]).toBe(0);
    expect((await wake(a, "s-next")).lane).not.toMatch(/overdue/);
  });

  test("a plain reminder sent remind quiet beside the close still closes", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    const id = await told(a, s);
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "Rang the glazier", text: "Rang the glazier; the kiln window is booked in for Monday.", updates: id, unresolved: false, remind: "quiet" })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ cleared: true });
    dayOf(a, "2026-11-07");
    expect((await door(s, "coming up"))["total"]).toBe(0);
    expect(c.comingUp({ scope: SCOPE }).overdue).toEqual([]);
  });

  test("a one-off plain reminder still ahead is kept by unresolved false, and the reply says how to drop it", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Kiln service", text: "The kiln service engineer comes on the 10th, morning.", eventDate: "2026-11-10", remind: "plain" });
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "Kiln service at 9am", text: "The kiln service engineer comes on the 10th at 9am sharp.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    const next = String(body["id"]);
    expect(body["reminder"]).toMatchObject({ eventDate: "2026-11-10", remind: "plain", keptAhead: true });
    expect(String((body["reminder"] as { note: string }).note)).toContain("eventDate: null");
    expect(c.store.row(next)?.event_date).toBe("2026-11-10");
    // On its day it comes up, in the lookups and the wake.
    dayOf(a, "2026-11-10");
    expect(c.comingUp({ scope: SCOPE }).today.map((x) => x.id)).toEqual([next]);
    expect(idsOf((await door(s, "coming up"))["today"])).toEqual([next]);
    expect((await wake(a, "s-day")).all).toContain("Kiln service at 9am");
    // `status: "done"` still spends one ahead (done early), as before.
    const done = (await s.call("remember", { title: "Kiln serviced early", text: "The engineer came early and serviced the kiln already.", updates: next, status: "done" })).structuredContent;
    expect(done["reminder"]).toMatchObject({ cleared: true });
    expect((await door(s, "coming up"))["total"]).toBe(0);
  });

  test("a plain reminder dated tomorrow, told today, closed today by unresolved false is spent, not kept as ahead", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Ring the glazier", text: "Ring the glazier about the cracked kiln window.", eventDate: "2026-11-06", remind: "plain" });
    dayOf(a, "2026-11-05");
    // Due tomorrow is due the morning its wake is read (`plainDueOn`): told now.
    expect((await wake(a, "s-told")).all).toContain("Ring the glazier");
    const body = (await s.call("remember", { title: "Rang the glazier", text: "Rang the glazier; the kiln window is booked in for Monday.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ cleared: true });
    for (const day of ["2026-11-06", "2026-11-08"]) {
      dayOf(a, day);
      const up = c.comingUp({ scope: SCOPE });
      expect([...up.today, ...up.overdue, ...up.passed].map((x) => x.title).join("|")).not.toContain("glazier");
      expect((await door(s, "coming up"))["total"]).toBe(0);
      expect((await wake(a, `s-${day}`)).lane).not.toContain("glazier");
    }
  });

  test("a planned plain reminder still ahead keeps its plan and its date when closed in words", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Kiln service", text: "The kiln service engineer comes on the 10th, morning.", eventDate: "2026-11-10", remind: "plain", status: "planned" });
    dayOf(a, "2026-11-06");
    const body = (await s.call("remember", { title: "Kiln service at 9am", text: "The kiln service engineer comes on the 10th at 9am sharp.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ keptAhead: true });
    expect(c.store.row(String(body["id"]))?.status).toBe("planned");
    expect((body["facts"] as Record<string, unknown> | undefined)?.["statusNotCarried"]).toBeUndefined();
  });

  test("a repeat's occurrence closed in words, with no title, does not take the reminder's title", async () => {
    const a = adapter();
    const s = server(a);
    const c = a.counterpart;
    dayOf(a, "2026-11-04");
    const id = await remember(s, { title: "Sweep the kiln room", text: "Sweep the kiln room every Thursday.", eventDate: "2026-11-05", recurring: "weekly", remind: "plain" });
    dayOf(a, "2026-11-05");
    const body = (await s.call("remember", { text: "Swept the kiln room this Thursday, all clean now.", updates: id, unresolved: false })).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: true });
    expect(c.store.row(String(body["id"]))?.title ?? null).not.toBe("Sweep the kiln room");
    expect(body["titleCarried"]).toBeUndefined();
    expect(String(body["titleAsked"])).toContain("reminder's title would read as the reminder itself");
    // The reminder keeps its own title, date and repeat.
    expect(c.store.row(id)?.title).toBe("Sweep the kiln room");
    expect(c.store.row(id)?.event_date).toBe("2026-11-05");
  });
});
