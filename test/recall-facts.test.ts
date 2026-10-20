/**
 * FACTS MODE — `recall` with `mode: "facts"` (Release B of deliberate recall,
 * 2026-10-03; `src/adapters/mcp/facts.ts`, `src/core/recall/time-ask.ts`).
 *
 * Every match by words, subjects and time, the closest by meaning capped;
 * ranked by match strength (several ways rank higher), recency only on a tie;
 * a time window filters and counts what fell outside; each fact's labeled
 * lines (who said it, its status, when it happened and was learned, CURRENT);
 * earlier versions folded, corrected ones named as wrong (never a result); faded ones
 * ranked with the rest, bodies shown, labeled (2026-10-10); a count header, pages, the 12,000-character room; and a
 * quote of a shown memory credited at the boundary.
 *
 * Hermetic: every test makes its own temp store and removes it.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { RECALL_RESULT_CHARS, hasFaded } from "../src/adapters/mcp/deliberate.js";
import { FACTS_PAGE_SIZE, FACTS_TAIL_SIZE, factsRecall, renderFacts } from "../src/adapters/mcp/facts.js";
import { meaningRecall, renderMeaning } from "../src/adapters/mcp/meaning.js";
import type { FactsResult } from "../src/adapters/mcp/facts.js";
import { settle } from "../src/core/reconsolidation.js";
import { Counterpart } from "../src/core/counterpart.js";
import { OPEN_END, OPEN_START, loadGateState, readTimeAsk } from "../src/core/recall/index.js";
import { paths } from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

const ZONE = "America/Los_Angeles";
/** 2026-10-03, 15:00 local. */
const NOW = Date.parse("2026-10-03T22:00:00Z");
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-facts-"));
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
  // Fixtures are memories the tests expect to find (`store-fixture.ts#findable`, 2026-10-10).
  const c = Counterpart.open({ dir: join(dir, "store"), owner: true, now: () => now, timeZone: ZONE });
  findable(c.store);
  open.push(c);
  return c;
}

function ask(c: Counterpart, question: string, opts: { page?: number; owner?: boolean } = {}): FactsResult {
  return factsRecall(
    { counterpart: c, sessionId: SESSION, owner: opts.owner ?? true, vector: null, semantic: "embedder-off" },
    question,
    opts.page === undefined ? {} : { page: opts.page },
  );
}

const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
];

function seed(c: Counterpart): void {
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
}

describe("time in a question (time-ask.ts)", () => {
  const clock = { now: NOW, zone: ZONE };

  test("weeks and months are fuzzy and stretch two days each side; a date stays exact", () => {
    const week = readTimeAsk("what did we decide last week about the gym?", clock);
    expect(week?.said).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(week?.window).toEqual({ from: "2026-09-19", to: "2026-09-29" });
    expect(week?.rest).toBe("what did we decide about the gym?");
    expect(readTimeAsk("in September what changed", clock)?.said).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(readTimeAsk("early October plans", clock)?.said).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(readTimeAsk("late August trip", clock)?.said).toEqual({ from: "2026-08-21", to: "2026-08-31" });
    const exact = readTimeAsk("what did I say on 2026-09-21", clock);
    expect(exact?.window).toEqual({ from: "2026-09-21", to: "2026-09-21" });
    expect(exact?.stretch).toBe(0);
    expect(readTimeAsk("what did Han say on September 21st", clock)?.window).toEqual({ from: "2026-09-21", to: "2026-09-21" });
    expect(readTimeAsk("09-28 gym", clock)?.rest).toBe("gym");
  });

  test("N days ago is near and stretches a day; since runs to today; this morning keeps the clock", () => {
    const ago = readTimeAsk("what happened 3 days ago", clock);
    expect(ago?.said).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(ago?.stretch).toBe(1);
    expect(readTimeAsk("since Sep 20 what moved", clock)?.window).toEqual({ from: "2026-09-20", to: "2026-10-03" });
    const morning = readTimeAsk("the deploy this morning", clock);
    expect(morning?.clock).toEqual({ from: "2026-10-03 05:00", to: "2026-10-03 11:59" });
    expect(morning?.rest).toBe("the deploy");
  });

  test("anchors are named, not resolved: an event, and the last session", () => {
    const event = readTimeAsk("around the cut-over what did we decide?", clock);
    expect(event?.anchor).toEqual({ kind: "event", phrase: "cut-over" });
    expect(event?.window).toBeNull();
    expect(event?.rest).toBe("what did we decide?");
    expect(readTimeAsk("where did we leave off?", clock)?.anchor).toEqual({ kind: "session" });
    expect(readTimeAsk("what did we do in the last session", clock)?.anchor).toEqual({ kind: "session" });
  });

  test("no time, no window: words that only look like time are left alone", () => {
    expect(readTimeAsk("lighthouse at Fernbrook Point", clock)).toBeNull();
    expect(readTimeAsk("questions around pricing", clock)).toBeNull();
    expect(readTimeAsk("around the time we moved", clock)).toBeNull();
    // Review of #323: a stretch of time is not an event to search for.
    expect(readTimeAsk("what did we do during the week", clock)?.anchor ?? null).toBeNull();
    expect(readTimeAsk("anything around the evening", clock)?.anchor ?? null).toBeNull();
  });

  // Review of #323: read as "yesterday" before.
  test("the day before yesterday is two days back, exact", () => {
    const r = readTimeAsk("what happened the day before yesterday", clock);
    expect(r?.window).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(r?.rest).toBe("what happened");
  });

  // 2026-10-09, the LongMemEval run: "last Saturday" read as no time at all.
  test("last <weekday> is the most recent one before today, exact; asked on that weekday it is a week back", () => {
    // NOW is Saturday 2026-10-03 in Los Angeles.
    const sat = readTimeAsk("what did I do last Saturday", clock);
    expect(sat?.said).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(sat?.window).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(sat?.stretch).toBe(0);
    expect(sat?.cue).toBe("last Saturday");
    expect(sat?.rest).toBe("what did I do");
    expect(readTimeAsk("last friday at the market", clock)?.window).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    expect(readTimeAsk("who came last Sunday", clock)?.window).toEqual({ from: "2026-09-27", to: "2026-09-27" });
    const past = readTimeAsk("this past Monday's meeting", clock);
    expect(past?.window).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(past?.rest).toBe("meeting");
    // Asked on Monday 10-05: Saturday is two days back, and Monday a week.
    const monday = { now: Date.parse("2026-10-05T19:00:00Z"), zone: ZONE };
    expect(readTimeAsk("last Saturday", monday)?.window).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(readTimeAsk("last Monday", monday)?.window).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    // Across a year: asked on Friday 2027-01-01.
    const newYear = { now: Date.parse("2027-01-01T19:00:00Z"), zone: ZONE };
    expect(readTimeAsk("last Saturday", newYear)?.window).toEqual({ from: "2026-12-26", to: "2026-12-26" });
    // A word in front bounds it, as it bounds a date.
    const since = readTimeAsk("what have I done since last Saturday", clock);
    expect(since?.window).toEqual({ from: "2026-09-26", to: "2026-10-03" });
    expect(since?.cue).toBe("since last Saturday");
    expect(since?.rest).toBe("what have I done");
    expect(readTimeAsk("before last Wednesday", clock)?.window).toEqual({ from: OPEN_START, to: "2026-09-29" });
    // Either could be the coming one: not read. Nor "the last Saturday" of something.
    expect(readTimeAsk("what did I do this Saturday", clock)).toBeNull();
    expect(readTimeAsk("what did I do on Saturday", clock)).toBeNull();
    expect(readTimeAsk("on the last Saturday of the season we sailed", clock)).toBeNull();
  });

  // 2026-10-09, the LongMemEval run: "before 7/22" filtered to 07-22 alone.
  test("a word in front of a date bounds it: before, after, since, until, by — in every date shape", () => {
    const shapes = ["2026-07-22", "7/22", "July 22", "7/22/2026", "22 July", "July 22nd, 2026"];
    const bounds: [string, { from: string; to: string }][] = [
      ["before", { from: OPEN_START, to: "2026-07-21" }],
      ["prior to", { from: OPEN_START, to: "2026-07-21" }],
      ["after", { from: "2026-07-23", to: OPEN_END }],
      ["since", { from: "2026-07-22", to: "2026-10-03" }],
      ["until", { from: OPEN_START, to: "2026-07-22" }],
      ["up until", { from: OPEN_START, to: "2026-07-22" }],
      ["by", { from: OPEN_START, to: "2026-07-22" }],
    ];
    for (const shape of shapes) {
      for (const [word, window] of bounds) {
        const r = readTimeAsk(`what did I buy ${word} ${shape} at the market?`, clock);
        expect({ shape, word, said: r?.said, window: r?.window, stretch: r?.stretch, rest: r?.rest }).toEqual({
          shape,
          word,
          said: window,
          window,
          stretch: 0,
          rest: "what did I buy at the market?",
        });
        expect(r?.cue).toBe(`${word} ${shape}`);
      }
      // Alone, the date is that day and no other.
      expect(readTimeAsk(`what did I buy on ${shape}?`, clock)?.window).toEqual({ from: "2026-07-22", to: "2026-07-22" });
    }
    // A month under a bound: before it starts, after it ends; "since" keeps its stretch.
    expect(readTimeAsk("before 2026-07", clock)?.window).toEqual({ from: OPEN_START, to: "2026-06-30" });
    expect(readTimeAsk("after 2026-07", clock)?.window).toEqual({ from: "2026-08-01", to: OPEN_END });
    expect(readTimeAsk("since 2026-07", clock)?.stretch).toBe(2);
  });

  test("a year written with the date is the year meant, and leaves the question", () => {
    const slash = readTimeAsk("what happened on 7/22/2025", clock);
    expect(slash?.window).toEqual({ from: "2025-07-22", to: "2025-07-22" });
    expect(slash?.rest).toBe("what happened");
    expect(readTimeAsk("before 7/22/2025", clock)?.window).toEqual({ from: OPEN_START, to: "2025-07-21" });
    expect(readTimeAsk("since July 22, 2025 what moved", clock)?.window).toEqual({ from: "2025-07-22", to: "2026-10-03" });
    expect(readTimeAsk("the 22 July 2025 trip", clock)?.window).toEqual({ from: "2025-07-22", to: "2025-07-22" });
    // Month first, as before: 3/4 is March 4th.
    expect(readTimeAsk("on 3/4", clock)?.window).toEqual({ from: "2026-03-04", to: "2026-03-04" });
  });

  test("a bound across the new year: \"before 1/5\" asked in early January reaches back into December", () => {
    // Sunday 2027-01-03 in Los Angeles.
    const jan = { now: Date.parse("2027-01-03T19:00:00Z"), zone: ZONE };
    expect(readTimeAsk("before 1/5", jan)?.window).toEqual({ from: OPEN_START, to: "2027-01-04" });
    expect(readTimeAsk("after 12/28", jan)?.window).toEqual({ from: "2026-12-29", to: OPEN_END });
    expect(readTimeAsk("since 12/28", jan)?.window).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(readTimeAsk("until Dec 30", jan)?.window).toEqual({ from: OPEN_START, to: "2026-12-30" });
    expect(readTimeAsk("before 1/2", { now: Date.parse("2027-01-10T19:00:00Z"), zone: ZONE })?.window).toEqual({ from: OPEN_START, to: "2027-01-01" });
  });

  // Review of #338: "before the 7/22 flight" cut 07-22 off, and the flight was on 07-22.
  test("a date that names a thing on that day keeps that day under a bound; a cutoff still does not", () => {
    const flight = readTimeAsk("what did I eat before the 7/22 flight", clock);
    expect(flight?.window).toEqual({ from: OPEN_START, to: "2026-07-22" });
    expect(flight?.cue).toBe("before the 7/22");
    expect(flight?.rest).toBe("what did I eat before the flight");
    expect(readTimeAsk("what came up after the July 22 meeting", clock)?.window).toEqual({ from: "2026-07-22", to: OPEN_END });
    const standup = readTimeAsk("what did Rosalind update after July 22's standup", clock);
    expect(standup?.window).toEqual({ from: "2026-07-22", to: OPEN_END });
    expect(standup?.rest).toBe("what did Rosalind update after standup");
    expect(readTimeAsk("two days before the 7/22 launch", clock)?.window).toEqual({ from: OPEN_START, to: "2026-07-22" });
    expect(readTimeAsk("who called after last Saturday's party", clock)?.window).toEqual({ from: "2026-09-26", to: OPEN_END });
    expect(readTimeAsk("after the 4th of July fireworks", clock)?.window).toEqual({ from: "2026-07-04", to: OPEN_END });
    // "since", "until", "by" already keep the day.
    expect(readTimeAsk("since the 7/22 launch", clock)?.window).toEqual({ from: "2026-07-22", to: "2026-10-03" });
    expect(readTimeAsk("by the 7/22 deadline", clock)?.window).toEqual({ from: OPEN_START, to: "2026-07-22" });
    // A cutoff: nothing after the date, punctuation, or the question going on.
    expect(readTimeAsk("who did I meet before the 4th of July", clock)?.window).toEqual({ from: OPEN_START, to: "2026-07-03" });
    expect(readTimeAsk("after the 4th of July, what did we sail", clock)?.window).toEqual({ from: "2026-07-05", to: OPEN_END });
    expect(readTimeAsk("after the 4th of July we sailed", clock)?.window).toEqual({ from: "2026-07-05", to: OPEN_END });
    expect(readTimeAsk("anything after 2026-07-22?", clock)?.window).toEqual({ from: "2026-07-23", to: OPEN_END });
  });

  // Review of #338's findings that predate it, 2026-10-09. Each is read in two
  // zones whose day differs from UTC's, at local noon on Saturday 2026-10-03.
  const zones: [string, { now: number; zone: string }][] = [
    ["America/Denver", { now: Date.parse("2026-10-03T18:00:00Z"), zone: "America/Denver" }],
    ["Pacific/Kiritimati", { now: Date.parse("2026-10-02T22:00:00Z"), zone: "Pacific/Kiritimati" }],
  ];

  test("an amount is not a date: a range with a unit after it, a price, a fraction (Denver, Kiritimati)", () => {
    for (const [, at] of zones) {
      for (const q of [
        "I usually sleep up to 7-8 hours",
        "how long, 7-8 hours or 10-12 minutes?",
        "a 2-3 week trip",
        "lost 5-10 lbs",
        "about 5-10% of the budget",
        "$5-10 a month",
        "slept 7-8.5 hours",
        "ran 3-4 km",
        "1/2 cup of sugar",
        "3/4 of the team agreed",
      ]) {
        expect({ q, ask: readTimeAsk(q, at) }).toEqual({ q, ask: null });
      }
      // A date after an amount is still read, and the amount stays in the question.
      const after = readTimeAsk("slept 7-8 hours before 9/21", at);
      expect(after?.window).toEqual({ from: OPEN_START, to: "2026-09-20" });
      expect(after?.rest).toBe("slept 7-8 hours");
      // An ordinary word after a date leaves it a date.
      expect(readTimeAsk("what happened on 7/8 at the lake", at)?.window).toEqual({ from: "2026-07-08", to: "2026-07-08" });
      expect(readTimeAsk("09-28 gym", at)?.window).toEqual({ from: "2026-09-28", to: "2026-09-28" });
      // A leading zero is a date, whatever follows it (review of #345).
      const minutes = readTimeAsk("what did the 09-28 minutes say", at);
      expect(minutes?.window).toEqual({ from: "2026-09-28", to: "2026-09-28" });
      expect(minutes?.rest).toBe("what did the minutes say");
      expect(readTimeAsk("7/08 hours", at)?.window).toEqual({ from: "2026-07-08", to: "2026-07-08" });
      // With a comma the date stands; without one a unit after it is an amount (no window, which hides nothing).
      expect(readTimeAsk("on 5/6, days later we shipped", at)?.window).toEqual({ from: "2026-05-06", to: "2026-05-06" });
      expect(readTimeAsk("what happened 7/8 hours before the launch", at)).toBeNull();
    }
  });

  test("a range of days or weeks ago covers both ends, not the far one alone (review of #345; Denver, Kiritimati)", () => {
    for (const [, at] of zones) {
      // Asked on Saturday 10-03: two weeks back is 09-14..09-20, three weeks back 09-07..09-13.
      for (const q of ["what happened 2-3 weeks ago", "2/3 weeks ago", "two or three weeks ago", "2 to 3 weeks ago"]) {
        const a = readTimeAsk(q, at);
        expect({ q, said: a?.said, stretch: a?.stretch }).toEqual({ q, said: { from: "2026-09-07", to: "2026-09-20" }, stretch: 2 });
      }
      expect(readTimeAsk("what happened 2-3 weeks ago", at)?.rest).toBe("what happened");
      for (const q of ["what happened 3-4 days ago", "notes from 3/4 days ago", "3 or 4 days ago", "three or four days ago"]) {
        const a = readTimeAsk(q, at);
        expect({ q, said: a?.said, stretch: a?.stretch }).toEqual({ q, said: { from: "2026-09-29", to: "2026-09-30" }, stretch: 1 });
      }
      expect(readTimeAsk("notes from 3/4 days ago", at)?.rest).toBe("notes");
      // One count alone, as before.
      expect(readTimeAsk("3 weeks ago", at)?.said).toEqual({ from: "2026-09-07", to: "2026-09-13" });
      expect(readTimeAsk("4 days ago", at)?.said).toEqual({ from: "2026-09-29", to: "2026-09-29" });
      expect(readTimeAsk("a few days ago", at)?.said).toEqual({ from: "2026-09-28", to: "2026-10-01" });
    }
  });

  test("\"by 1/2\" is a fraction after a word of quantity, else January 2 (Denver, Kiritimati)", () => {
    for (const [, at] of zones) {
      for (const q of ["cut it by 1/2", "we reduced the dose by 1/2", "how much did prices drop by 1/3", "grew to 3/4", "reduced the dose to 1/3"]) {
        expect({ q, ask: readTimeAsk(q, at) }).toEqual({ q, ask: null });
      }
      // January 2, a date. Asked on 10-03, the coming one (91 days ahead) is
      // nearer than the last (274 back), so "by" reads through next year's
      // (2026-10-10, the year-end mirror; it read this year's before).
      const finish = readTimeAsk("what do I have to finish by 1/2", at);
      expect(finish?.window).toEqual({ from: OPEN_START, to: "2027-01-02" });
      expect(finish?.cue).toBe("by 1/2");
      expect(readTimeAsk("what happened on 1/2", at)?.window).toEqual({ from: "2026-01-02", to: "2026-01-02" });
      // Not a common fraction (over 10 below it), so a deadline: "cut costs by
      // 3/15" — next March's, 163 days ahead against 202 back.
      expect(readTimeAsk("cut costs by 3/15", at)?.window).toEqual({ from: OPEN_START, to: "2027-03-15" });
      // "By" as part of a verb still reads as through (review of #338, item 5).
      expect(readTimeAsk("drop by 7/22", at)?.window).toEqual({ from: OPEN_START, to: "2026-07-22" });
    }
  });

  test("since / after a day that has not come yet this year is last year's; before, until, by and the day alone are not moved (Denver, Kiritimati)", () => {
    for (const [, at] of zones) {
      const since = readTimeAsk("what changed since 10/25", at);
      expect(since?.said).toEqual({ from: "2025-10-25", to: "2026-10-03" });
      expect(since?.cue).toBe("since 10/25");
      expect(since?.rest).toBe("what changed");
      expect(readTimeAsk("since Oct 25", at)?.said).toEqual({ from: "2025-10-25", to: "2026-10-03" });
      expect(readTimeAsk("since the 25th of October", at)?.said).toEqual({ from: "2025-10-25", to: "2026-10-03" });
      expect(readTimeAsk("after 10/25", at)?.window).toEqual({ from: "2025-10-26", to: OPEN_END });
      // The date names a thing on that day: the same year, the day kept.
      expect(readTimeAsk("who called after the 10/25 launch", at)?.window).toEqual({ from: "2025-10-25", to: OPEN_END });
      expect(readTimeAsk("since the 10/25 launch", at)?.said).toEqual({ from: "2025-10-25", to: "2026-10-03" });
      // A future cutoff hides nothing that has happened: this year's, as before.
      expect(readTimeAsk("before 10/25", at)?.window).toEqual({ from: OPEN_START, to: "2026-10-24" });
      expect(readTimeAsk("before the 10/25 flight", at)?.window).toEqual({ from: OPEN_START, to: "2026-10-25" });
      expect(readTimeAsk("by 10/25", at)?.window).toEqual({ from: OPEN_START, to: "2026-10-25" });
      expect(readTimeAsk("on 10/25", at)?.window).toEqual({ from: "2026-10-25", to: "2026-10-25" });
      // Today has come; a written year is the year meant.
      expect(readTimeAsk("since 10/3", at)?.said).toEqual({ from: "2026-10-03", to: "2026-10-03" });
      expect(readTimeAsk("since 10/25/2026", at)?.said).toEqual({ from: "2026-10-25", to: "2026-10-03" });
      expect(readTimeAsk("after 2026-10-25", at)?.window).toEqual({ from: "2026-10-26", to: OPEN_END });
    }
    // On the person's own day: 04:00 UTC on 10-04 is still 10-03 in Denver, already 10-04 on Kiritimati.
    const edge = Date.parse("2026-10-04T04:00:00Z");
    expect(readTimeAsk("since 10/4", { now: edge, zone: "America/Denver" })?.said).toEqual({ from: "2025-10-04", to: "2026-10-03" });
    expect(readTimeAsk("since 10/4", { now: edge, zone: "Pacific/Kiritimati" })?.said).toEqual({ from: "2026-10-04", to: "2026-10-04" });
    expect(readTimeAsk("after 10/4", { now: edge, zone: "America/Denver" })?.window).toEqual({ from: "2025-10-05", to: OPEN_END });
    expect(readTimeAsk("after 10/4", { now: edge, zone: "Pacific/Kiritimati" })?.window).toEqual({ from: "2026-10-05", to: OPEN_END });
    // Feb 29 not yet come in a leap year: the last Feb 29 there was.
    const leap = { now: Date.parse("2028-02-10T19:00:00Z"), zone: "America/Denver" };
    expect(readTimeAsk("since 2/29", leap)?.said).toEqual({ from: "2024-02-29", to: "2028-02-10" });
  });

  // Review of #345: "by 12/20" asked in October was last year's 12/20, through
  // 2025-12-20, which hid the ten months since.
  test("by / until / before a month not yet begun is this year's, not last year's; since and after still reach back (Denver, Kiritimati)", () => {
    const october: [string, { now: number; zone: string }][] = [
      ["America/Denver", { now: Date.parse("2026-10-09T18:00:00Z"), zone: "America/Denver" }],
      ["Pacific/Kiritimati", { now: Date.parse("2026-10-08T22:00:00Z"), zone: "Pacific/Kiritimati" }],
    ];
    for (const [zone, at] of october) {
      const due = readTimeAsk("what's due by 12/20", at);
      expect({ zone, window: due?.window, cue: due?.cue, rest: due?.rest }).toEqual({
        zone,
        window: { from: OPEN_START, to: "2026-12-20" },
        cue: "by 12/20",
        rest: "what's due",
      });
      expect(readTimeAsk("before 12/20", at)?.window).toEqual({ from: OPEN_START, to: "2026-12-19" });
      expect(readTimeAsk("until Dec 20", at)?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
      expect(readTimeAsk("up to the 20th of December", at)?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
      expect(readTimeAsk("prior to 11/2", at)?.window).toEqual({ from: OPEN_START, to: "2026-11-01" });
      // The date names a thing on its day: this year's, the day kept.
      expect(readTimeAsk("what did I eat before the 12/20 flight", at)?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
      // Unchanged: since and after reach back to the last 12/20 there was; a
      // date alone keeps `yearFor`'s year; a written year is the year meant; a
      // month already begun and nearest this year stays this year's.
      expect(readTimeAsk("since 12/20", at)?.said).toEqual({ from: "2025-12-20", to: "2026-10-09" });
      expect(readTimeAsk("after 12/20", at)?.window).toEqual({ from: "2025-12-21", to: OPEN_END });
      expect(readTimeAsk("on 12/20", at)?.window).toEqual({ from: "2025-12-20", to: "2025-12-20" });
      expect(readTimeAsk("by 12/20/2025", at)?.window).toEqual({ from: OPEN_START, to: "2025-12-20" });
      expect(readTimeAsk("before 9/30", at)?.window).toEqual({ from: OPEN_START, to: "2026-09-29" });
      // The year-end mirror (2026-10-10): the coming 1/5 (88 days ahead) is
      // nearer than the last (277 back). It read this year's 01-05 before.
      expect(readTimeAsk("by 1/5", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
    }
    // On the person's own day: 04:00 UTC on 12-01 is still 11-30 in Denver
    // (December not begun) and already 12-01 on Kiritimati. Both read this
    // year's 12/20 — before, Denver read last year's.
    const edge = Date.parse("2026-12-01T04:00:00Z");
    expect(readTimeAsk("by 12/20", { now: edge, zone: "America/Denver" })?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
    expect(readTimeAsk("by 12/20", { now: edge, zone: "Pacific/Kiritimati" })?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
    // The nearer of the two: asked on 05-01, last year's 12/20 (132 days back)
    // is nearer than this year's (233 ahead), as before; on Jan 3, "until Dec
    // 30" is the one four days back (the new-year test above).
    const may = { now: Date.parse("2026-05-01T18:00:00Z"), zone: "America/Denver" };
    expect(readTimeAsk("by 12/20", may)?.window).toEqual({ from: OPEN_START, to: "2025-12-20" });
    // A Feb 29 this year lacks keeps the year it had (2028's, asked in 2029).
    const leap = { now: Date.parse("2029-01-10T19:00:00Z"), zone: "America/Denver" };
    expect(readTimeAsk("by 2/29", leap)?.window).toEqual({ from: OPEN_START, to: "2028-02-29" });
  });

  // The year-end mirror #352 left undone: "by 1/5" asked on 12-28 was through
  // this year's 01-05, 357 days back, which hid the whole year since.
  test("by / until / before at the year's end reach the coming January, the nearer year; since, after and a date alone still reach back (Denver, Kiritimati)", () => {
    const december: [string, { now: number; zone: string }][] = [
      ["America/Denver", { now: Date.parse("2026-12-28T18:00:00Z"), zone: "America/Denver" }],
      ["Pacific/Kiritimati", { now: Date.parse("2026-12-27T22:00:00Z"), zone: "Pacific/Kiritimati" }],
    ];
    for (const [zone, at] of december) {
      const due = readTimeAsk("what's due by 1/5", at);
      expect({ zone, window: due?.window, cue: due?.cue, rest: due?.rest }).toEqual({
        zone,
        window: { from: OPEN_START, to: "2027-01-05" },
        cue: "by 1/5",
        rest: "what's due",
      });
      expect(readTimeAsk("before 1/5", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-04" });
      expect(readTimeAsk("until Jan 5", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
      expect(readTimeAsk("up to the 5th of January", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
      expect(readTimeAsk("prior to 2/1", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-31" });
      // The date names a thing on its day: the coming one, the day kept.
      expect(readTimeAsk("what do I pack before the 1/5 flight", at)?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
      // A day just past is nearer than next year's: kept.
      expect(readTimeAsk("by 12/20", at)?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
      // Unchanged: since and after reach back to the last 1/5 there was; a date
      // alone keeps `yearFor`'s year; a written year is the year meant.
      expect(readTimeAsk("since 1/5", at)?.said).toEqual({ from: "2026-01-05", to: "2026-12-28" });
      expect(readTimeAsk("after 1/5", at)?.window).toEqual({ from: "2026-01-06", to: OPEN_END });
      expect(readTimeAsk("on 1/5", at)?.window).toEqual({ from: "2026-01-05", to: "2026-01-05" });
      expect(readTimeAsk("by 1/5/2026", at)?.window).toEqual({ from: OPEN_START, to: "2026-01-05" });
    }
    // On the person's own day: 04:00 UTC on 2027-01-01 is still 12-31 in
    // Denver and already 01-01 on Kiritimati. Both read the 01-05 four or five
    // days ahead — before, Denver read the one 360 days back.
    const edge = Date.parse("2027-01-01T04:00:00Z");
    expect(readTimeAsk("by 1/5", { now: edge, zone: "America/Denver" })?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
    expect(readTimeAsk("by 1/5", { now: edge, zone: "Pacific/Kiritimati" })?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
    // Midyear, the nearer decides: on 07-01 last January's 1/5 is 177 days back
    // against 188 ahead; on 07-10, 186 back against 179 ahead.
    expect(readTimeAsk("by 1/5", { now: Date.parse("2026-07-01T18:00:00Z"), zone: "America/Denver" })?.window).toEqual({ from: OPEN_START, to: "2026-01-05" });
    expect(readTimeAsk("by 1/5", { now: Date.parse("2026-07-10T18:00:00Z"), zone: "America/Denver" })?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
  });

  test("the event-day rule of #338 holds in both zones: \"before the 7/22 flight\" keeps 07-22, \"before 7/22\" does not", () => {
    for (const [, at] of zones) {
      const flight = readTimeAsk("what did I eat before the 7/22 flight", at);
      expect(flight?.window).toEqual({ from: OPEN_START, to: "2026-07-22" });
      expect(flight?.cue).toBe("before the 7/22");
      expect(flight?.rest).toBe("what did I eat before the flight");
      expect(readTimeAsk("what came up after the July 22 meeting", at)?.window).toEqual({ from: "2026-07-22", to: OPEN_END });
      expect(readTimeAsk("what did I eat before 7/22", at)?.window).toEqual({ from: OPEN_START, to: "2026-07-21" });
      expect(readTimeAsk("after the 4th of July we sailed", at)?.window).toEqual({ from: "2026-07-05", to: OPEN_END });
    }
  });

  test("\"last Saturday\" is read on the person's own day, not UTC's (Denver, Kiritimati)", () => {
    // Saturday 22:00 in Denver is Sunday in UTC; Sunday 01:00 on Kiritimati is Saturday in UTC.
    const denverSat = { now: Date.parse("2026-10-04T04:00:00Z"), zone: "America/Denver" };
    expect(readTimeAsk("last Saturday", denverSat)?.window).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    const denverSun = { now: Date.parse("2026-10-05T04:00:00Z"), zone: "America/Denver" };
    expect(readTimeAsk("last Saturday", denverSun)?.window).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    const kiriSat = { now: Date.parse("2026-10-02T10:30:00Z"), zone: "Pacific/Kiritimati" };
    expect(readTimeAsk("last Saturday", kiriSat)?.window).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    const kiriSun = { now: Date.parse("2026-10-03T11:00:00Z"), zone: "Pacific/Kiritimati" };
    expect(readTimeAsk("last Saturday", kiriSun)?.window).toEqual({ from: "2026-10-03", to: "2026-10-03" });
  });

  test("\"in the last month\" and \"the past N months\" roll back from today; plain \"last month\" stays the calendar month", () => {
    const may30 = { now: Date.parse("2023-05-30T19:00:00Z"), zone: "America/Los_Angeles" };
    const rolling = { from: "2023-04-30", to: "2023-05-30" };
    for (const q of [
      "How many plants did I acquire in the last month?",
      "what did I buy in the past month",
      "the past month at the gym",
      "over the last month what changed",
      "within the last month did I call her",
      "during the last month",
      "past month spending",
    ]) {
      const a = readTimeAsk(q, may30);
      expect({ q, said: a?.said, window: a?.window, stretch: a?.stretch }).toEqual({ q, said: rolling, window: rolling, stretch: 0 });
    }
    expect(readTimeAsk("How many plants did I acquire in the last month", may30)?.rest).toBe("How many plants did I acquire");
    expect(readTimeAsk("within the last month did I call her", may30)?.rest).toBe("did I call her");
    const calendar = readTimeAsk("what did I buy last month?", may30);
    expect(calendar?.said).toEqual({ from: "2023-04-01", to: "2023-04-30" });
    expect(calendar?.stretch).toBe(2);
    // "the last month of <x>" names a month, not a stretch back from today.
    expect(readTimeAsk("during the last month of the season", may30)?.stretch).toBe(2);
    for (const [q, from] of [
      ["the last two months", "2023-03-30"],
      ["in the last four months what did I read", "2023-01-30"],
      ["past 3 months", "2023-02-28"],
      ["last 6 months of runs", "2022-11-30"],
      ["over the past twelve months", "2022-05-30"],
      ["in the last couple of months", "2023-03-30"],
      ["past couple of months", "2023-03-30"],
    ] as const) {
      const a = readTimeAsk(q, may30);
      expect({ q, said: a?.said, stretch: a?.stretch }).toEqual({ q, said: { from, to: "2023-05-30" }, stretch: 0 });
    }
    // Month end: a month back from 03-31 is the last day February has.
    const mar31 = { now: Date.parse("2023-03-31T19:00:00Z"), zone: "America/Los_Angeles" };
    expect(readTimeAsk("the past month", mar31)?.said).toEqual({ from: "2023-02-28", to: "2023-03-31" });
    const leap = { now: Date.parse("2024-03-31T19:00:00Z"), zone: "America/Los_Angeles" };
    expect(readTimeAsk("the past month", leap)?.said).toEqual({ from: "2024-02-29", to: "2024-03-31" });
    const jan15 = { now: Date.parse("2024-01-15T19:00:00Z"), zone: "America/Los_Angeles" };
    expect(readTimeAsk("in the last month", jan15)?.said).toEqual({ from: "2023-12-15", to: "2024-01-15" });
  });
});

describe("the pool is every match, and the header counts it", () => {
  test("thirty memories a word reaches: thirty match, ten a page, stable across pages", () => {
    const c = brain();
    seed(c);
    const ids = new Set<string>();
    // Thirty different facts (alike ones would fold as near-duplicates).
    const towns = ["Leeds", "Hull", "York", "Bath", "Ely", "Wells", "Ripon", "Derby", "Truro", "Exeter"];
    const things = ["by van", "by rail", "by courier"];
    for (const town of towns) {
      for (const how of things) {
        ids.add(c.store.put({ type: "memory", kind: "fact", body: `A zqwidget order went to ${town} ${how}, packed in ${town.length + how.length} boxes.` }));
      }
    }
    const p1 = ask(c, "the zqwidget batches");
    expect(p1.matched).toBe(30);
    expect(p1.memories.length).toBe(FACTS_PAGE_SIZE);
    expect(p1.pages).toBe(3);
    expect(renderFacts(p1).split("\n")[0]).toBe("30 match · showing 10 · 20 more → page 2");
    const p2 = ask(c, "the zqwidget batches", { page: 2 });
    const p3 = ask(c, "the zqwidget batches", { page: 3 });
    expect(renderFacts(p3).split("\n")[0]).toBe("30 match · page 3 · showing 21–30");
    const all = [...p1.memories, ...p2.memories, ...p3.memories].map((m) => m.id);
    expect(new Set(all).size).toBe(30);
    expect(new Set(all)).toEqual(ids);
    // The same page twice is the same page.
    expect(ask(c, "the zqwidget batches", { page: 2 }).memories.map((m) => m.id)).toEqual(p2.memories.map((m) => m.id));
  });

  test("a memory matched more ways ranks first: words and a subject beat words alone", () => {
    const c = brain();
    seed(c);
    const card = c.schemas.mention({ name: "Zorabel", kind: "person", source: "Zorabel", chunkRef: "card-z", aliases: [], day: c.store.livedDay() });
    expect(card.ok).toBe(true);
    const wordsOnly = c.store.put({ type: "memory", kind: "fact", body: "The quarterly zqreport needs a second reviewer." });
    const both = c.store.put({ type: "memory", kind: "fact", body: "Zorabel wrote the quarterly zqreport summary." });
    const r = ask(c, "what did Zorabel say about the zqreport?");
    expect(r.subjects.map((s) => s.name)).toEqual(["Zorabel"]);
    expect(r.memories[0]?.id).toBe(both);
    expect(r.memories[0]?.ways).toEqual(["words", "subject"]);
    expect(r.memories.map((m) => m.id)).toContain(wordsOnly);
  });

  test("nothing matched is an answer, and says what to try", () => {
    const c = brain();
    seed(c);
    const r = ask(c, "xylophone quokka");
    expect(r.reason).toBe("nothing-came");
    expect(renderFacts(r)).toContain("Nothing matched.");
  });

  // 2026-10-19 (bench 2788b940): "how many" counted "many" as a content word.
  test("a count or habit's own words ask nothing: many, much, often, typical(ly), usually", () => {
    const c = brain();
    seed(c);
    const zq = c.store.put({ type: "memory", kind: "fact", body: "Takes zqdance classes on Tuesdays and Thursdays." });
    const noise = [
      "Many visitors came to the lighthouse.",
      "Too much rain fell in the valley.",
      "The ferry is often late in winter.",
      "A typical harbour has two breakwaters.",
      "The baker typically opens at six.",
      "The tram usually runs on time.",
    ].map((body) => c.store.put({ type: "memory", kind: "fact", body }));
    const r = ask(c, "How many zqdance classes do I usually take, how much and how often, in a typical week, typically?");
    expect(r.memories.map((m) => m.id)).toEqual([zq]);
    for (const id of noise) expect(r.memories.map((m) => m.id)).not.toContain(id);
  });
});

describe("each fact's labeled lines", () => {
  test("who said it, what kind, when it happened, when and where it was learned, CURRENT", () => {
    const c = brain();
    seed(c);
    c.store.put({
      type: "memory",
      kind: "fact",
      title: "Gym moved to 6am",
      body: "Mike moved his zqgym time to 6am.",
      saidBy: "owner",
      status: "done",
      occurredOn: "2026-09-28",
      origin: { session: SESSION, scope: "/scope/one" },
    });
    c.store.put({ type: "memory", kind: "fact", body: "The zqgym closes on public holidays." });
    const text = renderFacts(ask(c, "zqgym"));
    expect(text).toContain("you said · done · happened Mon 09-28");
    expect(text).toMatch(/learned 10-03 in \/scope\/one · this session · CURRENT/);
    // Unknown fields say so: most rows predate v12.
    expect(text).toContain("speaker unknown · status unknown · no event date");
  });

  test("a planned thing is FOR its date, not happened on it", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "The zqdentist visit is booked.", saidBy: "self", status: "planned", occurredOn: "2026-10-20" });
    expect(renderFacts(ask(c, "zqdentist"))).toContain("I said · planned · for Tue 10-20");
  });

  test("an event date carries its weekday, a range on both ends; the learned date does not", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "The zqtrip to the coast.", status: "done", occurredOn: "2026-09-14..2026-09-16" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqclinic visit last winter.", status: "done", occurredOn: "2025-12-31" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqmonth review.", status: "done", occurredOn: "2026-09" });
    const trip = renderFacts(ask(c, "zqtrip"));
    expect(trip).toContain("happened Mon 09-14..Wed 09-16");
    expect(trip).toMatch(/\n {3}learned 10-03 /);
    expect(renderFacts(ask(c, "zqclinic"))).toContain("happened Wed 2025-12-31");
    expect(renderFacts(ask(c, "zqmonth"))).toContain("happened 2026-09\n");
  });
});

describe("current first: earlier versions fold, corrected ones are named as wrong, never results", () => {
  test("a changed pair: the old one folds under the new, even when only the old one matched", () => {
    const c = brain();
    seed(c);
    const old = c.store.put({ type: "memory", kind: "fact", title: "Gym at 7", body: "The zqswim session is at 7am." });
    const now = c.store.put({ type: "memory", kind: "fact", title: "Gym moved", body: "Moved to 6am from next week." });
    expect(settle(c.store, { holds: now, over: old, how: "changed", why: "the time changed", actor: "session" }).ok).toBe(true);
    const r = ask(c, "zqswim");
    expect(r.matched).toBe(1);
    expect(r.memories[0]?.id).toBe(now);
    expect(r.memories[0]?.earlier.map((e) => e.id)).toEqual([old]);
    const text = renderFacts(r);
    expect(text).toContain(`earlier: "Gym at 7"`);
    expect(text).toContain("CURRENT");
  });

  test("a corrected version is out of the answer and named, as wrong, on the one that holds", () => {
    const c = brain();
    seed(c);
    const wrong = c.store.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 4." });
    const right = c.store.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 9." });
    expect(settle(c.store, { holds: right, over: wrong, how: "corrected", why: "it was pier 9", actor: "session" }).ok).toBe(true);
    const r = ask(c, "zqboat pier");
    expect(r.memories.map((m) => m.id)).toEqual([right]);
    expect(r.memories[0]?.corrected).toBe(1);
    expect(r.memories[0]?.correctedShown).toEqual([{ text: "The zqboat is moored at pier 4.", learned: "2026-10-03", corrected: "2026-10-03", id: wrong }]);
    const text = renderFacts(r);
    expect(text).toContain(`   corrected (was wrong): "The zqboat is moored at pier 4." (learned 10-03), corrected 10-03 · ${wrong}\n`);
    expect(text).not.toContain("hidden");
  });

  test("an in-place revision shows its earlier words, dated", () => {
    const c = brain();
    seed(c);
    const id = c.store.put({ type: "memory", kind: "fact", body: "The zqkite string is red." });
    c.store.revise(id, { body: "The zqkite string is blue now." });
    const r = ask(c, "zqkite");
    expect(r.memories[0]?.earlier[0]?.text).toBe("The zqkite string is red.");
    expect(r.memories[0]?.earlier[0]?.id).toBeUndefined();
  });

  test("an open pair says who each disagrees with", () => {
    const c = brain();
    seed(c);
    const a = c.store.put({ type: "memory", kind: "fact", body: "The zqcafe opens at eight." });
    const b = c.store.put({ type: "memory", kind: "fact", body: "The zqcafe opens at nine." });
    expect(settle(c.store, { holds: a, over: b, how: "open", why: "unsure", actor: "session" }).ok).toBe(true);
    const text = renderFacts(ask(c, "zqcafe"));
    expect(text).toContain(`disagrees with ${b}`);
    expect(text).toContain(`disagrees with ${a}`);
  });

  // Review of #323: a pair line named its other side whatever it was.
  test("a pair line never names a confidential memory to a non-owner", () => {
    const c = brain();
    seed(c);
    const a = c.store.put({ type: "memory", kind: "fact", body: "The zqdentist is on Elm Street." });
    const secret = c.store.put({ type: "memory", kind: "fact", body: "The zqdentist moved to the clinic.", meta: { confidential: true } });
    expect(settle(c.store, { holds: a, over: secret, how: "open", why: "unsure", actor: "session" }).ok).toBe(true);
    const old = c.store.put({ type: "memory", kind: "fact", body: "The zqpharmacy closes at six." });
    const secretNow = c.store.put({ type: "memory", kind: "fact", body: "The zqpharmacy hours changed.", meta: { confidential: true } });
    expect(settle(c.store, { holds: secretNow, over: old, how: "changed", why: "moved", actor: "session" }).ok).toBe(true);
    const guest = renderFacts(ask(c, "zqdentist zqpharmacy", { owner: false }));
    expect(guest).not.toContain(secret);
    expect(guest).not.toContain(secretNow);
    expect(guest).toContain("earlier — now a later version");
    const owner = renderFacts(ask(c, "zqdentist zqpharmacy"));
    expect(owner).toContain(`disagrees with ${secret}`);
  });
});

describe("an earlier version shown on its own names the END of its chain (review of #408)", () => {
  test("A→B→C with B hidden from this asker: A reads now C, the memory standing and the neighbours name", () => {
    const c = brain();
    seed(c);
    const a = c.store.put({ type: "memory", kind: "fact", body: "The zqferry leaves at nine." });
    const b = c.store.put({ type: "memory", kind: "fact", body: "The zqferry timetable changed.", meta: { confidential: true } });
    const z = c.store.put({ type: "memory", kind: "fact", body: "The ferry now leaves at half past ten." });
    expect(settle(c.store, { holds: b, over: a, how: "changed", why: "moved", actor: "session" }).ok).toBe(true);
    expect(settle(c.store, { holds: z, over: b, how: "changed", why: "moved again", actor: "session" }).ok).toBe(true);
    // A guest cannot see B, so A cannot fold under it and is shown on its own.
    const r = ask(c, "zqferry", { owner: false });
    const shownA = r.memories.find((m) => m.id === a);
    expect(shownA?.current).toBe(false);
    // Before: its immediate holder, which this asker may not be told of ("a later version").
    expect(shownA?.now).toBe(z);
    const text = renderFacts(r);
    expect(text).toContain(`earlier — now ${z}`);
    expect(text).not.toContain(b);
  });
});

describe("time filters", () => {
  test("only the window comes back; the matches outside it are counted; learned date stands in for a missing event date", () => {
    const c = brain();
    seed(c);
    const inside = c.store.put({ type: "memory", kind: "fact", body: "Decided the zqroof repair.", occurredOn: "2026-09-24" });
    c.store.put({ type: "memory", kind: "fact", body: "Priced the zqroof tiles.", occurredOn: "2026-08-02" });
    const learned = c.store.put({ type: "memory", kind: "fact", body: "Called the zqroof contractor." });
    // Last week from Saturday 10-03 is 09-21..09-27, stretched to 09-19..09-29.
    const r = ask(c, "what about the zqroof last week?");
    expect(r.memories.map((m) => m.id)).toEqual([inside]);
    expect(r.time?.outside).toBe(2);
    const text = renderFacts(r);
    expect(text).toContain("time: last week → 09-21..09-27, stretched 2 days each side · 2 more match outside it");
    // Learned today: inside "this week", by its learned date, and the line says so.
    const week = ask(c, "zqroof this week");
    expect(week.memories.map((m) => m.id)).toEqual([learned]);
    expect(renderFacts(week)).toContain("(in the window by this date)");
  });

  // Bench 3a704032 (2026-10-18): a month-only date that straddles a day window is kept, and says it may be inside.
  test("a coarser event date only partly inside the window is labeled; one wholly inside or a day is not", () => {
    const c = brain();
    seed(c);
    // "in the last month" from Saturday 10-03 is the rolling 09-03..10-03.
    c.store.put({ type: "memory", kind: "fact", body: "Got the zqplant from my sister.", status: "done", occurredOn: "2026-08" });
    c.store.put({ type: "memory", kind: "fact", body: "Bought the zqplant pot.", status: "done", occurredOn: "2026-09" });
    c.store.put({ type: "memory", kind: "fact", body: "Repotted the zqplant.", status: "done", occurredOn: "2026-09-20" });
    const text = renderFacts(ask(c, "zqplant in the last month"));
    expect(text).toContain("happened 2026-09 · may be inside the time asked\n");
    expect(text).toContain("happened Sun 09-20\n");
    expect(text).not.toContain("2026-08");
    // "last month" (09-01..09-30) is stretched 2 days each side for the filter; August touches it only there (review of #516).
    const stretched = renderFacts(ask(c, "zqplant last month"));
    expect(stretched).toContain("time: last month → 09-01..09-30, stretched 2 days each side");
    expect(stretched).not.toContain("may be inside the time asked");
    const wide = renderFacts(ask(c, "zqplant in 2026"));
    expect(wide).toContain("happened 2026-09\n");
    expect(wide).not.toContain("may be inside the time asked");
  });

  // Review of #323: the count was taken before the folds and the weak tail.
  test("the outside count is distinct facts and not weak: a chapter and its copy are one, a passing mention none", () => {
    const c = brain();
    seed(c);
    const inside = c.store.put({ type: "memory", kind: "fact", body: "Zqkiln zqglaze zqbisque zqcone firing went well.", occurredOn: "2026-09-24" });
    // Outside the window: a chapter and the memory made from it (one fact) ...
    c.episodeAsk("s-kiln", { turns: 12, bytes: 9_000 });
    const chapter = c.appendEpisode("s-kiln", "Fired the zqkiln with the new zqglaze, zqbisque and zqcone for the first time.", { title: "The zqkiln day" });
    expect(c.ingestEpisode({ sessionId: "s-kiln" }).ingested).toBe(true);
    expect(chapter.episodeId).not.toBeNull();
    // ... and six weak passing mentions, outside too.
    for (let i = 0; i < 6; i++) c.store.put({ type: "memory", kind: "fact", body: `In passing, a zqcone note number ${String(i)} about nothing much at all, with many other words to thin it out.`, occurredOn: "2026-08-02" });
    const r = ask(c, "zqkiln zqglaze zqbisque zqcone last week");
    expect(r.memories.map((m) => m.id)).toEqual([inside]);
    // The chapter (with its copy folded in) is the one fact outside worth saying.
    expect(r.time?.outside).toBe(1);
  });

  test("\"before\" keeps every day before the date and \"after\" every day after, by event date or learned date; the header names the cutoff", () => {
    const c = brain();
    seed(c);
    const early = c.store.put({ type: "memory", kind: "fact", body: "Bought the zqtent in spring.", occurredOn: "2026-04-11" });
    const day = c.store.put({ type: "memory", kind: "fact", body: "Pitched the zqtent by the lake.", occurredOn: "2026-07-22" });
    const later = c.store.put({ type: "memory", kind: "fact", body: "Patched the zqtent seam.", occurredOn: "2026-08" });
    // No event date: learned today (10-03), so after the cutoff by its learned date.
    const learned = c.store.put({ type: "memory", kind: "fact", body: "Lent the zqtent to Han." });
    const before = ask(c, "what about the zqtent before 7/22?");
    expect(before.memories.map((m) => m.id)).toEqual([early]);
    expect(before.time?.outside).toBe(3);
    expect(renderFacts(before)).toContain("time: before 7/22 → through 07-21 · 3 more match outside it");
    const after = ask(c, "zqtent after July 22");
    expect(new Set(after.memories.map((m) => m.id))).toEqual(new Set([later, learned]));
    expect(renderFacts(after)).toContain("time: after July 22 → 07-23 onward · 2 more match outside it");
    const by = ask(c, "zqtent by 2026-07-22");
    expect(new Set(by.memories.map((m) => m.id))).toEqual(new Set([early, day]));
    // A question that is only a cutoff answers with everything on its side.
    const only = ask(c, "what happened before 7/22/2026?");
    expect(only.memories.map((m) => m.id)).toContain(early);
    expect(only.memories.map((m) => m.id)).not.toContain(learned);
    // The date names the thing asked about (review of #338): its day stays in.
    const pitch = ask(c, "zqtent before the 7/22 pitch");
    expect(pitch.memories.map((m) => m.id)).toEqual(expect.arrayContaining([early, day]));
    expect(renderFacts(pitch)).toContain("time: before the 7/22 → through 07-22");
  });

  // Review of #338's findings that predate it, 2026-10-09.
  test("an amount filters nothing, and \"since\" a day not yet come this year reaches back to last year's", () => {
    const c = brain();
    seed(c);
    const cut = c.store.put({ type: "memory", kind: "fact", body: "Cut the zqbudget by half for the autumn.", occurredOn: "2026-09-15" });
    // "By 1/2" read as January 2 would have kept only the days through 01-02.
    const half = ask(c, "did we cut the zqbudget by 1/2?");
    expect(half.time).toBeNull();
    expect(half.memories.map((m) => m.id)).toEqual([cut]);
    expect(renderFacts(half)).not.toContain("time:");
    const sleep = c.store.put({ type: "memory", kind: "fact", body: "Needs zqsleep of a full night before a race.", occurredOn: "2026-09-20" });
    expect(ask(c, "how much zqsleep, 7-8 hours?").memories.map((m) => m.id)).toEqual([sleep]);
    // Asked on 10-03: this year's 10/25 has not come, so "since 10/25" is last year's.
    const moved = c.store.put({ type: "memory", kind: "fact", body: "Moved the zqboat to the marina.", occurredOn: "2025-11-02" });
    const sold = c.store.put({ type: "memory", kind: "fact", body: "Sold the old zqboat trailer.", occurredOn: "2026-09-01" });
    c.store.put({ type: "memory", kind: "fact", body: "Bought the zqboat.", occurredOn: "2025-10-01" });
    const since = ask(c, "zqboat since 10/25");
    expect(new Set(since.memories.map((m) => m.id))).toEqual(new Set([moved, sold]));
    expect(since.time?.outside).toBe(1);
    expect(renderFacts(since)).toContain("time: since 10/25 → 2025-10-25..10-03 · 1 more match outside it");
  });

  // Review of #345: through last year's 12/20 hid everything since it.
  test("\"by 12/20\" asked in October keeps the months since last December", () => {
    const c = brain();
    seed(c);
    const spring = c.store.put({ type: "memory", kind: "fact", body: "Patched the zqkayak hull.", occurredOn: "2026-03-14" });
    const last = c.store.put({ type: "memory", kind: "fact", body: "Bought the zqkayak.", occurredOn: "2025-11-02" });
    const by = ask(c, "zqkayak by 12/20");
    expect(new Set(by.memories.map((m) => m.id))).toEqual(new Set([spring, last]));
    expect(by.time?.outside).toBe(0);
    expect(by.time?.window).toEqual({ from: OPEN_START, to: "2026-12-20" });
  });

  // The year-end mirror (2026-10-10): through this year's 1/5 hid the year since it.
  test("\"by 1/5\" asked on 12-28 keeps the year since last January", () => {
    const c = brain(Date.parse("2026-12-28T20:00:00Z"));
    seed(c);
    const spring = c.store.put({ type: "memory", kind: "fact", body: "Patched the zqcanoe hull.", occurredOn: "2026-03-14" });
    const winter = c.store.put({ type: "memory", kind: "fact", body: "Bought the zqcanoe.", occurredOn: "2025-11-02" });
    const by = ask(c, "zqcanoe by 1/5");
    expect(new Set(by.memories.map((m) => m.id))).toEqual(new Set([spring, winter]));
    expect(by.time?.outside).toBe(0);
    expect(by.time?.window).toEqual({ from: OPEN_START, to: "2027-01-05" });
  });

  test("a question that is only a time answers with everything in the window", () => {
    const c = brain();
    seed(c);
    const a = c.store.put({ type: "memory", kind: "fact", body: "Signed the lease.", occurredOn: "2026-09-22" });
    const b = c.store.put({ type: "memory", kind: "fact", body: "Painted the hallway.", occurredOn: "2026-09-25" });
    const r = ask(c, "what happened last week?");
    expect(new Set(r.memories.map((m) => m.id))).toEqual(new Set([a, b]));
    expect(r.weak).toBe(0);
  });

  test("an event anchor resolves to its memory's date and says so in the header", () => {
    const c = brain();
    seed(c);
    const anchor = c.store.put({ type: "memory", kind: "fact", title: "The zqcutover", body: "The zqcutover to the new store went fine.", occurredOn: "2026-09-21" });
    const near = c.store.put({ type: "memory", kind: "fact", body: "Decided to keep the old backups for a month.", occurredOn: "2026-09-22" });
    c.store.put({ type: "memory", kind: "fact", body: "Decided to buy a new kettle.", occurredOn: "2026-09-02" });
    const r = ask(c, "what did we decide around the zqcutover?");
    expect(r.time?.anchor).toMatchObject({ kind: "event", phrase: "zqcutover", date: "2026-09-21", id: anchor });
    expect(r.memories.map((m) => m.id)).toContain(near);
    expect(renderFacts(r)).toContain("zqcutover → 09-21");
  });

  test("an anchor nothing names filters nothing, and the header says so", () => {
    const c = brain();
    seed(c);
    const r = ask(c, "what happened around the zqnothing?");
    expect(r.time?.anchor?.date).toBeNull();
    expect(renderFacts(r)).toContain('no memory names "zqnothing", so nothing was filtered by time');
  });
});

describe("what never comes back, and what comes back labeled", () => {
  // Revised 2026-10-10 (bench R2-2): faded matches rank WITH the live ones,
  // bodies shown, each labeled — they were title lines after the results, and
  // multi-session counting questions came out one item short.
  test("a count whose items are half faded gets every item in the main ranking, with bodies, faded ones labeled", () => {
    const c = brain();
    seed(c);
    const visits = [
      "Visited the zqmuseum with Han to see the clocks.",
      "Went back to the zqmuseum for the map exhibit.",
      "Took the nephews to the zqmuseum on a rainy Saturday.",
      "A late evening at the zqmuseum for the lecture on tides.",
    ].map((body) => c.store.put({ type: "memory", kind: "fact", body }));
    const fadedOnes = [visits[1]!, visits[3]!];
    for (const id of fadedOnes) c.store.updatePhysics(id, { fade: 0.1 });
    for (const id of visits) expect(hasFaded(c.store.physicsOf(id), c.store.livedDay())).toBe(fadedOnes.includes(id));
    const r = ask(c, "how many times did I go to the zqmuseum?");
    expect(new Set(r.memories.map((m) => m.id))).toEqual(new Set(visits));
    expect(r.matched).toBe(4);
    expect(r.faded).toBe(2);
    expect(r.pages).toBe(1);
    for (const m of r.memories) {
      expect(m.faded).toBe(fadedOnes.includes(m.id));
      expect(m.body).toContain("zqmuseum");
    }
    const text = renderFacts(r);
    expect(text.split("\n")[0]).toBe("4 match · showing 4 · 2 of them faded");
    expect(text).not.toContain("listed after");
    for (const id of fadedOnes) {
      const heading = text.split("\n").find((l) => l.includes(` · ${id} · `));
      expect(heading).toContain("· faded: weak, below reach");
    }
    for (const id of visits.filter((v) => !fadedOnes.includes(v))) {
      expect(text.split("\n").find((l) => l.includes(` · ${id} · `))).not.toContain("faded");
    }
    expect(text).toContain("Went back to the zqmuseum for the map exhibit.");
    expect(text).toContain("A late evening at the zqmuseum for the lecture on tides.");
  });

  test("a faded match ranks by how well it matched: a stronger faded match comes before a weaker live one", () => {
    const c = brain();
    seed(c);
    const live = c.store.put({ type: "memory", kind: "fact", body: "The zqlamp needs a new bulb." });
    const faded = c.store.put({ type: "memory", kind: "fact", title: "Old zqlamp zqbrass", body: "The zqbrass zqlamp was bought at the market." });
    c.store.updatePhysics(faded, { fade: 0.1 });
    expect(hasFaded(c.store.physicsOf(faded), c.store.livedDay())).toBe(true);
    const r = ask(c, "zqbrass zqlamp");
    expect(r.memories.map((m) => m.id)).toEqual([faded, live]);
    expect(r.faded).toBe(1);
    const only = ask(c, "zqbrass");
    expect(only.matched).toBe(1);
    expect(only.reason).toBe("answered");
    expect(renderFacts(only).split("\n")[0]).toBe("1 match · showing 1 · faded");
  });

  test("ambient recall still leaves a below-reach memory out; facts mode still finds it", () => {
    const c = brain();
    const body = "The rotary zqtumbler jammed after the winter freeze; a mallet on the drum frees it.";
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      title: "Zqtumbler jam",
      body,
      salience: { novelty: null, relevance: 0.8, emotional: 0.5, predictive: 0.6 },
    });
    const turn = "the rotary zqtumbler jammed again after the freeze";
    const reached = (session: string): string[] => {
      const d = c.recallForTurn({ sessionId: session, text: turn }).decision;
      return [...d.surfaced, ...d.footnotes];
    };
    expect(reached("s-in-reach")).toContain(id);
    c.store.updatePhysics(id, { fade: 0.1 });
    expect(hasFaded(c.store.physicsOf(id), c.store.livedDay())).toBe(true);
    expect(reached("s-below-reach")).not.toContain(id);
    const r = ask(c, "zqtumbler");
    expect(r.memories.map((m) => m.id)).toEqual([id]);
    expect(r.memories[0]?.faded).toBe(true);
  });

  test("confidential memories are silently absent for a non-owner, counted only for the durable row", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "The zqclinic visit is on Friday.", meta: { confidential: true } });
    const open1 = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Elm Street." });
    const r = ask(c, "zqclinic", { owner: false });
    expect(r.memories.map((m) => m.id)).toEqual([open1]);
    expect(r.matched).toBe(1);
    expect(r.blockedBy["confidential-withheld"]).toBe(1);
    expect(renderFacts(r)).not.toContain("Friday");
    expect(ask(c, "zqclinic").matched).toBe(2);
  });

  test("a chapter and its own copy are one result, the chapter, labeled journal", () => {
    const c = brain();
    seed(c);
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    const written = c.appendEpisode("s1", "Walked the zqharbour breakwater at dusk.", { title: "The zqharbour evening" });
    const ingested = c.ingestEpisode({ sessionId: "s1" });
    expect(ingested.ingested).toBe(true);
    const r = ask(c, "zqharbour");
    const ids = r.memories.map((m) => m.id);
    expect(ids).toEqual([written.episodeId as string]);
    expect(ids).not.toContain(ingested.memoryId);
    const text = renderFacts(r);
    expect(text).toContain("[journal]");
    expect(text).toContain("my journal · written");
  });

  test("a chapter's own appends are never listed as EARLIER versions of it (2026-10-15)", () => {
    const c = brain();
    seed(c);
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    const written = c.appendEpisode("s1", "Walked the zqlighthouse path in the fog.");
    const id = written.episodeId as string;
    // The version rows appends left before `store#appendBody`: each is the body's prefix.
    const prior = c.store.readProse(id).body;
    c.store.revise(id, { body: `${prior}\nAnd the foghorn started up as we turned back.\n`, reason: "episode-append" });
    const r = ask(c, "zqlighthouse");
    const hit = r.memories.find((m) => m.id === id);
    expect(hit).toBeDefined();
    expect(hit?.earlier).toEqual([]);
    // A new append keeps no version at all.
    c.appendEpisode("s1", "Then the zqlighthouse keeper waved from the gallery.");
    expect(c.store.versions(id).length).toBe(1);
  });

  test("near-duplicates are shown once", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "The zqfence on the north side needs two new posts and a gate latch." });
    c.store.put({ type: "memory", kind: "fact", body: "The zqfence on the north side needs two new posts and a gate latch!" });
    const r = ask(c, "zqfence");
    expect(r.memories.length).toBe(1);
    expect(r.duplicates).toBe(1);
  });

  test("weak matches are left out and the header says so", () => {
    const c = brain();
    seed(c);
    const places = ["the attic", "the shed", "the porch", "the cellar", "the loft", "the garage"];
    for (const p of places) c.store.put({ type: "memory", kind: "fact", body: `Zqalpha zqbeta zqgamma and zqdelta were all found in ${p}.` });
    for (let i = 0; i < 6; i++) c.store.put({ type: "memory", kind: "fact", body: `A zqdelta mention, number ${String(i)}, in passing.` });
    const r = ask(c, "zqalpha zqbeta zqgamma zqdelta");
    expect(r.weak).toBeGreaterThan(0);
    expect(renderFacts(r)).toMatch(/may not be everything: .*weak match/);
  });

  test("the answer stays inside the list's room however long the bodies", () => {
    const c = brain();
    seed(c);
    for (let i = 0; i < 12; i++) {
      c.store.put({ type: "memory", kind: "fact", title: `zqlong ${String(i)} ${"t".repeat(150)}`, body: `zqlong ${"word ".repeat(400)}${String(i)}` });
    }
    const text = renderFacts(ask(c, "zqlong"));
    expect(text.length).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(text).toContain("read any whole with ids");
  });
});

describe("through the tool", () => {
  function server(c: Counterpart): McpServer {
    return new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", owner: true, registryDir: join(dir, "store"), now: () => NOW });
  }
  const body = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  test("a question without a mode is refused and taught the two; ids take none", async () => {
    const c = brain();
    seed(c);
    const id = c.store.put({ type: "memory", kind: "fact", body: "The zqtool answer." });
    const s = server(c);
    const refused = body(await s.call("recall", { question: "zqtool" }));
    expect(refused["reason"]).toBe("mode-required");
    expect(String(refused["modes"])).toContain('"facts"');
    expect(body(await s.call("recall", { question: "zqtool", mode: "vibes" }))["reason"]).toBe("mode-unknown");
    const facts = body(await s.call("recall", { question: "zqtool", mode: "facts" }));
    expect(facts["mode"]).toBe("facts");
    expect(facts["ids"]).toEqual([id]);
    expect(String(facts["answer"])).toContain(id);
    const byId = body(await s.call("recall", { ids: [id], mode: "facts" }));
    expect(byId["reason"]).toBe("expanded");
    expect(byId["modeIgnored"]).toBeDefined();
    const meaning = body(await s.call("recall", { question: "zqtool", mode: "meaning" }));
    expect(meaning["mode"]).toBe("meaning");
    expect(typeof meaning["answer"]).toBe("string");
  });

  test("a meaning question goes through the dispatch: meaning's own answer, and what it showed is seen and quotable", async () => {
    const c = brain();
    seed(c);
    const card = c.schemas.mention({ name: "Zorabel", kind: "person", source: "Zorabel", chunkRef: "card-zb", aliases: [], day: c.store.livedDay() });
    expect(card.ok).toBe(true);
    const moment = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Zorabel showed me the old observatory and its brass telescope after the storm.",
      origin: { session: "sess_zb", scope: "/scope/one" },
    });
    const s = server(c);
    // Not shown yet: a feeling now about it is refused.
    const before = body(await s.call("remember", { feelingsNow: [{ id: moment, core: "calm", emotion: "content", strength: 0.5 }] }));
    expect((before["feelingsNow"] as { recorded: number }).recorded).toBe(0);
    const out = body(await s.call("recall", { question: "What has Zorabel been to me?", mode: "meaning" }));
    expect(out["mode"]).toBe("meaning");
    expect(out["reason"]).toBe("answered");
    const direct = meaningRecall({ counterpart: c, sessionId: SESSION, owner: true }, "What has Zorabel been to me?");
    expect(out["answer"]).toBe(renderMeaning(direct));
    expect(out["ids"]).toEqual([...direct.shown]);
    expect(direct.shown).toContain(moment);
    // Seen: the feeling now is recorded. Quotable: the `asked` record names it.
    const after = body(await s.call("remember", { feelingsNow: [{ id: moment, core: "calm", emotion: "content", strength: 0.5 }] }));
    expect((after["feelingsNow"] as { recorded: number }).recorded).toBe(1);
    expect(c.store.gateRecords(SESSION, "asked").map((r) => r.ref)).toContain(moment);
    // The durable row says which mode answered.
    const row = c.store.eventLog({ name: "mcp.recall", limit: 5 }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(row.some((p) => p["mode"] === "meaning")).toBe(true);
  });

  test("a possessive in a question reaches the card: \"Zorabel's\" is Zorabel", () => {
    const c = brain();
    seed(c);
    const card = c.schemas.mention({ name: "Zorabel", kind: "person", source: "Zorabel", chunkRef: "card-zp", aliases: [], day: c.store.livedDay() });
    expect(card.ok).toBe(true);
    const named = c.store.put({ type: "memory", kind: "fact", body: "Zorabel moved to the coast in spring." });
    const r = ask(c, "where is Zorabel's new place?");
    expect(r.subjects.map((x) => x.name)).toEqual(["Zorabel"]);
    const hit = r.memories.find((m) => m.id === named);
    expect(hit?.ways).toContain("subject");
  });

  test("the quotable record is not the ambient gate's: a session with only `asked` rows reads absent, not unreadable", () => {
    const c = brain();
    const id = c.store.put({ type: "memory", kind: "fact", body: "A thing an answer showed." });
    c.noteAsked("sess-only-asked", [id]);
    expect(loadGateState(c.store, "sess-only-asked").status).toBe("absent");
    expect(c.store.gateRecords("sess-only-asked", "asked").map((r) => r.ref)).toEqual([id]);
  });

  test("a quote of a shown memory's words is credited at the boundary; a list alone is not", async () => {
    const c = brain();
    seed(c);
    const id = c.store.put({ type: "memory", kind: "fact", body: "The zqorchard pear trees need pruning before the first frost every November." });
    const s = server(c);
    await s.call("recall", { question: "zqorchard", mode: "facts" });
    // A memory takes no credit on the day it was born: the reply comes a day later.
    c.store.advanceClock("2026-10-04");
    const before = c.store.physicsOf(id).uses;
    const silent = c.creditReferences(SESSION, { assistantTurns: ["Nothing about it."], expansions: [] });
    expect(silent.quoted).toBe(0);
    const quoted = c.creditReferences(SESSION, {
      assistantTurns: ["You said the pear trees need pruning before the first frost every November, so let's plan."],
      expansions: [],
    });
    expect(quoted.quoted).toBe(1);
    expect(quoted.ids).toContain(id);
    expect(c.store.physicsOf(id).uses).toBeGreaterThan(before);
  });

  test("a faded result is credited on a quote or an open, never for being shown", async () => {
    const c = brain();
    seed(c);
    const quotedId = c.store.put({ type: "memory", kind: "fact", body: "The zqquince hedge was planted along the north wall the spring we moved in." });
    const openedId = c.store.put({ type: "memory", kind: "fact", body: "The zqquince jelly recipe wants twice the lemon the book says." });
    for (const id of [quotedId, openedId]) c.store.updatePhysics(id, { fade: 0.1 });
    const s = server(c);
    const out = body(await s.call("recall", { question: "zqquince", mode: "facts" }));
    expect(new Set(out["ids"] as string[])).toEqual(new Set([quotedId, openedId]));
    expect(out["faded"]).toBe(2);
    expect(String(out["answer"])).toContain("the north wall the spring we moved in");
    c.store.advanceClock("2026-10-04");
    const uses = (id: string): number => c.store.physicsOf(id).uses;
    const before = { q: uses(quotedId), o: uses(openedId) };
    // Shown, and the reply says nothing of it: no credit, and still faded.
    const silent = c.creditReferences(SESSION, { assistantTurns: ["Nothing about it."], expansions: [] });
    expect(silent.quoted).toBe(0);
    expect(uses(quotedId)).toBe(before.q);
    expect(uses(openedId)).toBe(before.o);
    expect(hasFaded(c.store.physicsOf(quotedId), c.store.livedDay())).toBe(true);
    // Quoted: credited.
    const quoted = c.creditReferences(SESSION, {
      assistantTurns: ["You planted the hedge along the north wall the spring we moved in, so it is old now."],
      expansions: [],
    });
    expect(quoted.ids).toContain(quotedId);
    expect(quoted.ids).not.toContain(openedId);
    expect(uses(quotedId)).toBeGreaterThan(before.q);
    expect(uses(openedId)).toBe(before.o);
    // Opened by id: credited.
    const opened = c.creditReferences(SESSION, { assistantTurns: ["Read it."], expansions: [openedId] });
    expect(opened.ids).toContain(openedId);
    expect(uses(openedId)).toBeGreaterThan(before.o);
  });
});

// 2026-10-09 (the LongMemEval run): a corrected memory is archived, so out of
// the word index, and "N corrected versions hidden" named none — one a wrong
// correction archived could not be reached, even by a search that named it.
describe("corrected versions are named, as wrong, and open by id (through the tool)", () => {
  function server(c: Counterpart, owner = true): McpServer {
    return new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", owner, registryDir: join(dir, "store"), now: () => NOW });
  }
  const body = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  test("a search that names the corrected one finds it under the one that corrected it, and its id opens it", async () => {
    const c = brain();
    seed(c);
    const wrong = c.store.put({ type: "memory", kind: "fact", title: "Potted plants at the market", body: "Sold 14 zqpotted plants at the Zqsolstice Market." });
    const right = c.store.put({ type: "memory", kind: "fact", title: "Herb sale", body: "Sold 30 herb bundles at the Zqsolstice Market." });
    expect(settle(c.store, { holds: right, over: wrong, how: "corrected", why: "it was herbs", actor: "session" }).ok).toBe(true);
    const s = server(c);
    const out = body(await s.call("recall", { question: "Zqsolstice Market zqpotted plants sold", mode: "facts" }));
    const answer = String(out["answer"]);
    expect(answer).toContain(`   corrected (was wrong): "Potted plants at the market" (learned 10-03), corrected 10-03 · ${wrong}\n`);
    expect(answer).not.toContain("hidden");
    // Not a result: the shown ids are the results only, as for an earlier version.
    expect(out["ids"]).toEqual([right]);
    expect(answer.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(1);
    // Archived, and readable by its id: the words whole, and that it was corrected, by which.
    expect(c.store.row(wrong)?.archived).toBe(1);
    const opened = body(await s.call("recall", { ids: [wrong] }));
    expect(opened["reason"]).toBe("expanded");
    const mems = opened["memories"] as { id: string; excerpt: string; truncated: boolean; standing?: string }[];
    expect(mems.map((m) => m.id)).toEqual([wrong]);
    expect(mems[0]?.excerpt).toBe("Sold 14 zqpotted plants at the Zqsolstice Market.");
    expect(mems[0]?.truncated).toBe(false);
    expect(mems[0]?.standing).toContain(`corrected by ${right}`);
  });

  test("a few named, those the question reaches first, the rest counted", async () => {
    const c = brain();
    seed(c);
    const right = c.store.put({ type: "memory", kind: "fact", body: "The zqferry leaves from dock 2 at noon." });
    const wrongs: string[] = [];
    for (const [i, w] of ["dock 5", "dock 6", "dock 7", "the zqharbour pier"].entries()) {
      const id = c.store.put({ type: "memory", kind: "fact", body: `The zqferry leaves from ${w}, take ${String(i)}.` });
      wrongs.push(id);
      expect(settle(c.store, { holds: right, over: id, how: "corrected", why: "dock 2", actor: "session" }).ok).toBe(true);
    }
    const answer = String(body(await server(c).call("recall", { question: "zqferry zqharbour", mode: "facts" }))["answer"]);
    const lines = answer.split("\n").filter((l) => l.includes("corrected"));
    expect(lines).toHaveLength(4);
    // The one the question's words reach comes first.
    expect(lines[0]).toContain(`zqharbour pier, take 3." (learned 10-03), corrected 10-03 · ${wrongs[3] as string}`);
    expect(lines.slice(0, 3).every((l) => l.startsWith("   corrected (was wrong): "))).toBe(true);
    expect(lines[3]).toBe("   +1 more corrected (was wrong)");
  });

  test("a confidential corrected memory is counted, never named, to a non-owner", async () => {
    const c = brain();
    seed(c);
    const right = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Oak Street." });
    const secret = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Elm Street.", meta: { confidential: true } });
    expect(settle(c.store, { holds: right, over: secret, how: "corrected", why: "Oak", actor: "session" }).ok).toBe(true);
    const guest = String(body(await server(c, false).call("recall", { question: "zqclinic street", mode: "facts" }))["answer"]);
    expect(guest).not.toContain(secret);
    expect(guest).not.toContain("Elm");
    expect(guest).toContain("   1 corrected version hidden");
    const owner = String(body(await server(c).call("recall", { question: "zqclinic street", mode: "facts" }))["answer"]);
    expect(owner).toContain(`corrected (was wrong): "The zqclinic is on Elm Street." (learned 10-03), corrected 10-03 · ${secret}`);
  });

  test("beside a plain corrected one, a confidential one is only counted to a non-owner, and its id opens nothing", async () => {
    const c = brain();
    seed(c);
    const right = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Oak Street." });
    const plain = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Pine Street." });
    const secret = c.store.put({ type: "memory", kind: "fact", body: "The zqclinic is on Elm Street.", meta: { confidential: true } });
    for (const over of [plain, secret]) expect(settle(c.store, { holds: right, over, how: "corrected", why: "Oak", actor: "session" }).ok).toBe(true);
    const guest = server(c, false);
    const answer = String(body(await guest.call("recall", { question: "zqclinic street", mode: "facts" }))["answer"]);
    expect(answer).toContain(`   corrected (was wrong): "The zqclinic is on Pine Street." (learned 10-03), corrected 10-03 · ${plain}\n   +1 more corrected (was wrong)\n`);
    expect(answer).not.toContain(secret);
    expect(answer).not.toContain("Elm");
    const opened = JSON.stringify(await guest.call("recall", { ids: [secret] }));
    expect(opened).toContain("handle-confidential-withheld");
    expect(opened).not.toContain("Elm");
  });

  test("an answer with no corrected version carries no corrected field or line", async () => {
    const c = brain();
    seed(c);
    const old = c.store.put({ type: "memory", kind: "fact", title: "Gym at 7", body: "The zqswim session is at 7am." });
    const now = c.store.put({ type: "memory", kind: "fact", title: "Gym moved", body: "Moved to 6am from next week." });
    expect(settle(c.store, { holds: now, over: old, how: "changed", why: "the time changed", actor: "session" }).ok).toBe(true);
    const r = ask(c, "zqswim");
    expect(r.memories[0]?.corrected).toBe(0);
    expect(Object.keys(r.memories[0] ?? {})).not.toContain("correctedShown");
    const answer = String(body(await server(c).call("recall", { question: "zqswim", mode: "facts" }))["answer"]);
    expect(answer).toBe(renderFacts(r));
    expect(answer).not.toContain("corrected");
  });
});

// 2026-10-11 (bench case a2f3aa27): two updates said on one day read as a tie.
describe("order within a day (renderAt#sameDayTimes)", () => {
  /** A store on a clock the test moves, so each put has its own `created_at`. */
  function clocked(zone = ZONE): { c: Counterpart; at: (iso: string) => void } {
    let t = NOW;
    const c = Counterpart.open({ dir: join(dir, "store"), owner: true, now: () => t, timeZone: zone });
    findable(c.store);
    open.push(c);
    return {
      c,
      at: (iso) => {
        t = Date.parse(iso);
      },
    };
  }

  test("two results of the same day show the time each was learned, in the store's zone", () => {
    const { c, at } = clocked();
    seed(c);
    at("2026-10-03T12:27:00Z"); // 05:27 in Los Angeles
    c.store.put({ type: "memory", kind: "fact", body: "The zqchannel has 1250 followers.", occurredOn: "2026-10-03" });
    at("2026-10-03T16:52:00Z"); // 09:52
    c.store.put({ type: "memory", kind: "fact", body: "The zqchannel is close to 1300 followers.", occurredOn: "2026-10-03" });
    const text = renderFacts(ask(c, "zqchannel followers"));
    expect(text).toContain("happened Sat 10-03\n   learned 10-03 05:27 ·");
    expect(text).toContain("happened Sat 10-03\n   learned 10-03 09:52 ·");
  });

  test("a lone result, different event days, different learned days and one shared minute show nothing new", () => {
    const { c, at } = clocked();
    seed(c);
    at("2026-10-03T12:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqlone note on its own." });
    expect(renderFacts(ask(c, "zqlone"))).toMatch(/learned 10-03 · /);
    // Same learned day, different event days.
    c.store.put({ type: "memory", kind: "fact", body: "Zqdays first.", occurredOn: "2026-09-20" });
    at("2026-10-03T15:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqdays second.", occurredOn: "2026-09-25" });
    // Same event day, learned on different days: the learned dates order them.
    at("2026-10-01T15:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqlearn first.", occurredOn: "2026-09-25" });
    at("2026-10-03T15:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqlearn second.", occurredOn: "2026-09-25" });
    // Same day, same minute: a time would order nothing.
    c.store.put({ type: "memory", kind: "fact", body: "Zqsame first." });
    c.store.put({ type: "memory", kind: "fact", body: "Zqsame second." });
    for (const q of ["zqdays", "zqlearn", "zqsame"]) {
      const r = ask(c, q);
      expect(r.memories.length).toBe(2);
      expect(renderFacts(r)).not.toMatch(/learned \d\d-\d\d \d\d:\d\d/);
    }
  });

  test("the time is the store's zone, not the machine's (Pacific/Kiritimati)", () => {
    const { c, at } = clocked("Pacific/Kiritimati");
    seed(c);
    at("2026-10-02T22:00:00Z"); // 12:00 on 10-03 in Kiritimati (UTC+14)
    c.store.put({ type: "memory", kind: "fact", body: "Zqisland boat arrived." });
    at("2026-10-02T23:30:00Z"); // 13:30
    c.store.put({ type: "memory", kind: "fact", body: "Zqisland boat left again." });
    const text = renderFacts(ask(c, "zqisland boat"));
    expect(text).toContain("learned 10-03 12:00 ·");
    expect(text).toContain("learned 10-03 13:30 ·");
  });

  test("an old row with no created_at shows nothing extra; the rest of its day still do", () => {
    const { c, at } = clocked();
    seed(c);
    at("2026-10-03T16:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqold first word." });
    at("2026-10-03T17:00:00Z");
    c.store.put({ type: "memory", kind: "fact", body: "Zqold second word." });
    const old = c.store.put({ type: "memory", kind: "fact", body: "Zqold third word, from before." });
    c.close();
    open.splice(0);
    const db = new Database(paths.operational(join(dir, "store")));
    db.run("UPDATE memories SET created_at = NULL WHERE id = ?", [old]);
    db.close();
    const again = Counterpart.open({ dir: join(dir, "store"), owner: true, now: () => NOW, timeZone: ZONE });
    open.push(again);
    const r = ask(again, "zqold");
    expect(r.memories.length).toBe(3);
    expect(r.memories.find((m) => m.id === old)?.learnedAt).toBeUndefined();
    const text = renderFacts(r);
    expect(text).toContain("learned 10-03 09:00 ·");
    expect(text).toContain("learned 10-03 10:00 ·");
    const oldBlock = text.split("\n\n").find((b) => b.includes(old)) ?? "";
    expect(oldBlock).toMatch(/learned 10-03 · /);
  });

  test("ten results of one day: each line grows by its time, six bytes", () => {
    const { c, at } = clocked();
    seed(c);
    const what = ["the roof", "a kayak", "the budget", "my sister", "the garden", "a recipe", "the car", "an invoice", "the dog", "a concert"];
    what.forEach((w, i) => {
      at(`2026-10-03T${String(13 + i)}:0${String(i)}:00Z`);
      c.store.put({ type: "memory", kind: "fact", body: `Zqten: news about ${w} came in.`, occurredOn: "2026-10-03" });
    });
    const r = ask(c, "zqten");
    expect(r.memories.length).toBe(10);
    const text = renderFacts(r);
    const without = renderFacts({ ...r, memories: r.memories.map(({ learnedAt: _, ...m }) => m) });
    expect(text.length - without.length).toBe(60);
    expect(text.length).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
  });
});

// 2026-10-20, from the benchmark loss read; helps real recall too; lightly
// held, revisit ~10-27. The needed memory was often ranked 11th–30th and never
// reached the answerer, who seldom pages; the tail lists it by title.
describe("the title tail (2026-10-20)", () => {
  const TOWNS = ["Leeds", "Hull", "York", "Bath", "Ely", "Wells", "Ripon", "Derby", "Truro", "Exeter"];
  const HOW = ["by van", "by rail", "by courier", "by barge"];
  /** Forty different facts one word reaches, each with a long title and a date from another year. */
  function forty(c: Counterpart): string[] {
    const ids: string[] = [];
    for (const town of TOWNS) {
      for (const how of HOW) {
        // Words of its own in each long title, so no two read as near-duplicates.
        const own = Array.from({ length: 10 }, (_, k) => `${town.toLowerCase()}${how.slice(3)}${String(k)}`).join(" ");
        ids.push(
          c.store.put({
            type: "memory",
            kind: "fact",
            title: `The zqcrate order for ${town} ${how}, ${own}`,
            body: `A zqcrate order went to ${town} ${how}, packed in ${String(town.length * how.length)} boxes.`,
            occurredOn: "2024-05-01",
          }),
        );
      }
    }
    return ids;
  }
  const tailOf = (text: string): string[] => {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith("next ") && l.includes("titles only"));
    if (at < 0) return [];
    const end = lines.findIndex((l, i) => i > at && l === "");
    return lines.slice(at, end < 0 ? undefined : end);
  };

  test("after the page's bodies, ranks 11–30 as one title line each, inside the budget; the header still counts the pages", () => {
    const c = brain();
    seed(c);
    forty(c);
    const p1 = ask(c, "the zqcrate orders");
    expect(p1.matched).toBe(40);
    expect(p1.pages).toBe(4);
    expect(p1.memories.length).toBe(FACTS_PAGE_SIZE);
    expect(p1.tail.length).toBe(FACTS_TAIL_SIZE);
    // The tail is the next pages' results, in order: ranks 11–30.
    const p2 = ask(c, "the zqcrate orders", { page: 2 });
    const p3 = ask(c, "the zqcrate orders", { page: 3 });
    expect(p1.tail.map((t) => t.id)).toEqual([...p2.memories, ...p3.memories].map((m) => m.id));
    // No page shown twice in one answer: the tail is not the page.
    for (const t of p1.tail) expect(p1.memories.map((m) => m.id)).not.toContain(t.id);
    const text = renderFacts(p1);
    expect(text.split("\n")[0]).toBe("40 match · showing 10 · 30 more → page 2");
    const tail = tailOf(text);
    expect(tail[0]).toBe("next 20, titles only (open any by id):");
    expect(tail.length).toBe(21);
    expect(tail[1]).toMatch(/^11\. The zqcrate order for .+… · mem_[0-9a-f]+ · 2024-05-01$/);
    expect(tail[20]?.startsWith("30. ")).toBe(true);
    // Title lines only: a tail entry's body is not in the answer.
    const t11 = c.store.readProse(p1.tail[0]?.id as string).body;
    expect(text).not.toContain(t11);
    // The budget: long titles and other-year dates stay near 1.5 KB.
    expect(tail.join("\n").length).toBeLessThanOrEqual(1_800);
    expect(text.length).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(text).toContain("read any whole with ids: [...] (up to 10) · page: 2 for the next.");
  });

  test("page 2's tail is ranks 21–40; the last page and a short answer list what is left, or nothing", () => {
    const c = brain();
    seed(c);
    forty(c);
    const p2 = ask(c, "the zqcrate orders", { page: 2 });
    expect(renderFacts(p2).split("\n")[0]).toBe("40 match · page 2 · showing 11–20 · 20 more → page 3");
    expect(p2.tail.length).toBe(20);
    expect(tailOf(renderFacts(p2))[1]?.startsWith("21. ")).toBe(true);
    const p3 = ask(c, "the zqcrate orders", { page: 3 });
    expect(p3.tail.length).toBe(10);
    expect(tailOf(renderFacts(p3))[0]).toBe("next 10, titles only (open any by id):");
    expect(ask(c, "the zqcrate orders", { page: 4 }).tail).toEqual([]);
    // Ten or fewer matches: no tail at all, and the answer reads as before.
    const few = c.store.put({ type: "memory", kind: "fact", body: "The zqfew note." });
    const r = ask(c, "zqfew");
    expect(r.memories.map((m) => m.id)).toEqual([few]);
    expect(r.tail).toEqual([]);
    expect(renderFacts(r)).not.toContain("titles only");
  });

  test("a confidential memory is never in a non-owner's tail; the owner's tail may list it", () => {
    const c = brain();
    seed(c);
    forty(c);
    const secret = c.store.put({ type: "memory", kind: "fact", body: "The zqcrate order for the clinic, kept private.", meta: { confidential: true } });
    const stranger = ask(c, "the zqcrate orders", { owner: false });
    expect(stranger.matched).toBe(40);
    expect([...stranger.memories.map((m) => m.id), ...stranger.tail.map((t) => t.id)]).not.toContain(secret);
    expect(renderFacts(stranger)).not.toContain(secret);
    expect(ask(c, "the zqcrate orders").matched).toBe(41);
  });

  test("when the answer runs out of room the tail goes first, before the excerpts go to nothing", () => {
    const c = brain();
    seed(c);
    forty(c);
    const r = ask(c, "the zqcrate orders");
    // Lines so long that the page fits only without the tail (about 11.2k of 12k without it).
    const long = { ...r, memories: r.memories.map((m) => ({ ...m, line: `${m.line} ${"x".repeat(800)}` })) };
    const text = renderFacts(long);
    expect(text.length).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(text).not.toContain("titles only");
    // The bodies kept their (shortest) excerpts.
    expect(text).toContain("A zqcrate order went to");
    // Room enough: the tail is back.
    expect(renderFacts(r)).toContain("next 20, titles only");
  });

  test("a listed title credits nothing: not in the answer's ids, not seen, not quotable; the row keeps it apart", async () => {
    const c = brain();
    seed(c);
    forty(c);
    const s = new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", owner: true, registryDir: join(dir, "store"), now: () => NOW });
    const out = (await s.call("recall", { question: "the zqcrate orders", mode: "facts" })).structuredContent;
    const ids = out["ids"] as string[];
    expect(ids.length).toBe(FACTS_PAGE_SIZE);
    const answer = String(out["answer"]);
    expect(answer).toContain("next 20, titles only");
    const listed = tailOf(answer)
      .slice(1)
      .map((l) => /· (mem_[0-9a-f]+) ·/.exec(l)?.[1] as string);
    expect(listed.length).toBe(20);
    for (const id of listed) expect(ids).not.toContain(id);
    // Not in the quotable record.
    const asked = c.store.gateRecords(SESSION, "asked").map((g) => g.ref);
    for (const id of listed) expect(asked).not.toContain(id);
    for (const id of ids) expect(asked).toContain(id);
    // The durable row: delivered ids as before, the tail apart (for the ~10-27 check).
    const row = JSON.parse(c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(new Set(row["ids"] as string[])).toEqual(new Set(ids));
    expect(row["tail"]).toBe(20);
    expect(row["tailIds"]).toEqual(listed);
    // A reply that repeats a listed title's words, a day later, credits nothing.
    c.store.advanceClock("2026-10-04");
    const first = listed[0] as string;
    const before = c.store.physicsOf(first).uses;
    const title = c.store.readProse(first).title as string;
    const quoted = c.creditReferences(SESSION, { assistantTurns: [`You told me: ${title}`], expansions: [] });
    expect(quoted.ids).not.toContain(first);
    expect(c.store.physicsOf(first).uses).toBe(before);
    // Opened by id: credited, as any open is.
    const opened = c.creditReferences(SESSION, { assistantTurns: ["Read it."], expansions: [first] });
    expect(opened.ids).toContain(first);
    expect(c.store.physicsOf(first).uses).toBeGreaterThan(before);
  });

  // Review of #544: the tail reads the same faded set the bodies do.
  test("a faded match in the tail keeps its rank and is labeled faded", () => {
    const c = brain();
    seed(c);
    forty(c);
    const before = ask(c, "the zqcrate orders");
    const target = before.tail[4]?.id as string;
    c.store.updatePhysics(target, { fade: 0.1 });
    expect(hasFaded(c.store.physicsOf(target), c.store.livedDay())).toBe(true);
    const after = ask(c, "the zqcrate orders");
    expect(after.tail.map((t) => t.id)).toEqual(before.tail.map((t) => t.id));
    expect(after.tail[4]?.faded).toBe(true);
    const line = renderFacts(after).split("\n").find((l) => l.includes(target));
    expect(line).toMatch(/^15\. .* · faded$/);
  });

  // Review of #544: a settled-over memory whose current version this asker may
  // not see does not fold, and its title in the tail read as current.
  test("a settled-over memory listed on its own carries the earlier mark, as its body would", () => {
    // A clock that moves, so equal matches rank newest first and the old one lands in the tail.
    let t = NOW - 3_600_000;
    const c = Counterpart.open({ dir: join(dir, "store"), owner: true, now: () => (t += 1000), timeZone: ZONE });
    findable(c.store);
    open.push(c);
    seed(c);
    const crate = (i: number): string =>
      c.store.put({ type: "memory", kind: "fact", title: `zqcrate order ${String(i)} for town${String(i)}`, body: `A zqcrate order went to town${String(i)} by van.` });
    for (let i = 0; i < 20; i++) crate(i);
    const old = crate(77);
    for (let i = 100; i < 115; i++) crate(i);
    const secretNow = c.store.put({ type: "memory", kind: "fact", body: "The depot moved to the clinic.", meta: { confidential: true } });
    expect(settle(c.store, { holds: secretNow, over: old, how: "changed", why: "moved", actor: "session" }).ok).toBe(true);
    const guest = ask(c, "zqcrate", { owner: false });
    const at = guest.tail.findIndex((x) => x.id === old);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(guest.tail[at]?.now).toBe("a later version");
    const text = renderFacts(guest);
    expect(text).toContain(`. earlier (now a later version): zqcrate order 77 for town77 · ${old} · `);
    expect(text).not.toContain(secretNow);
    // The owner sees the current version, which the old one folded into: no mark on any line.
    const owner = ask(c, "zqcrate");
    expect([...owner.memories.map((m) => m.id), ...owner.tail.map((x) => x.id)]).not.toContain(old);
    expect(owner.tail.every((x) => x.now === undefined)).toBe(true);
  });
});

// 2026-10-20, from the benchmark loss read; helps real recall too; lightly
// held, revisit. "Lately" hard-windowed a facts question to the past week and
// hid the answer three months back (loc-conv-49-122).
describe("soft time words (2026-10-20)", () => {
  const clock = { now: NOW, zone: ZONE };

  test("lately, recently, these days, nowadays: the past week, marked soft, taken out of the question", () => {
    for (const word of ["lately", "recently", "these days", "nowadays"]) {
      const t = readTimeAsk(`what has Han been cooking ${word}?`, clock);
      expect(t?.soft).toBe(true);
      expect(t?.cue).toBe(word);
      expect(t?.said).toEqual({ from: "2026-09-27", to: "2026-10-03" });
      expect(t?.rest.replace(/\s+\?$/, "?")).toBe("what has Han been cooking?");
    }
    // An explicit window is read first and is not soft.
    const sept = readTimeAsk("what did Han cook recently, in September?", clock);
    expect(sept?.said).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(sept?.soft).toBeUndefined();
    for (const q of ["the gym last week", "what changed in September", "since 9/12 the gym", "the gym 3 days ago", "the gym yesterday"]) {
      expect(readTimeAsk(q, clock)?.soft).toBeUndefined();
    }
    // "of late" is not read: "because of late fees".
    expect(readTimeAsk("charges because of late fees", clock)).toBeNull();
  });

  test("a soft word filters nothing: an old match still comes back, and the header says so", () => {
    const c = brain();
    seed(c);
    const old = c.store.put({ type: "memory", kind: "fact", body: "Sam was diagnosed with zqgastritis after an ER visit.", occurredOn: "2026-07-10" });
    const r = ask(c, "What zqgastritis did Sam have lately?");
    expect(r.memories.map((m) => m.id)).toContain(old);
    expect(r.time?.soft).toBe(true);
    expect(r.time?.window).toBeNull();
    expect(r.time?.outside).toBe(0);
    const text = renderFacts(r);
    expect(text).toContain("time: lately → 09-27..10-03 first, nothing filtered by date");
    expect(text).not.toContain("outside it");
  });

  test("near-equal matches rank the recent one first; a strong old match still beats a weak recent one", () => {
    const c = brain();
    seed(c);
    // Near-equal: one word each; the old one's shorter words match a shade more strongly.
    const oldNear = c.store.put({ type: "memory", kind: "fact", body: "Baked zqrye bread.", occurredOn: "2026-08-01" });
    const newNear = c.store.put({ type: "memory", kind: "fact", body: "Baked a zqrye loaf for the neighbours on Thursday.", occurredOn: "2026-10-01" });
    expect(ask(c, "the zqrye baking").memories[0]?.id).toBe(oldNear);
    const soft = ask(c, "the zqrye baking lately");
    expect(soft.memories.map((m) => m.id)).toEqual([newNear, oldNear]);
    expect(soft.memories[0]?.ways).toContain("time");
    // Strong old (both words) over weak recent (one word).
    const oldStrong = c.store.put({ type: "memory", kind: "fact", body: "Fixed the zqkiln zqvent in the shed.", occurredOn: "2026-06-01" });
    const newWeak = c.store.put({ type: "memory", kind: "fact", body: "Cleaned the zqkiln shelves.", occurredOn: "2026-10-02" });
    expect(ask(c, "the zqkiln zqvent recently").memories.map((m) => m.id)).toEqual([oldStrong, newWeak]);
  });

  test("a question that is only a soft word keeps the past week as its filter; explicit windows are unchanged", () => {
    const c = brain();
    seed(c);
    const recent = c.store.put({ type: "memory", kind: "fact", body: "Moved the zqdesk to the window.", occurredOn: "2026-10-01" });
    c.store.put({ type: "memory", kind: "fact", body: "Bought the zqdesk.", occurredOn: "2026-05-01" });
    const thin = ask(c, "what happened lately?");
    expect(thin.time?.soft).toBeUndefined();
    expect(thin.time?.window).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(thin.memories.map((m) => m.id)).toContain(recent);
    expect(renderFacts(thin)).toContain("time: lately → 09-27..10-03");
    // "last week" still filters, as before.
    const week = ask(c, "the zqdesk last week");
    expect(week.time?.soft).toBeUndefined();
    expect(week.memories).toEqual([]);
    expect(week.time?.outside).toBe(2);
    const oct = ask(c, "the zqdesk in October");
    expect(oct.memories.map((m) => m.id)).toEqual([recent]);
    expect(oct.time?.outside).toBe(1);
  });

  // Review of #544.
  test("a soft word beside an explicit window is not searched for; inside another word, or another language, it is nothing", () => {
    // "recently, in September": September, and "recently" is not left as a word to match.
    const sept = readTimeAsk("the zqgym recently, in September", clock);
    expect(sept?.cue).toBe("in September");
    expect(sept?.rest).not.toMatch(/recently/i);
    expect(readTimeAsk("lately, since 9/12 the zqgym", clock)?.rest).not.toMatch(/lately/i);
    expect(readTimeAsk("the zqgym recentlyish", clock)).toBeNull();
    expect(readTimeAsk("the latelyness of the zqgym", clock)).toBeNull();
    for (const q of ["¿qué pasó recientemente?", "最近どう？", "что нового в последнее время"]) expect(readTimeAsk(q, clock)).toBeNull();
    const c = brain();
    seed(c);
    const plain = c.store.put({ type: "memory", kind: "fact", body: "Joined the zqgym on the corner, with a long note about the lockers.", occurredOn: "2026-09-10" });
    // Says "recently": the word must not lift it over the other.
    const says = c.store.put({ type: "memory", kind: "fact", body: "Recently paused the zqgym plan.", occurredOn: "2026-09-12" });
    const r = ask(c, "the zqgym recently, in September");
    expect(r.time?.soft).toBeUndefined();
    expect(r.time?.cue).toBe("in September");
    const without = ask(c, "the zqgym in September");
    expect(r.memories.map((m) => m.id)).toEqual(without.memories.map((m) => m.id));
    expect(r.memories.map((m) => m.id).sort()).toEqual([plain, says].sort());
    expect(r.memories.map((m) => m.ways)).toEqual(without.memories.map((m) => m.ways));
  });
});
