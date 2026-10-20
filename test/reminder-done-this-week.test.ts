/**
 * DONE FOR THIS TIME (2026-10-20, Mike's go, an experiment, lightly held).
 * Mike's weekly reminder — every Tuesday, back up the store — came back at
 * 09:15 after he had run the backup at 08:40 and the session had written a
 * "backup ran" memory. Only naming the reminder in `drewOn` closed one
 * occurrence; the documented close, `eventDate: null`, ended the repeat.
 *
 * What this file pins:
 *
 *   1. `updates` at a repeating reminder with `status: "done"` and no date
 *      closes THIS occurrence only — plain line, cue and wake lane — and the
 *      next one comes back; the reminder keeps its date, repeat and standing
 *      (no settle, no fade); the answer says so; `eventDate: null` and
 *      `recurring: null` still end the repeat; a one-off `done` is as before.
 *   2. the write result names a reminder due now that a "done" or owner-said
 *      memory looks like it answers (`answers`).
 *   3. F6b: `drewOn` credits a memory this session itself replaced.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { RECURRING_META } from "../src/core/prospective/index.js";
import { fadeOf } from "../src/core/physics/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-done-this-week-"));
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

const SESSION = "sess_done_this_week";
let clock = Date.parse("2026-10-13T09:00:00Z");

function server(): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, now: () => clock, timeZone: "UTC" });
  open.push(s.counterpart);
  return s;
}

/** Move the clock and the store's lived day to `date`, 09:00 UTC. */
function dayOf(s: McpServer, date: string, hour = "09:00"): void {
  clock = Date.parse(`${date}T${hour}:00Z`);
  s.counterpart.store.advanceClock(date);
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = (await s.call("remember", args)).structuredContent;
  expect(body["stored"]).toBe(true);
  return body;
}

const BACKUP = "Every Tuesday, back up the Counterparts store with counterparts backup, before starting the day's work.";

/** Mike's weekly reminder, written on Tuesday 13 Oct, anchored on Tuesday 6 Oct. */
async function weekly(s: McpServer, remind: "plain" | "quiet" = "plain"): Promise<string> {
  dayOf(s, "2026-10-13");
  const body = await remember(s, { title: "Weekly backup", text: BACKUP, eventDate: "2026-10-06", recurring: "weekly", remind });
  return body["id"] as string;
}

function arriving(s: McpServer, at: string): string[] {
  return s.counterpart.prospective.horizon({ at }).items.map((a) => a.memoryId);
}

function cued(s: McpServer, at: string): string[] {
  return s.counterpart.prospective.arrivals({ at }).arrivals.map((a) => a.memoryId);
}

describe("a done at a repeating reminder closes this occurrence only", () => {
  test("PLAIN weekly, done on its Tuesday before the line was told: not told, not arriving, not cued — and back next Tuesday", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s);
    dayOf(s, "2026-10-20", "08:40");
    expect(c.prospective.plainDue({ at: "2026-10-20" }).map((d) => d.memoryId)).toEqual([id]);
    expect(arriving(s, "2026-10-20")).toEqual([id]);
    const before = c.store.row(id);

    const body = await remember(s, { text: "Ran the store backup at 08:40; the archive landed in the backups folder.", updates: id, status: "done" });
    const done = body["id"] as string;
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: true, occurrence: "2026-10-20", recurring: "weekly", from: id, next: "2026-10-27" });
    expect(String((body["reminder"] as Record<string, unknown>)["note"])).toContain("Closed this occurrence only (Tue 20 Oct 2026)");
    expect(String((body["reminder"] as Record<string, unknown>)["note"])).toContain("comes back Tue 27 Oct 2026");
    // Not held by the update guard, and no list of other dated memories to close.
    expect(body["held"]).toBeUndefined();
    expect(body["stillDated"]).toBeUndefined();

    // The reminder is untouched: its date, its repeat, its standing.
    const after = c.store.row(id);
    expect(after?.event_date).toBe("2026-10-06");
    expect(c.store.readProse(id).meta[RECURRING_META]).toBe("weekly");
    expect(after?.superseded_by).toBeNull();
    expect(after?.archived).toBe(0);
    // Undelivered until now, so the close counts as this occurrence coming round: one use, not a loss.
    expect(after?.uses ?? 0).toBeGreaterThan(before?.uses ?? 0);
    expect(fadeOf({ fade: after?.fade ?? 1 })).toBe(fadeOf({ fade: before?.fade ?? 1 }));
    expect(c.store.contradictionsOf([id]).get(id) ?? []).toEqual([]);
    expect(c.store.recurringMemories().map((r) => r.id)).toEqual([id]);
    // The memory saying it was done is undated, and carries no reminder.
    expect(c.store.row(done)?.event_date).toBeNull();
    expect(c.store.readProse(done).meta[RECURRING_META]).toBeUndefined();

    // 09:15, a new session: nothing to say today.
    dayOf(s, "2026-10-20", "09:15");
    expect(c.prospective.plainDue({ at: "2026-10-20" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-10-20" })).toEqual([]);
    expect(arriving(s, "2026-10-20")).toEqual([]);
    expect(cued(s, "2026-10-20")).toEqual([]);
    // Nor late, in this occurrence's grace.
    expect(c.prospective.plainDue({ at: "2026-10-21" })).toEqual([]);

    // Next Tuesday it is its own occurrence again.
    expect(c.prospective.plainDue({ at: "2026-10-27" }).map((d) => [d.memoryId, d.windowKey])).toEqual([[id, "d:2026-10-27"]]);
    expect(arriving(s, "2026-10-27")).toEqual([id]);
    expect(cued(s, "2026-10-27")).toEqual([id]);
  });

  test("QUIET weekly, done after a footnote: this week's window is closed, next week's is fresh", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s, "quiet");
    dayOf(s, "2026-10-19");
    expect(c.prospective.fire({ memoryId: id, windowKey: "d:2026-10-20", at: "2026-10-19", day: c.store.livedDay() }).fired).toBe(true);
    dayOf(s, "2026-10-20");
    const body = await remember(s, { text: "Backed up the store this morning.", updates: id, status: "done" });
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: true, occurrence: "2026-10-20", next: "2026-10-27" });
    expect(c.prospective.arrivals({ at: "2026-10-20" }).suppressed).toContainEqual({ memoryId: id, windowKey: "d:2026-10-20", reason: "already-referenced" });
    expect(cued(s, "2026-10-22")).toEqual([]);
    // 10-24 is next week's lead: open, and nothing spent on it.
    const next = c.prospective.arrivals({ at: "2026-10-24" }).arrivals.find((a) => a.memoryId === id);
    expect(next?.windowKey).toBe("d:2026-10-27");
    expect(next?.fires).toBe(0);
  });

  test("done twice the same week: the second says it was closed already", async () => {
    const s = server();
    const id = await weekly(s);
    dayOf(s, "2026-10-20");
    await remember(s, { text: "Ran the backup; it went fine.", updates: id, status: "done" });
    const again = await remember(s, { text: "Checked: the backup archive opens and lists every table.", updates: id, status: "done" });
    expect(again["reminder"]).toMatchObject({ occurrenceClosed: false, occurrence: "2026-10-20", next: "2026-10-27" });
    expect(String((again["reminder"] as Record<string, unknown>)["note"])).toContain("was already closed");
  });

  test("done when no occurrence is open (monthly, mid-month): nothing closed, said, the reminder unchanged", async () => {
    const s = server();
    const c = s.counterpart;
    dayOf(s, "2026-10-13");
    const id = (await remember(s, { title: "Monthly invoices", text: "On the 5th of every month, send the invoices.", eventDate: "2026-10-05", recurring: "monthly", remind: "plain" }))["id"] as string;
    dayOf(s, "2026-10-20");
    const body = await remember(s, { text: "Sent the invoices early this month.", updates: id, status: "done" });
    expect(body["reminder"]).toMatchObject({ occurrenceClosed: false, recurring: "monthly", from: id, next: "2026-11-05" });
    expect((body["reminder"] as Record<string, unknown>)["occurrence"]).toBeUndefined();
    expect(String((body["reminder"] as Record<string, unknown>)["note"])).toContain("nothing was closed");
    expect(c.store.row(id)?.event_date).toBe("2026-10-05");
    expect(c.prospective.plainDue({ at: "2026-11-05" }).map((d) => d.memoryId)).toEqual([id]);
  });

  test("session_end: the same close, entry by entry", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s);
    dayOf(s, "2026-10-20");
    const body = (
      await s.call("session_end", {
        memories: [{ kind: "fact", content: "Mike ran the weekly store backup at 08:40 before work.", updates: id, status: "done", saidBy: "owner" }],
      })
    ).structuredContent;
    const outcome = (body["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(outcome["stored"]).toBe(true);
    expect(outcome["reminder"]).toMatchObject({ occurrenceClosed: true, occurrence: "2026-10-20", next: "2026-10-27" });
    expect(c.prospective.plainDue({ at: "2026-10-20" })).toEqual([]);
    expect(c.prospective.plainDue({ at: "2026-10-27" }).map((d) => d.memoryId)).toEqual([id]);
  });
});

describe("what still ends the repeat, and a one-off done as before", () => {
  test("eventDate: null still ends the repeat: no date anywhere, never back", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s);
    dayOf(s, "2026-10-20");
    const body = await remember(s, { text: "No more weekly backups: snapshots run nightly now.", updates: id, eventDate: null });
    expect(body["reminder"]).toMatchObject({ cleared: true, from: id });
    expect(c.store.recurringMemories()).toEqual([]);
    expect(c.store.row(id)?.event_date).toBeNull();
    expect(c.prospective.plainDue({ at: "2026-10-27" })).toEqual([]);
  });

  test("status done WITH recurring: null ends the repeat too (the author said stop)", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s);
    dayOf(s, "2026-10-20");
    const body = await remember(s, { text: "Final manual backup done; snapshots take over from here.", updates: id, status: "done", recurring: null });
    expect(body["reminder"]).toMatchObject({ cleared: true, from: id });
    expect(c.store.recurringMemories()).toEqual([]);
    expect(c.prospective.plainDue({ at: "2026-10-27" })).toEqual([]);
  });

  test("a ONE-OFF dated memory with status done is spent as before: the date is dropped, the old one settled under the new", async () => {
    const s = server();
    const c = s.counterpart;
    dayOf(s, "2026-10-13");
    const id = (await remember(s, { title: "Pay the quarterly taxes", text: "Pay the quarterly estimated taxes by the 20th.", eventDate: "2026-10-20", remind: "plain" }))["id"] as string;
    dayOf(s, "2026-10-20");
    const body = await remember(s, { title: "Quarterly taxes paid", text: "Paid the quarterly estimated taxes online.", updates: id, status: "done" });
    expect(body["reminder"]).toMatchObject({ cleared: true, from: id });
    expect((body["reminder"] as Record<string, unknown>)["occurrenceClosed"]).toBeUndefined();
    expect(c.store.row(id)?.event_date).toBeNull();
    expect(c.store.row(body["id"] as string)?.event_date).toBeNull();
    expect(c.prospective.plainDue({ at: "2026-10-20" })).toEqual([]);
    // Settled under the done memory, as a `changed` settle does.
    expect(fadeOf({ fade: c.store.row(id)?.fade ?? 1 })).toBeLessThan(1);
  });
});

describe("a write that looks like it answers a reminder due now", () => {
  test("a done memory written WITHOUT updates, close to the reminder: named with the way to close it", async () => {
    const s = server();
    const c = s.counterpart;
    const id = await weekly(s);
    dayOf(s, "2026-10-20");
    const body = await remember(s, { text: "Ran the weekly Counterparts store backup this Tuesday with counterparts backup.", status: "done", saidBy: "owner" });
    const answers = body["answers"] as Record<string, unknown>[] | undefined;
    expect(answers?.map((a) => a["id"])).toEqual([id]);
    expect(answers?.[0]).toMatchObject({ due: "2026-10-20", recurring: "weekly" });
    expect(String(body["answersHint"])).toContain("status: done");
    // Offered, never done here.
    expect(c.prospective.plainDue({ at: "2026-10-20" }).map((d) => d.memoryId)).toEqual([id]);
  });

  test("not when the write is neither done nor owner-said, nor once the occurrence is closed, nor in its lead days", async () => {
    const s = server();
    const id = await weekly(s);
    dayOf(s, "2026-10-18");
    const lead = await remember(s, { text: "Ran the weekly Counterparts store backup early, with counterparts backup.", status: "done" });
    expect(lead["answers"]).toBeUndefined();
    dayOf(s, "2026-10-20");
    const plain = await remember(s, { text: "The weekly Counterparts store backup with counterparts backup takes about a minute." });
    expect(plain["answers"]).toBeUndefined();
    await remember(s, { text: "The store backup ran this morning without trouble.", updates: id, status: "done" });
    const later = await remember(s, { text: "Ran the weekly Counterparts store backup again with counterparts backup, to be safe.", status: "done" });
    expect(later["answers"]).toBeUndefined();
  });
});

// ── F6b: drewOn and a memory this session replaced ───────────────────────────

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true });
  open.push(c);
  return c;
}

function shown(c: Counterpart, sessionId: string, turn: number, ids: readonly string[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

const STALE = "Backups copy the spans folder too, so a backup holds the raw conversation text.";
const FIXED = "Backups hold no conversation text: since 2026-10-13 snapshots leave the spans folder out.";

describe("F6b: drewOn credits a memory this session itself replaced", () => {
  test("faded under a correction this session wrote minutes ago: credited, and said", async () => {
    const c = brain();
    c.store.advanceClock("2026-10-13");
    const stale = c.store.put({ type: "memory", kind: "fact", title: "What a backup holds", body: STALE, salience: { novelty: null, relevance: 0.6, emotional: 0.3, predictive: 0.5 } });
    c.store.advanceClock("2026-10-20");
    shown(c, "s1", 1, [stale]);
    const fix = await c.submitJot({ content: FIXED, kind: "fact", updates: stale, how: "changed" }, { session: "s1", scope: "proj" });
    expect(fix.deposited).toBe(true);
    const row = c.store.row(stale);
    expect(row?.superseded_by !== null || fadeOf({ fade: row?.fade ?? 1 }) < 1).toBe(true);
    const uses = row?.uses ?? 0;
    const r = c.creditDrewOn("s1", [stale]);
    expect(r.credited).toEqual([stale]);
    expect(r.refused).toEqual([]);
    expect(r.replacedHere).toEqual([{ id: stale, by: fix.memoryId as string }]);
    expect(c.store.row(stale)?.uses ?? 0).toBeGreaterThan(uses);
    // The correction still stands over it: nothing was revived.
    const after = c.store.row(stale);
    expect(after?.superseded_by !== null || fadeOf({ fade: after?.fade ?? 1 }) < 1).toBe(true);
  });

  test("replaced by ANOTHER session on an earlier day: still refused, as before", async () => {
    const c = brain();
    c.store.advanceClock("2026-10-12");
    const stale = c.store.put({ type: "memory", kind: "fact", title: "What a backup holds", body: STALE, salience: { novelty: null, relevance: 0.6, emotional: 0.3, predictive: 0.5 } });
    c.store.advanceClock("2026-10-13");
    const fix = await c.submitJot({ content: FIXED, kind: "fact", updates: stale, how: "changed" }, { session: "s0", scope: "proj" });
    expect(fix.deposited).toBe(true);
    c.store.advanceClock("2026-10-20");
    shown(c, "s1", 1, [stale]);
    const r = c.creditDrewOn("s1", [stale]);
    expect(r.credited).toEqual([]);
    expect(["superseded", "faded-under-newer", "archived"]).toContain(r.refused[0]?.reason ?? "");
    expect(r.replacedHere).toBeUndefined();
  });
});
