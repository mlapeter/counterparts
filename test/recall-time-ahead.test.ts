/**
 * RANGES, LOOK-AHEAD AND REMINDER DATES IN FACTS MODE (2026-11-13, the wren
 * findings' P1, P2 and P5; `src/core/recall/time-ask.ts`,
 * `src/adapters/mcp/facts.ts`).
 *
 *   - a range of days ("between 12 and 18 October") is one window, not its
 *     last day;
 *   - the forward words ("tomorrow", "next week", "next month", "this
 *     weekend", "the coming week") are read, and a window still to come is
 *     exact;
 *   - a window reaching past today takes a memory by its reminder date too
 *     (`dueIn`), a repeat by its occurrence, a closed or done one not; a
 *     window wholly in the past is read as before;
 *   - a memory's line says `due <date>` where it said "no event date".
 *
 * Hermetic: every test makes its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { factsRecall, renderFacts } from "../src/adapters/mcp/facts.js";
import type { FactsResult } from "../src/adapters/mcp/facts.js";
import { Counterpart } from "../src/core/counterpart.js";
import { readTimeAsk } from "../src/core/recall/index.js";
import { findable } from "./store-fixture.js";

const ZONE = "America/Los_Angeles";
/** Saturday 2026-10-03, 15:00 local. */
const NOW = Date.parse("2026-10-03T22:00:00Z");
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-time-ahead-"));
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

function brain(now = NOW): Counterpart {
  const c = Counterpart.open({ dir: join(dir, "store"), now: () => now, timeZone: ZONE });
  findable(c.store);
  open.push(c);
  return c;
}

function ask(c: Counterpart, question: string): FactsResult {
  return factsRecall({ counterpart: c, sessionId: SESSION, vector: null, semantic: "embedder-off" }, question);
}

const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "The neighbour's cat sits on the fence every evening.",
];

function seed(c: Counterpart): void {
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
}

const clockAt = (iso: string): { now: number; zone: string } => ({ now: Date.parse(iso), zone: ZONE });
const clock = { now: NOW, zone: ZONE };

describe("a range of days is one window (time-ask.ts)", () => {
  test("the two recorded questions: \"between 12 and 18 October\" and \"from 12 October to 18 October\"", () => {
    const between = readTimeAsk("what happened between 12 and 18 October", clock);
    expect(between?.said).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(between?.window).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(between?.stretch).toBe(0);
    expect(between?.cue).toBe("between 12 and 18 October");
    expect(between?.rest).toBe("what happened");
    const from = readTimeAsk("from 12 October to 18 October", clock);
    expect(from?.said).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(from?.rest).toBe("");
    // The model's own words in the wren run (beat d14-q-week).
    const recorded = readTimeAsk("appointments, meetings, deliveries, fittings or other non-movie events between 12 and 18 October", clock);
    expect(recorded?.said).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(recorded?.rest).toBe("appointments, meetings, deliveries, fittings or other non-movie events");
  });

  test("every shape of an end, a shared month on either side, and the whole phrase out of the question", () => {
    const week = { from: "2026-10-12", to: "2026-10-18" };
    for (const q of [
      "between 12 October and 18 October",
      "from 12 to 18 October",
      "12 October to 18 October",
      "October 12 through 18",
      "Oct 12-18",
      "12-18 October",
      "12–18 October",
      "the 12th to the 18th of October",
      "between 2026-10-12 and 2026-10-18",
      "10/12 to 10/18",
      "from Oct 12 until Oct 18",
    ]) {
      const r = readTimeAsk(`gym ${q}`, clock);
      expect({ q, said: r?.said, rest: r?.rest }).toEqual({ q, said: week, rest: "gym" });
    }
    expect(readTimeAsk("between 1 and 5 October", clock)?.said).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    // "between 3 and 5 May": a capital May is the month.
    expect(readTimeAsk("between 3 and 5 May", clock)?.said).toEqual({ from: "2026-05-03", to: "2026-05-05" });
  });

  test("yearless across the year end: the first end's year as a date alone, the second the next time it comes round", () => {
    const dec30 = clockAt("2026-12-30T18:00:00Z");
    expect(readTimeAsk("between 28 December and 3 January", dec30)?.said).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    const jan2 = clockAt("2027-01-02T18:00:00Z");
    expect(readTimeAsk("between 28 December and 3 January", jan2)?.said).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    // A year on one end sets the other's, so the range runs forward.
    expect(readTimeAsk("28 December to 3 January 2027", clock)?.said).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(readTimeAsk("from 28 December 2025 to 3 January", clock)?.said).toEqual({ from: "2025-12-28", to: "2026-01-03" });
    // With none, a month not yet begun is last year's, as a date alone ("on 5 December" asked in October).
    expect(readTimeAsk("between 1 and 5 December", clock)?.said).toEqual({ from: "2025-12-01", to: "2025-12-05" });
  });

  test("not a range: an amount or a clock after a bare day, two bare days alone, a lowercase may", () => {
    expect(readTimeAsk("October 5 to 7 people", clock)?.said).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    expect(readTimeAsk("Oct 5 - 7:30", clock)?.said).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    expect(readTimeAsk("from 3 to 5", clock)).toBeNull();
    expect(readTimeAsk("between 3 and 5 may be", clock)?.said).not.toEqual({ from: "2026-05-03", to: "2026-05-05" });
    // Two dates joined by "and" without "between" are two dates, not a range.
    expect(readTimeAsk("12 October and 18 October", clock)?.said).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    // One month, the second day before the first: no range, and no year rolled.
    expect(readTimeAsk("October 20 - 3 things to do", clock)?.said).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(readTimeAsk("between 18 and 12 October", clock)?.said).toEqual({ from: "2026-10-12", to: "2026-10-12" });
  });
});

describe("the forward words (time-ask.ts)", () => {
  // NOW is Saturday 2026-10-03.
  test("tomorrow, the day after, next week, next month: exact, the mirrors of yesterday, last week, last month", () => {
    const tomorrow = readTimeAsk("what is happening tomorrow", clock);
    expect(tomorrow?.said).toEqual({ from: "2026-10-04", to: "2026-10-04" });
    expect(tomorrow?.stretch).toBe(0);
    expect(tomorrow?.rest).toBe("what is happening");
    expect(readTimeAsk("what's on tomorrow morning", clock)?.rest).toBe("what's");
    expect(readTimeAsk("the day after tomorrow", clock)?.said).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    const next = readTimeAsk("what's on next week", clock);
    expect(next?.said).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(next?.window).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(next?.rest).toBe("what's");
    expect(readTimeAsk("next month", clock)?.window).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  test("the rolling ahead: the coming week, the next N days, the next month; and this weekend", () => {
    for (const q of ["this coming week", "the coming week", "the week ahead", "the next week", "the next 7 days"]) {
      expect({ q, said: readTimeAsk(q, clock)?.said }).toEqual({ q, said: { from: "2026-10-03", to: "2026-10-10" } });
    }
    expect(readTimeAsk("the next 3 days", clock)?.said).toEqual({ from: "2026-10-03", to: "2026-10-06" });
    expect(readTimeAsk("in the next month", clock)?.said).toEqual({ from: "2026-10-03", to: "2026-11-03" });
    expect(readTimeAsk("what's on this weekend", clock)?.said).toEqual({ from: "2026-10-03", to: "2026-10-04" });
  });

  test("this week and this month run to their ends; still fuzzy; the past words unchanged", () => {
    const week = readTimeAsk("this week", clock);
    expect(week?.said).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(week?.stretch).toBe(2);
    expect(readTimeAsk("this month", clock)?.said).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(readTimeAsk("last week", clock)?.window).toEqual({ from: "2026-09-19", to: "2026-09-29" });
    expect(readTimeAsk("last month", clock)?.said).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  test("still not read: upcoming, coming up, next Saturday", () => {
    expect(readTimeAsk("what's upcoming", clock)).toBeNull();
    expect(readTimeAsk("what's coming up", clock)).toBeNull();
    expect(readTimeAsk("next Saturday", clock)).toBeNull();
  });
});

describe("the reminder date on a fact's line (facts.ts)", () => {
  test("no event date but a reminder date: due <date>, in the line's own date style", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "Biscuit has the zqvet on Thursday 15 Oct.", saidBy: "owner", eventDate: "2026-10-15" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqvet bill for spring.", eventDate: "2026-11" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqvet is closed on Mondays." });
    const text = renderFacts(ask(c, "zqvet"));
    expect(text).toContain("you said · status unknown · due Thu 10-15\n");
    expect(text).toContain("· due 2026-11\n");
    expect(text).toContain("speaker unknown · status unknown · no event date");
  });

  test("both dates: the event date, and the reminder date beside it when it is another day", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "Booked the zqfitting for the 15th.", status: "done", occurredOn: "2026-10-01", eventDate: "2026-10-15" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqdelivery comes on the 9th.", status: "planned", occurredOn: "2026-10-09", eventDate: "2026-10-09" });
    expect(renderFacts(ask(c, "zqfitting"))).toContain("· done · happened Thu 10-01 · due Thu 10-15\n");
    const same = renderFacts(ask(c, "zqdelivery"));
    expect(same).toContain("· planned · for Fri 10-09\n");
    expect(same).not.toContain("due");
  });
});

describe("a window still to come reads reminder dates (facts.ts)", () => {
  function server(c: Counterpart): McpServer {
    return new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", registryDir: join(dir, "store"), now: () => NOW });
  }
  const body = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  test("a reminder due next week, written today: in \"next week\", by its reminder date, said so", () => {
    const c = brain();
    seed(c);
    const vet = c.store.put({ type: "memory", kind: "fact", body: "Biscuit has the zqvet on Thursday.", eventDate: "2026-10-08" });
    const r = ask(c, "zqvet next week");
    expect(r.memories.map((m) => m.id)).toEqual([vet]);
    expect(r.memories[0]?.timeBy).toBe("due");
    expect(renderFacts(r)).toContain("due Thu 10-08 (in the window by this date)");
  });

  test("a window wholly in the past reads no reminder dates: exactly as before", () => {
    // Written 09-10, due on 10-02: "yesterday" (10-02) and "last week" do not take it by its reminder date.
    const early = brain(Date.parse("2026-09-10T18:00:00Z"));
    const id = early.store.put({ type: "memory", kind: "fact", body: "Pay the zqplumber.", eventDate: "2026-10-02" });
    early.close();
    const c = brain();
    seed(c);
    const r = ask(c, "zqplumber yesterday");
    expect(r.memories.map((m) => m.id)).toEqual([]);
    expect(r.time?.outside).toBe(1);
    expect(ask(c, "zqplumber last week").memories.map((m) => m.id)).toEqual([]);
    // In a window still to come it is not either: its date is behind today.
    expect(ask(c, "zqplumber next week").memories.map((m) => m.id)).toEqual([]);
    expect(id).toMatch(/^mem_/);
  });

  test("a window across today (this week) takes what is due later in it; an open end (after a date) does not", () => {
    const early = brain(Date.parse("2026-09-10T18:00:00Z"));
    const later = early.store.put({ type: "memory", kind: "fact", body: "The zqkiln repair visit.", eventDate: "2026-10-04" });
    const far = early.store.put({ type: "memory", kind: "fact", body: "The zqkiln annual service.", eventDate: "2026-12-01" });
    // Next Monday: inside "this week" only through its two-day stretch, which a reminder date does not take.
    early.store.put({ type: "memory", kind: "fact", body: "The zqkiln shelf delivery.", eventDate: "2026-10-05" });
    early.close();
    const c = brain();
    seed(c);
    const week = ask(c, "zqkiln this week");
    expect(week.memories.map((m) => m.id)).toEqual([later]);
    expect(week.memories[0]?.timeBy).toBe("due");
    // "After 9/20" is a cutoff on what happened: no reminder date reads it, so neither is taken by one.
    expect(ask(c, "zqkiln after 9/20").memories.map((m) => m.id)).toEqual([]);
    expect(far).toMatch(/^mem_/);
  });

  test("a one-off marked done whose date is today is not still to come; one done with a date ahead is left in, as the wake leaves it", () => {
    const early = brain(Date.parse("2026-09-10T18:00:00Z"));
    const today = early.store.put({ type: "memory", kind: "fact", body: "The zqglaze order, today.", status: "done", eventDate: "2026-10-03" });
    const ahead = early.store.put({ type: "memory", kind: "fact", body: "The zqglaze delivery.", status: "done", eventDate: "2026-10-06" });
    early.close();
    const c = brain();
    seed(c);
    const ids = ask(c, "zqglaze the coming week").memories.map((m) => m.id);
    expect(ids).toContain(ahead);
    expect(ids).not.toContain(today);
  });

  test("a weekly repeat matches by its occurrence in the window, said with the occurrence and how it comes round; a closed occurrence gives way to the next", () => {
    const c = brain();
    seed(c);
    // Anchored on Tuesday 2026-09-01; next week's occurrence is Tuesday 10-06.
    const s = server(c);
    return (async () => {
      const made = body(await s.call("remember", { title: "zqbins out", text: "Put the zqbins out on Tuesday night.", eventDate: "2026-09-01", recurring: "weekly" }));
      const id = made["id"] as string;
      const r = ask(c, "zqbins next week");
      expect(r.memories.map((m) => m.id)).toEqual([id]);
      expect(renderFacts(r)).toContain("due Tue 10-06, every Tuesday (in the window by this date)");
      // Done early (10-06's window is open on 10-03): 10-06 is closed, and 10-13 is outside next week.
      expect(c.prospective.closeOccurrence(id, "2026-10-03")?.occurrence).toBe("2026-10-06");
      expect(ask(c, "zqbins next week").memories.map((m) => m.id)).toEqual([]);
      // Over two weeks, the next one comes in its place.
      const two = renderFacts(ask(c, "zqbins between 4 and 17 October"));
      expect(two).toContain("due Tue 10-13, every Tuesday");
    })();
  });
});

describe("through the recall tool, end to end", () => {
  function server(c: Counterpart): McpServer {
    return new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", registryDir: join(dir, "store"), now: () => NOW });
  }
  const body = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  test("a reminder remembered for a few days ahead, no occurredOn: \"what's on next week\" and \"what is happening tomorrow\" find it, due <date>", async () => {
    const c = brain();
    seed(c);
    const s = server(c);
    const vet = body(await s.call("remember", { title: "Biscuit's vet, Wed 7 Oct", text: "Biscuit has the vet on Wednesday 7 Oct at 14:30 with Dr. Okafor.", eventDate: "2026-10-07" }))["id"] as string;
    const pickup = body(await s.call("remember", { title: "Pick up the frames", text: "Pick up the framed prints from the shop.", eventDate: "2026-10-04" }))["id"] as string;
    expect(c.store.row(vet)?.occurred_on ?? null).toBeNull();

    const week = body(await s.call("recall", { question: "what's on next week", mode: "facts" }));
    expect(week["ids"]).toEqual([vet]);
    const weekText = String(week["answer"]);
    expect(weekText).toContain("time: next week → 10-05..10-11");
    expect(weekText).toContain("due Wed 10-07 (in the window by this date)");
    expect(weekText).not.toContain("no event date");

    const tomorrow = body(await s.call("recall", { question: "what is happening tomorrow", mode: "facts" }));
    expect(tomorrow["ids"]).toEqual([pickup]);
    expect(String(tomorrow["answer"])).toContain("due Sun 10-04 (in the window by this date)");
  });

  test("a range question returns memories from the whole window, not its last day", async () => {
    const c = brain();
    seed(c);
    const s = server(c);
    const first = body(await s.call("remember", { title: "zqtour opens", text: "The zqtour opened in Fresno.", occurredOn: "2026-09-12" }))["id"] as string;
    const middle = body(await s.call("remember", { title: "zqtour midway", text: "The zqtour reached Reno.", occurredOn: "2026-09-15" }))["id"] as string;
    const last = body(await s.call("remember", { title: "zqtour closes", text: "The zqtour closed in Boise.", occurredOn: "2026-09-18" }))["id"] as string;
    body(await s.call("remember", { title: "zqtour planning", text: "The zqtour was planned.", occurredOn: "2026-08-20" }));
    const out = body(await s.call("recall", { question: "zqtour between 12 and 18 September", mode: "facts" }));
    expect([...(out["ids"] as string[])].sort()).toEqual([first, middle, last].sort());
    const text = String(out["answer"]);
    expect(text).toContain("time: between 12 and 18 September → 09-12..09-18 · 1 more match outside it");
  });
});
