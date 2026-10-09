/**
 * RECURRING DATES (2026-10-09, the owner's design, held lightly) — a dated
 * memory can carry `recurring: daily | weekly | monthly | yearly`, anchored on
 * its event date, in `meta.recurring` (no schema bump). What this file pins:
 *
 *   - the calendar (`time.ts`): occurrences counted from the anchor, the
 *     month-end rule (the last day of a shorter month), Feb 29 (Feb 28 in a
 *     common year), never an occurrence before the anchor, and the words;
 *   - the window (`prospective/windows.ts#recurringWindowAt`): one occurrence
 *     open at a time, keyed by its own date;
 *   - prospective fires on EACH occurrence — the quiet fire budget and the
 *     plain beat are per occurrence, never once ever and never twice;
 *   - the write path: `note` and `session_end` take `recurring`, refuse an
 *     unknown word or a non-day date by name, carry it on `updates`, and drop
 *     it on `null`; revising a recurring memory does not tell or fire the same
 *     occurrence twice;
 *   - the wake and recall say it beside the date.
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
import { intake } from "../src/core/remember/index.js";
import {
  CUE_MODE_META,
  PROSPECTIVE_PLAIN_EVENT,
  Prospective,
  RECURRING_META,
  TUNABLES,
  contentDates,
  phaseOf,
  recurrenceOf,
  recurringWindowAt,
} from "../src/core/prospective/index.js";
import {
  RECURRENCES,
  addDays,
  occurrenceBetween,
  occurrenceOf,
  occurrenceOnOrAfter,
  readableRecurrence,
} from "../src/core/time.js";
import { openServer, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { meaningRecall, renderMeaning } from "../src/adapters/mcp/meaning.js";

const T = TUNABLES;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-recurring-"));
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

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

function counterpart(): Counterpart {
  const c = Counterpart.open({ dir, owner: true });
  open.push(c);
  return c;
}

let n = 0;
/** A memory dated `date`, repeating `rule`, plain or quiet. */
function repeating(
  s: Store,
  date: string,
  rule: string | null,
  mode: "plain" | "quiet" = "quiet",
  input: Partial<PutInput> = {},
): string {
  n += 1;
  return s.put({
    type: "memory",
    kind: "person",
    title: `occasion ${n}`,
    body: `An occasion number ${n} that comes round again, with enough words to be a memory.`,
    learnedOn: "2026-08-25",
    salience: { relevance: 0.7, emotional: 0.7, predictive: 0.7 },
    eventDate: date,
    meta: { [CUE_MODE_META]: mode, ...(rule === null ? {} : { [RECURRING_META]: rule }) },
    ...input,
  });
}

/** Every calendar day from `from` to `to`, inclusive. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The calendar of a repeat (time.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("time.ts: occurrences, counted from the anchor", () => {
  test("the four words, and each one's next occurrence", () => {
    expect([...RECURRENCES]).toEqual(["daily", "weekly", "monthly", "yearly"]);
    // 2026-10-09 is a Friday; a birthday stated in 1990 comes round next May.
    expect(occurrenceOnOrAfter("1990-05-14", "yearly", "2026-10-09")).toEqual({ k: 37, date: "2027-05-14" });
    expect(occurrenceOnOrAfter("2026-10-12", "weekly", "2026-10-13")?.date).toBe("2026-10-19");
    expect(occurrenceOnOrAfter("2026-10-01", "daily", "2026-10-09")).toEqual({ k: 8, date: "2026-10-09" });
    expect(occurrenceOnOrAfter("2026-01-14", "monthly", "2026-10-15")?.date).toBe("2026-11-14");
    // On the day itself, it is that day.
    expect(occurrenceOnOrAfter("1990-10-09", "yearly", "2026-10-09")?.date).toBe("2026-10-09");
  });

  test("never an occurrence before the anchor: a repeat starts on the day it was stated", () => {
    expect(occurrenceOnOrAfter("2026-10-12", "weekly", "2026-01-01")).toEqual({ k: 0, date: "2026-10-12" });
    expect(occurrenceBetween("2026-10-12", "daily", "2026-10-01", "2026-10-11")).toBeNull();
    expect(occurrenceOf("2026-10-12", "weekly", -1)).toBeNull();
  });

  test("MONTH END: monthly on the 31st falls on the last day of a shorter month, and never drifts", () => {
    const jan31 = (k: number): string | null => occurrenceOf("2026-01-31", "monthly", k);
    expect([0, 1, 2, 3, 4, 13, 14].map(jan31)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    // A leap year's February has its 29th.
    expect(occurrenceOf("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(occurrenceOf("2026-01-30", "monthly", 1)).toBe("2026-02-28");
    // Asked from the middle of the year, the same rule.
    expect(occurrenceOnOrAfter("2026-01-31", "monthly", "2026-04-01")?.date).toBe("2026-04-30");
  });

  test("LEAP DAY: yearly on Feb 29 falls on Feb 28 in a year without one", () => {
    expect([0, 1, 2, 3, 4].map((k) => occurrenceOf("2024-02-29", "yearly", k))).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
    expect(occurrenceOnOrAfter("2024-02-29", "yearly", "2026-03-01")?.date).toBe("2027-02-28");
  });

  test("only a DAY repeats: a month, a range, a year or a typo has no occurrences", () => {
    for (const bad of ["2026-10", "2026-10-20..2026-10-31", "2026", "2026-02-30", ""]) {
      expect(occurrenceOf(bad, "yearly", 1)).toBeNull();
      expect(occurrenceOnOrAfter(bad, "yearly", "2026-10-09")).toBeNull();
      expect(readableRecurrence(bad, "yearly")).toBe("");
    }
  });

  test("the words, from the anchor", () => {
    expect(readableRecurrence("1990-05-14", "yearly")).toBe("every May 14");
    expect(readableRecurrence("2026-10-12", "weekly")).toBe("every Monday");
    expect(readableRecurrence("2026-10-09", "weekly")).toBe("every Friday");
    expect(readableRecurrence("2026-10-09", "daily")).toBe("every day");
    expect(readableRecurrence("2026-01-31", "monthly")).toBe("every month on the 31st");
    expect(readableRecurrence("2026-01-02", "monthly")).toBe("every month on the 2nd");
    expect(readableRecurrence("2026-01-13", "monthly")).toBe("every month on the 13th");
    expect(readableRecurrence("2024-02-29", "yearly")).toBe("every February 29");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// One window at a time, keyed by its occurrence
// ═══════════════════════════════════════════════════════════════════════════

describe("a recurring date has ONE window open at a time, keyed by its occurrence", () => {
  test("yearly: an ordinary day window around each May 14, keyed by the year's date", () => {
    const w = recurringWindowAt("1990-05-14", "yearly", "2027-05-12", T)!;
    expect(w.key).toBe("d:2027-05-14");
    expect(w.eventDate).toBe("2027-05-14");
    expect([w.opensOn, w.closesOn]).toEqual(["2027-05-11", "2027-05-21"]);
    expect([w.anchor, w.recurring]).toEqual(["1990-05-14", "yearly"]);
    // Far from it, the next one, pending.
    const far = recurringWindowAt("1990-05-14", "yearly", "2026-10-09", T)!;
    expect(far.key).toBe("d:2027-05-14");
    expect(phaseOf(far, "2026-10-09")).toBe("pending");
  });

  test("weekly: the coming Monday's lead wins over last Monday's grace — Friday to Thursday", () => {
    const w = recurringWindowAt("2026-10-12", "weekly", "2026-10-14", T)!;
    expect([w.key, w.opensOn, w.closesOn]).toEqual(["d:2026-10-12", "2026-10-09", "2026-10-15"]);
    expect(recurringWindowAt("2026-10-12", "weekly", "2026-10-16", T)?.key).toBe("d:2026-10-19");
  });

  test("daily: the window is the day itself", () => {
    const w = recurringWindowAt("2026-10-01", "daily", "2026-10-09", T)!;
    expect([w.key, w.opensOn, w.peakOn, w.closesOn]).toEqual(["d:2026-10-09", "2026-10-09", "2026-10-09", "2026-10-09"]);
  });

  test("for every day of three months and every rule, exactly one window is open, and it covers the day", () => {
    for (const rule of RECURRENCES) {
      for (const at of days("2026-10-01", "2026-12-31")) {
        const w = recurringWindowAt("2026-09-30", rule, at, T)!;
        if (phaseOf(w, at) !== "arrived") {
          // Only monthly and yearly have days with nothing open.
          expect(["monthly", "yearly"]).toContain(rule);
          continue;
        }
        expect(w.opensOn <= at && at <= w.closesOn).toBe(true);
        // The neighbours' windows do not reach `at`.
        const next = recurringWindowAt("2026-09-30", rule, addDays(w.closesOn, 1), T)!;
        expect(next.opensOn > w.closesOn).toBe(true);
      }
    }
  });

  test("the rule rides only on a day, and only a known word: otherwise the date is once, as stated", () => {
    expect(contentDates({ eventDate: "1990-05-14", meta: { [RECURRING_META]: "yearly" } })).toEqual([
      { date: "1990-05-14", recurring: "yearly" },
    ]);
    expect(contentDates({ eventDate: "2026-10", meta: { [RECURRING_META]: "yearly" } })).toEqual([{ date: "2026-10" }]);
    expect(recurrenceOf({ eventDate: "1990-05-14", meta: { [RECURRING_META]: "fortnightly" } })).toBeNull();
    expect(recurrenceOf({ meta: { [RECURRING_META]: "yearly" } })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The store: in meta, beside remind — and found by occurrence
// ═══════════════════════════════════════════════════════════════════════════

describe("the store keeps it in meta and finds it by occurrence (no schema bump)", () => {
  test("the anchor stays on the column; recurringMemories finds what datedMemories cannot", () => {
    const s = store();
    const birthday = repeating(s, "1990-05-14", "yearly");
    const once = repeating(s, "2026-10-15", null);
    const month = repeating(s, "2026-10", "yearly");
    expect(s.row(birthday)?.event_date).toBe("1990-05-14");
    expect(s.readProse(birthday).meta[RECURRING_META]).toBe("yearly");
    // The date as stated never reaches next May; the repeat is the other half.
    expect(s.datedMemories("2027-05-11", "2027-05-21").map((d) => d.id)).toEqual([]);
    expect(s.recurringMemories()).toEqual([{ id: birthday, eventDate: "1990-05-14", recurring: "yearly" }]);
    expect(s.recurringMemories().map((r) => r.id)).not.toContain(once);
    // A month does not repeat: it stays a one-off, found by its own date.
    expect(s.recurringMemories().map((r) => r.id)).not.toContain(month);
    s.archive(birthday, "test");
    expect(s.recurringMemories()).toEqual([]);
    expect(s.recurringMemories({ archived: true }).map((r) => r.id)).toEqual([birthday]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Prospective fires on EACH occurrence
// ═══════════════════════════════════════════════════════════════════════════

describe("prospective: each occurrence is its own window", () => {
  test("QUIET yearly: arrives each year, spends its budget per occurrence, then the next year's is fresh", () => {
    const s = store();
    const id = repeating(s, "1990-05-14", "yearly");
    const p = new Prospective({ store: s });
    const a = p.arrivals({ at: "2026-05-14", day: 10 }).arrivals;
    expect(a.map((x) => [x.memoryId, x.windowKey, x.eventDate, x.anchor, x.recurring])).toEqual([
      [id, "d:2026-05-14", "2026-05-14", "1990-05-14", "yearly"],
    ]);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-05-14", at: "2026-05-14", day: 10 }).fired).toBe(true);
    expect(p.fire({ memoryId: id, windowKey: "d:2026-05-14", at: "2026-05-15", day: 11 }).fired).toBe(true);
    // The cap holds for THIS occurrence...
    const spent = p.fire({ memoryId: id, windowKey: "d:2026-05-14", at: "2026-05-16", day: 12 });
    expect(spent.reason).toBe("over-fired");
    expect(p.arrivals({ at: "2026-05-16", day: 12 }).arrivals).toEqual([]);
    // ...and next year's owes nothing to it.
    const next = p.arrivals({ at: "2027-05-14", day: 300 }).arrivals;
    expect(next.map((x) => [x.windowKey, x.fires])).toEqual([["d:2027-05-14", 0]]);
    expect(p.fire({ memoryId: id, windowKey: "d:2027-05-14", at: "2027-05-14", day: 300 }).fired).toBe(true);
    expect(s.prospectiveFor(id).map((r) => [r.window_key, r.fires])).toEqual([
      ["d:2026-05-14", 2],
      ["d:2027-05-14", 1],
    ]);
    // A stale key — last year's — is not a window of the memory today.
    expect(p.fire({ memoryId: id, windowKey: "d:2026-05-14", at: "2027-05-15", day: 301 }).reason).toBe("window-not-derived");
  });

  test("QUIET weekly: never two arrivals at once across three weeks, and at most one fire a lived day", () => {
    const s = store();
    const id = repeating(s, "2026-10-12", "weekly");
    const p = new Prospective({ store: s });
    let day = 100;
    const keys = new Set<string>();
    for (const at of days("2026-10-09", "2026-11-01")) {
      day += 1;
      const mine = p.arrivals({ at, day }).arrivals.filter((x) => x.memoryId === id);
      expect(mine.length, at).toBeLessThanOrEqual(1);
      for (const x of mine) {
        keys.add(x.windowKey);
        p.fire({ memoryId: id, windowKey: x.windowKey, at, day });
      }
    }
    expect([...keys]).toEqual(["d:2026-10-12", "d:2026-10-19", "d:2026-10-26", "d:2026-11-02"]);
    // Each Monday's window spent at most its cap.
    for (const r of s.prospectiveFor(id)) expect(r.fires).toBeLessThanOrEqual(T.FIRES_PER_WINDOW);
  });

  test("PLAIN yearly: told on May 14 once — and again next May 14, once", () => {
    const c = counterpart();
    const id = repeating(c.store, "1990-05-14", "yearly", "plain");
    expect(c.plainReminders({ at: "2026-05-13" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-05-14" }).map((r) => [r.memoryId, r.windowKey, r.beat])).toEqual([
      [id, "d:2026-05-14", "day"],
    ]);
    expect(c.plainReminders({ at: "2026-05-14" })).toEqual([]);
    expect(c.plainReminders({ at: "2027-05-14" }).map((r) => r.windowKey)).toEqual(["d:2027-05-14"]);
    expect(c.plainReminders({ at: "2027-05-14" })).toEqual([]);
    expect(c.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(2);
  });

  test("PLAIN daily is told each day once; PLAIN weekly only on its weekday", () => {
    const c = counterpart();
    const daily = repeating(c.store, "2026-10-01", "daily", "plain");
    const weekly = repeating(c.store, "2026-10-12", "weekly", "plain");
    const told = new Map<string, string[]>();
    for (const at of days("2026-10-09", "2026-10-20")) {
      const ids = c.plainReminders({ at }).map((r) => r.memoryId);
      told.set(at, ids);
      expect(c.plainReminders({ at }), at).toEqual([]);
    }
    for (const [at, ids] of told) {
      const monday = at === "2026-10-12" || at === "2026-10-19";
      expect(ids.sort(), at).toEqual((monday ? [daily, weekly] : [daily]).sort());
    }
  });

  test("monthly on the 31st is told on the last day of a shorter month", () => {
    const c = counterpart();
    const id = repeating(c.store, "2026-01-31", "monthly", "plain");
    expect(c.plainReminders({ at: "2026-02-27" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-02-28" }).map((r) => r.memoryId)).toEqual([id]);
    expect(c.plainReminders({ at: "2026-03-30" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-03-31" }).map((r) => r.memoryId)).toEqual([id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The write path
// ═══════════════════════════════════════════════════════════════════════════

const SESSION = "sess_recurring";
/** Noon UTC on Friday 2026-10-09. */
const NOON = Date.parse("2026-10-09T12:00:00Z");

function server(): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, now: () => NOON, timeZone: "UTC" });
  open.push(s.counterpart);
  return s;
}

async function note(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = (await s.call("note", args)).structuredContent;
  expect(body["stored"]).toBe(true);
  return body;
}

const BIRTHDAY = "Mike's mother Ruth was born on the ninth of October and loves a phone call that morning.";

describe("note and session_end take recurring", () => {
  test("intake: the four words, refused by name otherwise, and only beside a day", () => {
    for (const rule of RECURRENCES) {
      const r = intake({ content: "x", eventDate: "1990-05-14", recurring: rule });
      expect(r.ok && r.draft.recurring).toBe(rule);
    }
    const unknown = intake({ content: "x", eventDate: "1990-05-14", recurring: "fortnightly" });
    expect(unknown.ok ? "ok" : unknown.reason).toBe("RECURRING_UNKNOWN");
    const month = intake({ content: "x", eventDate: "2026-10", recurring: "yearly" });
    expect(month.ok ? "ok" : month.reason).toBe("RECURRING_NEEDS_DAY");
    const bare = intake({ content: "x", recurring: "yearly" });
    expect(bare.ok && bare.draft.recurring).toBeUndefined();
    expect(bare.dropped).toContain("recurring");
    expect(bare.ok && bare.dateIntent.recurring).toBe("yearly");
    const cleared = intake({ content: "x", recurring: null });
    expect(cleared.ok && cleared.dateIntent.recurring).toBe("cleared");
  });

  test("a birthday: the anchor on the column, the rule in meta, and the answer says how often and when next — never 'passed'", async () => {
    const s = server();
    const body = await note(s, { text: BIRTHDAY, title: "Ruth's birthday", eventDate: "1955-10-12", remind: "plain", recurring: "yearly" });
    expect(body["reminder"]).toEqual({
      eventDate: "1955-10-12",
      remind: "plain",
      recurring: "yearly",
      every: "every October 12",
      next: "2026-10-12",
    });
    const id = body["id"] as string;
    expect(s.counterpart.store.row(id)?.event_date).toBe("1955-10-12");
    expect(s.counterpart.store.readProse(id).meta[RECURRING_META]).toBe("yearly");
    expect(s.counterpart.prospective.plainDue({ at: "2026-10-12" }).map((d) => d.memoryId)).toEqual([id]);
  });

  test("an unknown word is REFUSED before anything is stored, and the refusal lists the four", async () => {
    const s = server();
    const before = s.counterpart.store.list().length;
    const result = await s.call("note", { text: BIRTHDAY, eventDate: "1955-10-09", recurring: "fortnightly" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent["reason"]).toBe("recurring-unknown");
    expect(String(result.structuredContent["detail"])).toContain('"daily", "weekly", "monthly" or "yearly"');
    expect(s.counterpart.store.list().length).toBe(before);
  });

  test("a repeat beside a month is refused by name: only a day repeats", async () => {
    const s = server();
    const result = await s.call("note", { text: "The flu shot clinic runs every October at the pharmacy.", eventDate: "2026-10", recurring: "yearly" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent["reason"]).toBe("recurring-needs-day");
  });

  test("recurring with no date is kept out and said, and the memory still lands", async () => {
    const s = server();
    const body = await note(s, { text: "Water the fern on the windowsill when the soil is dry.", recurring: "weekly" });
    expect((body["reminder"] as Record<string, unknown>)["ignored"]).toBe("recurring");
    expect(s.counterpart.store.readProse(body["id"] as string).meta[RECURRING_META]).toBeUndefined();
  });

  test("session_end: a bad word refuses ITS entry by name, and a recurring sibling lands", async () => {
    const s = server();
    const body = (
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "The team standup happens every other Tuesday at ten.", eventDate: "2026-10-13", recurring: "biweekly" },
          { content: "The recycling goes out to the curb every Monday morning.", eventDate: "2026-10-12", recurring: "weekly" },
        ],
      })
    ).structuredContent;
    const outcomes = body["outcomes"] as Record<string, unknown>[];
    expect(outcomes[0]?.["stored"]).toBe(false);
    expect(outcomes[0]?.["reason"]).toBe("recurring-unknown");
    expect(outcomes[1]?.["stored"]).toBe(true);
    expect(outcomes[1]?.["reminder"]).toEqual({
      eventDate: "2026-10-12",
      remind: "quiet",
      recurring: "weekly",
      every: "every Monday",
      next: "2026-10-12",
    });
  });

  test("the published schemas carry it on note and every session_end entry, in one short sentence", () => {
    const note = (toolSpec("note")?.inputSchema as { properties: Record<string, { enum?: unknown[]; description?: string }> }).properties;
    const entry = (
      toolSpec("session_end")?.inputSchema as {
        properties: { memories: { items: { properties: Record<string, { enum?: unknown[]; description?: string }> } } };
      }
    ).properties.memories.items.properties;
    for (const props of [note, entry]) {
      expect(props["recurring"]?.enum).toEqual(["daily", "weekly", "monthly", "yearly", null]);
      const words = props["recurring"]?.description ?? "";
      expect(words.length).toBeGreaterThan(0);
      expect(words.length).toBeLessThanOrEqual(240);
      expect(words.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 1)).toHaveLength(1);
    }
  });
});

describe("a revision owns the repeat, and never tells or fires the same occurrence twice", () => {
  test("told on its day, then revised that day: carried over, and not told again", async () => {
    const s = server();
    const c = s.counterpart;
    const old = (await note(s, { text: BIRTHDAY, eventDate: "1955-10-09", remind: "plain", recurring: "yearly" }))["id"] as string;
    expect(c.plainReminders({ at: "2026-10-09" }).map((r) => r.memoryId)).toEqual([old]);
    const body = await note(s, { text: "Ruth's birthday call is best before nine, when she has her coffee on the porch.", updates: old });
    const id = body["id"] as string;
    expect(body["reminder"]).toEqual({
      eventDate: "1955-10-09",
      remind: "plain",
      recurring: "yearly",
      from: old,
      carriedOver: ["eventDate", "remind", "recurring"],
      every: "every October 9",
      next: "2026-10-09",
    });
    expect(c.store.readProse(id).meta[RECURRING_META]).toBe("yearly");
    // One repeat, on the newest memory.
    expect(c.store.recurringMemories().map((r) => r.id)).toEqual([id]);
    // Today's occurrence was TOLD: the successor does not tell it again...
    expect(c.prospective.plainDue({ at: "2026-10-09" })).toEqual([]);
    expect(c.plainReminders({ at: "2026-10-09" })).toEqual([]);
    // ...and next year's is its own.
    expect(c.plainReminders({ at: "2027-10-09" }).map((r) => r.memoryId)).toEqual([id]);
  });

  test("QUIET: a fire spent today on the old memory still counts after a revision", async () => {
    const s = server();
    const c = s.counterpart;
    const old = (await note(s, { text: BIRTHDAY, eventDate: "1955-10-09", recurring: "yearly" }))["id"] as string;
    const day = c.store.livedDay();
    expect(c.prospective.fire({ memoryId: old, windowKey: "d:2026-10-09", at: "2026-10-09", day }).fired).toBe(true);
    const id = (await note(s, { text: "Ruth prefers a call to a card on her birthday, always has.", updates: old }))["id"] as string;
    const r = c.prospective.arrivals({ at: "2026-10-09", day });
    expect(r.arrivals.map((a) => a.memoryId)).not.toContain(id);
    expect(r.suppressed).toContainEqual({ memoryId: id, windowKey: "d:2026-10-09", reason: "already-fired-today" });
    expect(c.prospective.fire({ memoryId: id, windowKey: "d:2026-10-09", at: "2026-10-09", day }).fired).toBe(false);
  });

  test("recurring: null stops it repeating; the date stays, once", async () => {
    const s = server();
    const old = (await note(s, { text: BIRTHDAY, eventDate: "2026-10-20", recurring: "weekly" }))["id"] as string;
    const body = await note(s, { text: "The weekly call with Ruth is just this once now, on the twentieth.", updates: old, recurring: null });
    const id = body["id"] as string;
    expect(body["reminder"]).toEqual({ eventDate: "2026-10-20", remind: "quiet", from: old, carriedOver: ["eventDate", "remind"] });
    expect(s.counterpart.store.readProse(id).meta[RECURRING_META]).toBeUndefined();
    expect(s.counterpart.store.recurringMemories()).toEqual([]);
    expect(s.counterpart.store.datedMemories("0001-01-01", "9999-12-31").map((d) => d.id)).toEqual([id]);
  });

  test("a revision that moves the date to a month leaves it once, and says so", async () => {
    const s = server();
    const old = (await note(s, { text: BIRTHDAY, eventDate: "1955-10-09", recurring: "yearly" }))["id"] as string;
    const body = await note(s, { text: "Ruth's birthday party is sometime in November this year.", updates: old, eventDate: "2026-11" });
    const reminder = body["reminder"] as Record<string, unknown>;
    expect(reminder["eventDate"]).toBe("2026-11");
    expect(reminder["recurring"]).toBeUndefined();
    expect(String(reminder["note"])).toContain("only a day repeats");
    expect(s.counterpart.store.recurringMemories()).toEqual([]);
    expect(s.counterpart.store.readProse(body["id"] as string).meta[RECURRING_META]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The wake and recall say it beside the date
// ═══════════════════════════════════════════════════════════════════════════

describe("the wake and recall show how often, beside the date", () => {
  test("Arriving: the due date is this occurrence, and the repeat is said", () => {
    const c = counterpart();
    for (const body of ["Ran the morning loop around the reservoir.", "The library closes early on Sundays now."]) {
      c.store.put({ type: "memory", kind: "fact", body });
    }
    c.store.put({
      type: "memory",
      kind: "fact",
      body: "The recycling goes out to the curb on Monday mornings.",
      learnedOn: "2026-08-25",
      eventDate: "2026-08-31",
      meta: { [RECURRING_META]: "weekly" },
      salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 },
    });
    c.rebrief({ budgetBytes: 20_000, at: "2026-10-10" });
    const lines = c.wake(20_000, { date: "2026-10-10" }).text.split("\n");
    const at = lines.indexOf("Arriving:");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("- 2026-08-25 (due 2026-10-12, every Monday) · The recycling goes out to the curb on Monday mornings.");
  });

  test("recall (meaning): a repeating reminder is dated by its next occurrence, with how often", () => {
    let clock = Date.parse("2026-10-01T10:00:00Z");
    const c = Counterpart.open({ dir, owner: true, now: () => clock, timeZone: "UTC", identity: { name: "Mike" } });
    open.push(c);
    const card = c.schemas.mention({ name: "Han", kind: "person", source: "Han", chunkRef: "card-han", aliases: [], day: c.store.livedDay() });
    expect(card.ok).toBe(true);
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Han was born on the twelfth of October; say happy birthday to Han.",
      origin: { session: "sess_a", scope: "/proj/one" },
      eventDate: "1990-10-12",
      meta: { [RECURRING_META]: "yearly" },
    });
    clock = Date.parse("2026-10-03T09:00:00Z");
    const r = meaningRecall({ counterpart: c, sessionId: "sess_asker", owner: true }, "What has Han been to me?");
    const dated = r.open.find((o) => o.id === id);
    expect(dated).toEqual({ id, title: expect.any(String), why: "dated", date: "2026-10-12", every: "every October 12" });
    expect(renderMeaning(r)).toContain("dated 2026-10-12, every October 12");
  });
});
