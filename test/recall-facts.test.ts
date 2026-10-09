/**
 * FACTS MODE — `recall` with `mode: "facts"` (Release B of deliberate recall,
 * 2026-10-03; `src/adapters/mcp/facts.ts`, `src/core/recall/time-ask.ts`).
 *
 * Every match by words, subjects and time, the closest by meaning capped;
 * ranked by match strength (several ways rank higher), recency only on a tie;
 * a time window filters and counts what fell outside; each fact's labeled
 * lines (who said it, its status, when it happened and was learned, CURRENT);
 * earlier versions folded, corrected ones hidden and counted; faded ones
 * listed after; a count header, pages, the 12,000-character room; and a
 * quote of a shown memory credited at the boundary.
 *
 * Hermetic: every test makes its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { RECALL_RESULT_CHARS, hasFaded } from "../src/adapters/mcp/deliberate.js";
import { FACTS_PAGE_SIZE, factsRecall, renderFacts } from "../src/adapters/mcp/facts.js";
import { meaningRecall, renderMeaning } from "../src/adapters/mcp/meaning.js";
import type { FactsResult } from "../src/adapters/mcp/facts.js";
import { settle } from "../src/core/contradictions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { OPEN_END, OPEN_START, loadGateState, readTimeAsk } from "../src/core/recall/index.js";

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
  const c = Counterpart.open({ dir: join(dir, "store"), owner: true, now: () => now, timeZone: ZONE });
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
    expect(text).toContain("you said · done · happened 09-28");
    expect(text).toMatch(/learned 10-03 in \/scope\/one · this session · CURRENT/);
    // Unknown fields say so: most rows predate v12.
    expect(text).toContain("speaker unknown · status unknown · no event date");
  });

  test("a planned thing is FOR its date, not happened on it", () => {
    const c = brain();
    seed(c);
    c.store.put({ type: "memory", kind: "fact", body: "The zqdentist visit is booked.", saidBy: "self", status: "planned", occurredOn: "2026-10-20" });
    expect(renderFacts(ask(c, "zqdentist"))).toContain("I said · planned · for 10-20");
  });
});

describe("current first: earlier versions fold, corrected ones are hidden and counted", () => {
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

  test("a corrected version is out of the answer and counted on the one that holds", () => {
    const c = brain();
    seed(c);
    const wrong = c.store.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 4." });
    const right = c.store.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 9." });
    expect(settle(c.store, { holds: right, over: wrong, how: "corrected", why: "it was pier 9", actor: "session" }).ok).toBe(true);
    const r = ask(c, "zqboat pier");
    expect(r.memories.map((m) => m.id)).toEqual([right]);
    expect(r.memories[0]?.corrected).toBe(1);
    expect(renderFacts(r)).toContain("1 corrected version hidden");
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
  test("faded memories are listed after, a line each, never in the main slots", () => {
    const c = brain();
    seed(c);
    const live = c.store.put({ type: "memory", kind: "fact", body: "The zqlamp needs a new bulb." });
    const faded = c.store.put({ type: "memory", kind: "fact", title: "Old zqlamp", body: "The zqlamp was bought at the market." });
    c.store.updatePhysics(faded, { fade: 0.1 });
    expect(hasFaded(c.store.physicsOf(faded), c.store.livedDay())).toBe(true);
    const r = ask(c, "zqlamp");
    expect(r.memories.map((m) => m.id)).toEqual([live]);
    expect(r.faded.map((f) => f.id)).toEqual([faded]);
    const text = renderFacts(r);
    expect(text.split("\n")[0]).toContain("1 faded, listed after");
    expect(text).toContain(`- Old zqlamp · 10-03 · ${faded} · faded`);
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
    const before = body(await s.call("note", { feelingsNow: [{ id: moment, core: "calm", emotion: "content", strength: 0.5 }] }));
    expect((before["feelingsNow"] as { recorded: number }).recorded).toBe(0);
    const out = body(await s.call("recall", { question: "What has Zorabel been to me?", mode: "meaning" }));
    expect(out["mode"]).toBe("meaning");
    expect(out["reason"]).toBe("answered");
    const direct = meaningRecall({ counterpart: c, sessionId: SESSION, owner: true }, "What has Zorabel been to me?");
    expect(out["answer"]).toBe(renderMeaning(direct));
    expect(out["ids"]).toEqual([...direct.shown]);
    expect(direct.shown).toContain(moment);
    // Seen: the feeling now is recorded. Quotable: the `asked` record names it.
    const after = body(await s.call("note", { feelingsNow: [{ id: moment, core: "calm", emotion: "content", strength: 0.5 }] }));
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
});
