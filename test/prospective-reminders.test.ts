/**
 * PR B — prospective memory (reminders) actually working (2026-09-26).
 *
 * What this file pins, one describe each:
 *
 *   - a RANGE is a window precision; a year still has none;
 *   - the four July tune questions (bansai `eval/replay/GATES.md` finding 3),
 *     each with an acceptance test: (a) month warmth staggers, (b) a month's
 *     last fire waits for "after", (c) only day-dated items take wake lines,
 *     (d) imminence breaks a salience tie;
 *   - the write path: `note` / `session_end` take `eventDate` + `remind`, an
 *     unreadable date is refused by name, and nothing is ever read out of text;
 *   - `fire()` has a live caller, so a quiet date is spent, not re-offered;
 *   - PLAIN items are said on their day, once per beat, to the person and to
 *     the model;
 *   - the gauge reads real evidence.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import type { Salience } from "../src/core/types.js";
import { intake } from "../src/core/remember/index.js";
import {
  CUE_MODE_META,
  PROSPECTIVE_FIRE_EVENT,
  PROSPECTIVE_PLAIN_EVENT,
  Prospective,
  TUNABLES,
  imminence,
  parseWindowKey,
  precisionOf,
  rampAt,
  staggerDays,
  windowFor,
  windowKey,
  withTunables,
} from "../src/core/prospective/index.js";
import type { FireReason } from "../src/core/prospective/index.js";
import { openServer, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { openAdapter, plainLine } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput } from "../src/adapters/claude-code/index.js";
import { deliverTurn, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import { firedReport } from "../src/adapters/fired.js";
import { MEMORY_MECHANISMS, consoleVerdicts, readMechanism } from "../src/adapters/cli/mechanisms.js";
import { mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";

const T = TUNABLES;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-reminders-"));
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

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

const SALIENT: Partial<Salience> = { relevance: 0.7, emotional: 0.7, predictive: 0.7 };
const DULL: Partial<Salience> = { relevance: 0.1, emotional: 0.1, predictive: 0.1 };

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

// ═══════════════════════════════════════════════════════════════════════════
// Range precision, and year still has no window
// ═══════════════════════════════════════════════════════════════════════════

describe("a range is a window precision (2026-09-26)", () => {
  test("its shape, key and round trip", () => {
    expect(precisionOf("2026-10-20..2026-10-31")).toBe("range");
    expect(precisionOf("2026-10-31..2026-10-20")).toBeNull();
    expect(precisionOf(" 2026-10-20..2026-10-31")).toBeNull();
    expect(windowKey("2026-10-20..2026-10-31", "range")).toBe("r:2026-10-20..2026-10-31");
    expect(parseWindowKey("r:2026-10-20..2026-10-31")).toEqual({
      eventDate: "2026-10-20..2026-10-31",
      precision: "range",
    });
    expect(parseWindowKey("r:2026-10")).toBeNull();
  });

  test("a range is at full intensity for all of itself, and decays only through grace", () => {
    const w = windowFor("2026-10-20..2026-10-31", "range", T)!;
    expect(w.opensOn).toBe("2026-10-17");
    expect(w.peakOn).toBe("2026-10-20");
    expect(w.peakUntil).toBe("2026-10-31");
    expect(w.closesOn).toBe("2026-11-07");
    expect(rampAt(w, "2026-10-17", T)).toBeCloseTo(T.RAMP_OPEN, 10);
    for (const at of ["2026-10-20", "2026-10-25", "2026-10-31"]) expect(rampAt(w, at, T)).toBe(1);
    expect(rampAt(w, "2026-11-07", T)).toBeCloseTo(T.RAMP_CLOSE, 10);
    expect(rampAt(w, "2026-11-08", T)).toBe(0);
  });

  test("a YEAR has no window, is never offered as a cue, and is never told plainly", () => {
    expect(windowFor("2026", "year", T)).toBeNull();
    const s = store();
    const id = dated(s, "2026", { meta: { [CUE_MODE_META]: "plain" } });
    const p = new Prospective({ store: s });
    const r = p.arrivals({ at: "2026-09-04", day: 3 });
    expect(r.arrivals).toEqual([]);
    expect(r.refused).toEqual([{ memoryId: id, reason: "year-only-precision" }]);
    expect(p.plainDue({ at: "2026-09-04" })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The four July tune questions (GATES.md finding 3), each with its acceptance
// ═══════════════════════════════════════════════════════════════════════════

describe("tune (a): month warmth is STAGGERED, not piled on the 1st", () => {
  test("twenty month-dated memories peak across the first week, not all on day 1", () => {
    const s = store();
    const ids = Array.from({ length: 20 }, () => dated(s, "2026-10"));
    const p = new Prospective({ store: s });
    const peaks = new Set<string>();
    for (const id of ids) {
      const w = p.deriveFor(id, "2026-10-01", [], 3)?.windows[0];
      expect(w?.key).toBe("m:2026-10"); // the key is the date and nothing else (G9)
      expect(w!.peakOn >= "2026-10-01" && w!.peakOn <= "2026-10-07").toBe(true);
      peaks.add(w!.peakOn);
    }
    expect(peaks.size).toBeGreaterThanOrEqual(4);
    // On the 1st, only the items staggered to day 0 are at full warmth.
    const first = p.arrivals({ at: "2026-10-01", day: 3 }).arrivals;
    expect(first).toHaveLength(20);
    const full = first.filter((a) => a.ramp > 1 - 1e-9).length;
    expect(full).toBeLessThan(20);
    expect(full).toBe(ids.filter((id) => staggerDays(id, T) === 0).length);
  });

  test("stable per memory, and 0 turns it off", () => {
    expect(staggerDays("mem_abc", T)).toBe(staggerDays("mem_abc", T));
    const off = withTunables({ MONTH_STAGGER_DAYS: 0 });
    expect(windowFor("2026-10", "month", off, "mem_abc")?.peakOn).toBe("2026-10-01");
    // No salt, no stagger — the window a key alone describes.
    expect(windowFor("2026-10", "month", T)?.peakOn).toBe("2026-10-01");
  });
});

describe("tune (b): a month's LAST fire waits for after the month", () => {
  test("first fire in the month, the second held until the span ends, then the after beat fires", () => {
    const s = store();
    const id = dated(s, "2026-10");
    const p = new Prospective({ store: s });
    expect(p.fire({ memoryId: id, windowKey: "m:2026-10", at: "2026-10-02", day: 1 }).fired).toBe(true);
    const held = p.fire({ memoryId: id, windowKey: "m:2026-10", at: "2026-10-09", day: 2 });
    expect(held.fired).toBe(false);
    expect(held.reason).toBe<FireReason>("held-for-after");
    // The cue path agrees: it is not offered at all while held.
    const mid = p.arrivals({ at: "2026-10-20", day: 3 });
    expect(mid.arrivals).toEqual([]);
    expect(mid.suppressed).toEqual([{ memoryId: id, windowKey: "m:2026-10", reason: "held-for-after" }]);
    // The month's last day is still the month.
    expect(p.fire({ memoryId: id, windowKey: "m:2026-10", at: "2026-10-31", day: 4 }).reason).toBe<FireReason>(
      "held-for-after",
    );
    // After: inside grace, the last fire is spent — the "how did it go?" beat.
    const after = p.fire({ memoryId: id, windowKey: "m:2026-10", at: "2026-11-02", day: 5 });
    expect(after.fired).toBe(true);
    expect(after.fires).toBe(T.FIRES_PER_WINDOW);
  });

  test("a range waits the same way; a DAY window is untouched", () => {
    const s = store();
    const range = dated(s, "2026-10-20..2026-10-31");
    const day = dated(s, "2026-10-25");
    const p = new Prospective({ store: s });
    p.fire({ memoryId: range, windowKey: "r:2026-10-20..2026-10-31", at: "2026-10-20", day: 1 });
    expect(
      p.fire({ memoryId: range, windowKey: "r:2026-10-20..2026-10-31", at: "2026-10-25", day: 2 }).reason,
    ).toBe<FireReason>("held-for-after");
    p.fire({ memoryId: day, windowKey: "d:2026-10-25", at: "2026-10-23", day: 1 });
    expect(p.fire({ memoryId: day, windowKey: "d:2026-10-25", at: "2026-10-24", day: 2 }).fired).toBe(true);
  });

  test("with one fire per window there is nothing to hold, so it is not held", () => {
    const s = store();
    const id = dated(s, "2026-10");
    const p = new Prospective({ store: s, tunables: { FIRES_PER_WINDOW: 1 } });
    expect(p.fire({ memoryId: id, windowKey: "m:2026-10", at: "2026-10-02", day: 1 }).fired).toBe(true);
  });
});

describe("tune (c): only DAY-dated items take wake lines", () => {
  test("month and range items arrive as cues but never reach the horizon", () => {
    const s = store();
    const day = dated(s, "2026-10-05");
    const month = dated(s, "2026-10");
    const range = dated(s, "2026-10-03..2026-10-09");
    const p = new Prospective({ store: s });
    const h = p.horizon({ at: "2026-10-05", day: 3 });
    expect(h.considered.arrivals.map((a) => a.memoryId).sort()).toEqual([day, month, range].sort());
    expect(h.items.map((i) => i.memoryId)).toEqual([day]);
  });

  test("a store of only month items has nothing on the horizon", () => {
    const s = store();
    dated(s, "2026-10");
    const h = new Prospective({ store: s }).horizon({ at: "2026-10-01", day: 3 });
    expect(h.considered.arrivals).toHaveLength(1);
    expect(h.reason).toBe("nothing-arrived");
  });
});

describe("tune (d): IMMINENCE breaks a salience tie", () => {
  test("at equal salience and equal ramp, today beats sometime-this-month", () => {
    const s = store();
    // Month first, so id and insertion order would favour it on a plain sort.
    const month = dated(s, "2026-05");
    const today = dated(s, "2026-05-01");
    const p = new Prospective({ store: s, tunables: { MONTH_STAGGER_DAYS: 0 } });
    const arrivals = p.arrivals({ at: "2026-05-01", day: 3 }).arrivals;
    expect(arrivals.map((a) => a.ramp)).toEqual([1, 1]);
    expect(arrivals[0]?.strength).toBeCloseTo(arrivals[1]?.strength as number, 12);
    expect(arrivals.map((a) => a.memoryId)).toEqual([today, month]);
  });

  test("imminence is sooner first, then narrower", () => {
    const d = windowFor("2026-05-01", "day", T)!;
    const m = windowFor("2026-05", "month", T)!;
    const later = windowFor("2026-05-03", "day", T)!;
    expect(imminence(d, "2026-05-01")).toEqual([0, 1]);
    expect(imminence(m, "2026-05-01")).toEqual([0, 31]);
    expect(imminence(later, "2026-05-01")).toEqual([2, 1]);
  });

  test("it only breaks TIES: a clearly stronger month item still ranks first", () => {
    const s = store();
    const strong = dated(s, "2026-05", { salience: { relevance: 1, emotional: 1, predictive: 1 } });
    const weak = dated(s, "2026-05-01");
    const p = new Prospective({ store: s, tunables: { MONTH_STAGGER_DAYS: 0 } });
    expect(p.arrivals({ at: "2026-05-01", day: 3 }).arrivals.map((a) => a.memoryId)).toEqual([strong, weak]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The write path: an explicit field, never a date read out of text
// ═══════════════════════════════════════════════════════════════════════════

const SESSION = "sess_reminders";

function server(): McpServer {
  // A pinned clock and zone: the replies below echo October dates exactly, and
  // since review N8 a date that has passed carries a notice — so on the wall
  // clock these would start failing once October 2026 was over.
  const s = openServer({
    dir,
    session: SESSION,
    scope: "/scope/one",
    owner: true,
    now: () => Date.parse("2026-09-26T12:00:00Z"),
    timeZone: "UTC",
  });
  open.push(s.counterpart);
  return s;
}

describe("note and session_end take eventDate + remind", () => {
  test("intake: the four shapes read, anything else is malformed by name", () => {
    for (const d of ["2026-10-15", "2026-10", "2026", "2026-10-20..2026-10-31"]) {
      const r = intake({ content: "x", eventDate: d });
      expect(r.ok && r.draft.eventDate).toBe(d);
      expect(r.ok && r.draft.remind).toBe("quiet");
    }
    for (const bad of ["late October", "2026-13", "10/15/2026", "2026-10-31..2026-10-20", 20261015]) {
      const r = intake({ content: "x", eventDate: bad });
      expect(r.ok ? "ok" : r.reason).toBe("EVENT_DATE_UNREADABLE");
    }
    const noisy = intake({ content: "x", eventDate: "2026-10-15", remind: "loud" });
    expect(noisy.ok ? "ok" : noisy.reason).toBe("REMIND_UNKNOWN");
    const bare = intake({ content: "x", remind: "plain" });
    expect(bare.ok && bare.draft.remind).toBeUndefined();
    expect(bare.dropped).toContain("remind");
  });

  test("a note with a date and remind: plain lands on the column and in meta, and says so", async () => {
    const s = server();
    const body = (
      await s.call("note", {
        text: "Mike has to pay his quarterly estimated taxes before the deadline on the fifteenth.",
        title: "pay your taxes",
        eventDate: "2026-10-15",
        remind: "plain",
      })
    ).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(body["reminder"]).toEqual({ eventDate: "2026-10-15", remind: "plain" });
    const id = body["id"] as string;
    const doc = s.counterpart.store.readProse(id);
    expect(doc.eventDate).toBe("2026-10-15");
    expect(doc.meta[CUE_MODE_META]).toBe("plain");
    expect(s.counterpart.store.row(id)?.event_date).toBe("2026-10-15");
  });

  test("an unreadable date is REFUSED before anything is stored, and the refusal lists the shapes", async () => {
    const s = server();
    const before = s.counterpart.store.list().length;
    const result = await s.call("note", {
      text: "The launch happens sometime in late October, after the beta closes.",
      eventDate: "late October",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent["reason"]).toBe("event-date-unreadable");
    expect(String(result.structuredContent["detail"])).toContain("2026-10-20..2026-10-31");
    expect(s.counterpart.store.list().length).toBe(before);
  });

  test("no date is ever read out of the TEXT", async () => {
    const s = server();
    const body = (
      await s.call("note", { text: "The dentist appointment is on 2026-10-03 at nine in the morning, downtown." })
    ).structuredContent;
    expect(body["stored"]).toBe(true);
    expect(s.counterpart.store.readProse(body["id"] as string).eventDate).toBeUndefined();
    expect(s.counterpart.store.datedMemories("0001-01-01", "9999-12-31")).toEqual([]);
  });

  test("remind with no date is kept out and said, and the memory still lands", async () => {
    const s = server();
    const body = (
      await s.call("note", { text: "Always double-check the invoice totals before sending them out.", remind: "plain" })
    ).structuredContent;
    expect(body["stored"]).toBe(true);
    expect((body["reminder"] as Record<string, unknown>)["ignored"]).toBe("remind");
    expect(s.counterpart.store.readProse(body["id"] as string).meta[CUE_MODE_META]).toBeUndefined();
  });

  test("session_end: a bad date refuses ITS entry by name, and a dated sibling lands with its date", async () => {
    const s = server();
    const body = (
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "The conference talk proposal is due at the end of next month.", eventDate: "next month" },
          {
            content: "The venue walkthrough for the offsite happens in late October.",
            eventDate: "2026-10-20..2026-10-31",
          },
        ],
      })
    ).structuredContent;
    const outcomes = body["outcomes"] as Record<string, unknown>[];
    expect(outcomes[0]?.["stored"]).toBe(false);
    expect(outcomes[0]?.["reason"]).toBe("event-date-unreadable");
    expect(outcomes[1]?.["stored"]).toBe(true);
    expect(outcomes[1]?.["reminder"]).toEqual({ eventDate: "2026-10-20..2026-10-31", remind: "quiet" });
    expect(s.counterpart.store.readProse(outcomes[1]?.["id"] as string).eventDate).toBe("2026-10-20..2026-10-31");
  });

  test("the published schemas carry both fields on note and on every session_end entry", () => {
    const note = (toolSpec("note")?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    const entry = (
      toolSpec("session_end")?.inputSchema as {
        properties: { memories: { items: { properties: Record<string, { enum?: string[] }> } } };
      }
    ).properties.memories.items.properties;
    for (const props of [note, entry]) {
      expect(props["eventDate"]).toBeDefined();
      expect(props["remind"]?.enum).toEqual(["plain", "quiet"]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fire() has a live caller: a quiet date is SPENT, not re-offered every turn
// ═══════════════════════════════════════════════════════════════════════════

const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
];
const NOTHING = "zygomorphic vellichor quixotry";

function counterpartWithDate(date: string, mode?: "plain" | "quiet"): { c: Counterpart; id: string } {
  const c = Counterpart.open({ dir, owner: true });
  open.push(c);
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
  const id = c.store.put({
    type: "memory",
    kind: "person",
    title: "Portland move",
    body: "The Portland move lands on the fourth and the truck is booked.",
    learnedOn: "2026-08-25",
    eventDate: date,
    ...(mode === undefined ? {} : { meta: { [CUE_MODE_META]: mode } }),
    salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 },
  });
  return { c, id };
}

describe("the Arriving line says when it is due (2026-10-01)", () => {
  test("the learned date, then the due date: never the learned date alone", () => {
    // A watch list read "2026-09-27 · …" while the item was due 2026-10-03.
    const { c } = counterpartWithDate("2026-10-03");
    c.rebrief({ budgetBytes: 20_000, at: "2026-10-01" });
    const text = c.wake(20_000, { date: "2026-10-01" }).text;
    const lines = text.split("\n");
    const at = lines.indexOf("Arriving:");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("- 2026-08-25 (due 2026-10-03) · The Portland move lands on the fourth and the truck is booked.");
  });

  test("due on the day it was learned: one date, stated once", () => {
    const { c } = counterpartWithDate("2026-08-25");
    c.rebrief({ budgetBytes: 20_000, at: "2026-08-24" });
    const lines = c.wake(20_000, { date: "2026-08-24" }).text.split("\n");
    const at = lines.indexOf("Arriving:");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("- 2026-08-25 · The Portland move lands on the fourth and the truck is booked.");
  });
});

describe("Counterpart.recallForTurn spends the fires it surfaced", () => {
  test("a temporal-only footnote spends one fire, and the same lived day never offers it again", () => {
    const { c, id } = counterpartWithDate("2026-09-04");
    const first = c.recallForTurn({ sessionId: "s1", text: NOTHING }, { at: "2026-09-04" });
    expect(first.decision.footnotes).toContain(id);
    const rows = c.store.prospectiveFor(id);
    expect(rows.map((r) => [r.window_key, r.fires])).toEqual([["d:2026-09-04", 1]]);
    const fireRows = c.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT });
    expect(fireRows).toHaveLength(1);
    expect(JSON.parse(fireRows[0]?.payload ?? "{}")["mode"]).toBe("quiet");

    // Another session, the same lived day: the cue is not even offered.
    for (const session of ["s2", "s3", "s4"]) {
      const again = c.recallForTurn({ sessionId: session, text: NOTHING }, { at: "2026-09-04" });
      expect(again.decision.footnotes).not.toContain(id);
    }
    expect(c.store.prospectiveFor(id)[0]?.fires).toBe(1);
  });

  test("the cap holds across lived days: FIRES_PER_WINDOW fires, then silence", () => {
    const { c, id } = counterpartWithDate("2026-09-04");
    const dates = ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    for (const [i, at] of dates.entries()) {
      c.store.advanceClock(at);
      c.recallForTurn({ sessionId: `s${i}`, text: NOTHING }, { at });
    }
    expect(c.store.prospectiveFor(id)[0]?.fires).toBe(T.FIRES_PER_WINDOW);
    expect(c.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT })).toHaveLength(T.FIRES_PER_WINDOW);
  });

  test("an observer surfaces it and spends nothing", () => {
    const { c, id } = counterpartWithDate("2026-09-04");
    c.close();
    open.length = 0;
    const obs = Counterpart.open({ dir, observer: true });
    open.push(obs);
    const out = obs.recallForTurn({ sessionId: "s1", text: NOTHING }, { at: "2026-09-04" });
    expect(out.decision.footnotes).toContain(id);
    expect(obs.store.prospectiveFor(id)).toEqual([]);
  });

  test("no calendar date, no temporal channel, nothing spent", () => {
    const { c, id } = counterpartWithDate("2026-09-04");
    const out = c.recallForTurn({ sessionId: "s1", text: NOTHING });
    expect(out.decision.footnotes).not.toContain(id);
    expect(c.store.prospectiveFor(id)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PLAIN items: said on the day, once per beat, to the person and the model
// ═══════════════════════════════════════════════════════════════════════════

describe("plain reminders", () => {
  test("a day item is told on its day, once — whatever its salience", () => {
    const { c, id } = counterpartWithDate("2026-10-15", "plain");
    // A dull one too: the salience floor gates UNASKED surfacing, not this.
    const dull = dated(c.store, "2026-10-15", { title: "renew the passport", salience: DULL, meta: { [CUE_MODE_META]: "plain" } });
    expect(c.plainReminders({ at: "2026-10-14" })).toEqual([]);
    const told = c.plainReminders({ at: "2026-10-15" });
    expect(told.map((r) => [r.memoryId, r.beat, r.what]).sort()).toEqual(
      [
        [id, "day", "Portland move"],
        [dull, "day", "renew the passport"],
      ].sort(),
    );
    expect(c.plainReminders({ at: "2026-10-15" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-10-16" })).toEqual([]);
    expect(c.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(2);
  });

  test("told plainly today, it is not ALSO offered as a quiet footnote that day", () => {
    const { c, id } = counterpartWithDate("2026-10-15", "plain");
    expect(c.plainReminders({ at: "2026-10-15" })).toHaveLength(1);
    const r = c.prospective.arrivals({ at: "2026-10-15", day: 3 });
    expect(r.arrivals).toEqual([]);
    expect(r.suppressed).toEqual([{ memoryId: id, windowKey: "d:2026-10-15", reason: "told-plainly-today" }]);
    // The next day it is an ordinary dated memory in grace again.
    expect(c.prospective.arrivals({ at: "2026-10-16", day: 4 }).arrivals.map((a) => a.memoryId)).toEqual([id]);
  });

  test("TOLD ON ITS DAY, a plain reminder leaves Arriving for the grace week — still a cue for recall; a quiet one stays (2026-09-29)", () => {
    const { c, id } = counterpartWithDate("2026-10-15", "plain");
    const quiet = dated(c.store, "2026-10-15", { title: "the quiet one", meta: { [CUE_MODE_META]: "quiet" } });
    const lane = (at: string, day: number): string[] => c.prospective.horizon({ at, day }).items.map((i) => i.memoryId);
    // Before its day it is arriving, like any day item.
    expect(lane("2026-10-13", 1).sort()).toEqual([id, quiet].sort());
    // Told on its day...
    expect(c.plainReminders({ at: "2026-10-15" }).map((r) => r.memoryId)).toEqual([id]);
    // ...it is gone from the lane for every day of grace, while the quiet one
    // stays, and the told one still ARRIVES — recall's cue path still has it.
    for (let k = 1; k <= T.GRACE_DAYS; k++) {
      const at = `2026-10-${String(15 + k).padStart(2, "0")}`;
      expect(lane(at, 3 + k), at).toEqual([quiet]);
      expect(c.prospective.arrivals({ at, day: 3 + k }).arrivals.map((a) => a.memoryId), at).toContain(id);
    }
  });

  test("a plain reminder whose day passed UNTOLD stays in Arriving through grace", () => {
    const { c, id } = counterpartWithDate("2026-10-15", "plain");
    // Nobody opened a session on the 15th: no beat was told.
    expect(c.prospective.horizon({ at: "2026-10-16", day: 4 }).items.map((i) => i.memoryId)).toEqual([id]);
  });

  test("a CONFIDENTIAL plain item is told only in the owner's own session", () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    const secret = dated(c.store, "2026-10-15", {
      title: "the biopsy results call",
      meta: { [CUE_MODE_META]: "plain", confidential: true },
    });
    expect(c.plainReminders({ at: "2026-10-15" })).toEqual([]);
    c.close();
    open.length = 0;
    const mine = Counterpart.open({ dir, owner: true });
    open.push(mine);
    expect(mine.plainReminders({ at: "2026-10-15" }).map((r) => r.memoryId)).toEqual([secret]);
  });

  test("a quiet item is never told; an archived or superseded one neither", () => {
    const { c } = counterpartWithDate("2026-10-15", "quiet");
    const gone = dated(c.store, "2026-10-15", { meta: { [CUE_MODE_META]: "plain" } });
    c.store.archive(gone, "done already");
    expect(c.plainReminders({ at: "2026-10-15" })).toEqual([]);
  });

  test("a range: told the first day it is seen open, then on its last day — nothing between", () => {
    const { c, id } = counterpartWithDate("2026-10-20..2026-10-31", "plain");
    expect(c.plainReminders({ at: "2026-10-19" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-10-22" }).map((r) => r.beat)).toEqual(["opens"]);
    for (const at of ["2026-10-23", "2026-10-27", "2026-10-30"]) expect(c.plainReminders({ at })).toEqual([]);
    const last = c.plainReminders({ at: "2026-10-31" });
    expect(last.map((r) => [r.memoryId, r.beat])).toEqual([[id, "last-day"]]);
    expect(c.plainReminders({ at: "2026-11-01" })).toEqual([]);
  });

  test("a month first seen on its last day gets that beat only", () => {
    const { c } = counterpartWithDate("2026-10", "plain");
    expect(c.plainReminders({ at: "2026-10-31" }).map((r) => r.beat)).toEqual(["last-day"]);
    expect(c.plainReminders({ at: "2026-10-31" })).toEqual([]);
  });

  test("two processes racing for one beat: exactly one wins", () => {
    const { c, id } = counterpartWithDate("2026-10-15", "plain");
    const other = new Prospective({ store: c.store });
    const due = other.plainDue({ at: "2026-10-15" });
    expect(due.map((d) => d.memoryId)).toEqual([id]);
    expect(other.claimPlain(due[0]!, { at: "2026-10-15" })).toBe(true);
    // The first process asks after the other one claimed it.
    expect(c.plainReminders({ at: "2026-10-15" })).toEqual([]);
    expect(other.claimPlain(due[0]!, { at: "2026-10-15" })).toBe(false);
  });

  test("an observer is told nothing and writes nothing", () => {
    const { c } = counterpartWithDate("2026-10-15", "plain");
    c.close();
    open.length = 0;
    const obs = Counterpart.open({ dir, observer: true });
    open.push(obs);
    expect(obs.plainReminders({ at: "2026-10-15" })).toEqual([]);
    expect(obs.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);
  });

  test("the words: one short line per beat", () => {
    expect(plainLine({ beat: "day", precision: "day", lastDay: "2026-10-15", what: "pay your taxes" })).toBe(
      "Today: pay your taxes",
    );
    expect(plainLine({ beat: "opens", precision: "month", lastDay: "2026-10-31", what: "launch the beta" })).toBe(
      "This month: launch the beta",
    );
    expect(plainLine({ beat: "opens", precision: "range", lastDay: "2026-10-31", what: "book flights" })).toBe(
      "Until Sat 31 Oct 2026: book flights",
    );
    expect(plainLine({ beat: "last-day", precision: "range", lastDay: "2026-10-31", what: "book flights" })).toBe(
      "Last day today: book flights",
    );
  });
});

describe("plain reminders reach the person AND the model, through the hooks", () => {
  function hooks(): ReturnType<typeof openAdapter> {
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000, owner: true };
    const a = openAdapter(config, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    return a;
  }
  function input(over: Partial<HookInput> = {}): HookInput {
    return { sessionId: "s1", scope: "proj", turns: [], at: "2026-10-15", ...over };
  }

  test("SessionStart: the line rides in the context under the clock, and as the terminal's systemMessage", () => {
    const a = hooks();
    const id = dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    const result = a.sessionStart(input());
    expect(result.notices).toEqual(["Today: pay your taxes"]);
    expect(result.injection).toMatch(/^Now: .*\nPlain reminder \(they asked to be told\) — Today: pay your taxes \[/);
    expect(result.injection).toContain(`[${id}]`);
    // Nothing is claimed until the delivery knows the envelope carries it.
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);
    const delivered = deliverTurn(
      "session-start",
      result,
      { hook_event_name: "SessionStart" },
      [null, null],
      { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) },
      input(),
    );
    const out = JSON.parse(delivered.stdout) as Record<string, unknown>;
    expect(out["systemMessage"]).toBe("Today: pay your taxes");
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);

    // The same session's first prompt does not say it again.
    const turn = a.userPromptSubmit(input({ prompt: "morning" }));
    expect(turn.notices).toBeUndefined();
    expect(turn.injection).not.toContain("pay your taxes");
  });

  test("UserPromptSubmit: a day that began mid-session is said at the next prompt, once", () => {
    const a = hooks();
    dated(a.counterpart.store, "2026-10-15", { title: "pay your taxes", meta: { [CUE_MODE_META]: "plain" } });
    a.sessionStart(input({ at: "2026-10-14" }));
    const turn = a.userPromptSubmit(input({ prompt: "still here after midnight" }));
    expect(turn.notices).toEqual(["Today: pay your taxes"]);
    expect(turn.injection).toContain("Today: pay your taxes");
    const delivered = deliverTurn(
      "user-prompt-submit",
      turn,
      {},
      null,
      { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) },
      input(),
    );
    expect((JSON.parse(delivered.stdout) as Record<string, unknown>)["systemMessage"]).toBe("Today: pay your taxes");
    expect(a.userPromptSubmit(input({ prompt: "and again" })).notices).toBeUndefined();
  });

  test("a prompt with nothing to tell prints exactly what it printed before", () => {
    const d = hostDelivery("user-prompt-submit", { injection: "Now: x", ask: null }, {}, null);
    expect(d.stdout).toBe("Now: x");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The gauge reads real evidence
// ═══════════════════════════════════════════════════════════════════════════

describe("the gauge", () => {
  const TODAY = "2026-10-15";
  const now = (): number => Date.parse(`${TODAY}T12:00:00Z`);

  function cliLine(s: Store): { light: string; says: string } {
    const report = firedReport(s, TODAY);
    const byId = new Map(report.rows.map((r) => [r.id, r]));
    const m = MEMORY_MECHANISMS.find((x) => x.name === "Prospective")!;
    return readMechanism(m, consoleVerdicts(s, TODAY), (id) => byId.get(id));
  }

  function dashboard(s: Store): { status: string; evidence: string } {
    const v = mechanismsView({ store: s } as unknown as Parameters<typeof mechanismsView>[0]);
    return v.mechanisms.find((m) => m.id === "prospective")!;
  }

  test("nothing dated: built and waiting — never grey, which means not built", () => {
    const s = store({ now });
    expect(cliLine(s).light).toBe("◐");
    expect(cliLine(s).says).toContain("nothing dated yet");
    expect(dashboard(s).status).toBe("waiting");
  });

  test("dated, nothing due: built and waiting, with the count held", () => {
    const s = store({ now });
    dated(s, "2026-12-25");
    expect(cliLine(s).light).toBe("◐");
    expect(cliLine(s).says).toContain("1 dated memory held");
    const d = dashboard(s);
    expect(d.status).toBe("amber");
    expect(d.evidence).toContain("1 dated memory held.");
  });

  test("fired this week: plain and quiet counted apart, and today's said", () => {
    const s = store({ now });
    const quiet = dated(s, "2026-10-15");
    const plain = dated(s, "2026-10-15", { meta: { [CUE_MODE_META]: "plain" } });
    const p = new Prospective({ store: s });
    expect(p.fire({ memoryId: quiet, windowKey: "d:2026-10-15", at: TODAY }).fired).toBe(true);
    const due = p.plainDue({ at: TODAY }).find((d) => d.memoryId === plain)!;
    expect(p.claimPlain(due, { at: TODAY })).toBe(true);
    const line = cliLine(s);
    expect(line.light).toBe("●");
    expect(line.says).toBe("2 reminders came back (1 said plainly, 1 as quiet footnotes); 2 dated memories held");
    const d = dashboard(s);
    expect(d.status).toBe("green");
    expect(d.evidence).toContain("1 reminder said plainly");
    expect(d.evidence).toContain("1 reminder came back as a quiet footnote");
    expect(d.evidence).toContain("2 today.");
    expect(d.evidence).toContain("2 dated memories held.");
  });
});
