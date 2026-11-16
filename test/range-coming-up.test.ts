/**
 * A RANGE-DATED REMINDER IN "COMING UP" (2026-11-16, Mike's go).
 *
 * A memory dated `2026-10-16..2026-10-18` never showed in the wake's "Coming
 * up" — not before, during or after its span — while the same memory dated
 * `2026-10-16` was counted two days ahead, due on its day and overdue after.
 * `Prospective.horizon()` left every non-day date out (tune question (c)). A
 * range now counts like a day item whose day runs from its first day to its
 * last: coming up before it starts, due today on each day inside it (the line
 * says the span), overdue after its last day in a day item's words. A month
 * still takes no wake line, on purpose.
 *
 * Through the real wake, both roads: the composition (`rebrief` + `wake`, the
 * shape off) and the shaped wake (WK2, the shape on). Hermetic: a fresh temp
 * dir per test, removed afterwards; invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { happenedAlready } from "../src/core/counterpart-wake-news.js";
import { arrivingTense } from "../src/core/self/briefing-delivery.js";
import { FRAMING } from "../src/core/self/index.js";
import { daySpan, shortRange } from "../src/core/time.js";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-range-up-"));
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

const FILLER = ["Ran the morning loop around the reservoir.", "Prefers dense espresso over filter coffee.", "The library closes early on Sundays now."];
const RANGE = "2026-10-16..2026-10-18";
const DAY = "2026-10-16";

function brain(date: string, shaped: boolean, more: { status?: "planned" } = {}): { c: Counterpart; id: string } {
  const c = Counterpart.open({ dir: mkdtempSync(join(dir, "store-")), timeZone: "UTC" });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, shaped ? "on" : "off");
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
  const id = c.store.put({
    type: "memory",
    kind: "person",
    ...(more.status === undefined ? {} : { status: more.status }),
    title: "Coast trip",
    body: "The coast trip runs over the long weekend and the cabin is booked.",
    learnedOn: "2026-08-25",
    eventDate: date,
    salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 },
  });
  return { c, id };
}

/** The wake composed for `at` and read on `read` (the same day unless told). */
function wakeOn(c: Counterpart, at: string, read = at): string {
  c.rebrief({ budgetBytes: 20_000, at });
  return c.wake(20_000, { date: read }).text;
}

/** "Coming up" and the lines under it, to the blank line. */
function comingUp(text: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith("Coming up"));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i; j < lines.length && lines[j] !== ""; j++) out.push(lines[j] ?? "");
  return out;
}

const times = (text: string, id: string): number => text.split(id).length - 1;

describe("the composition (shape off)", () => {
  test("a range: counted before, due on each of its days with its span, overdue after in a day item's words", () => {
    const { c, id } = brain(RANGE, false);
    const before = wakeOn(c, "2026-10-14");
    expect(comingUp(before)[0]).toBe('Coming up: 1 — none due today; recall "still open" lists them');
    expect(before).not.toContain("Coast trip runs");
    for (const at of ["2026-10-16", "2026-10-17", "2026-10-18"]) {
      const w = wakeOn(c, at);
      expect(comingUp(w)).toEqual(["Coming up:", `- Aug 25 (due Oct 16–18) · The coast trip runs over the long weekend and the cabin is booked. [${id}]`]);
      expect(times(w, id)).toBe(1);
    }
    const after = wakeOn(c, "2026-10-19");
    expect(comingUp(after)).toEqual(["Coming up:", `- Aug 25 (was due yesterday, Oct 16–18) · The coast trip runs over the long weekend and the cabin is booked. [${id}]`]);
    expect(times(after, id)).toBe(1);
    expect(comingUp(wakeOn(c, "2026-10-21"))[1]).toBe(`- Aug 25 (was due Oct 16–18, 3 days ago) · The coast trip runs over the long weekend and the cabin is booked. [${id}]`);
  });

  test("composed one evening, read the next morning: inside the span it stays due; the day after its last it was due yesterday", () => {
    const { c, id } = brain(RANGE, false);
    expect(comingUp(wakeOn(c, "2026-10-16", "2026-10-17"))[1]).toBe(`- Aug 25 (due Oct 16–18) · The coast trip runs over the long weekend and the cabin is booked. [${id}]`);
    expect(comingUp(wakeOn(c, "2026-10-18", "2026-10-19"))[1]).toBe(`- Aug 25 (was due yesterday, Oct 16–18) · The coast trip runs over the long weekend and the cabin is booked. [${id}]`);
  });

  test("control: a day item reads byte for byte as before", () => {
    const { c, id } = brain(DAY, false);
    expect(comingUp(wakeOn(c, "2026-10-14"))[0]).toBe('Coming up: 1 — none due today; recall "still open" lists them');
    const body = "The coast trip runs over the long weekend and the cabin is booked.";
    expect(comingUp(wakeOn(c, "2026-10-16"))).toEqual(["Coming up:", `- Aug 25 (due Oct 16) · ${body} [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-17"))).toEqual(["Coming up:", `- Aug 25 (was due yesterday, Oct 16) · ${body} [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-19"))).toEqual(["Coming up:", `- Aug 25 (was due Oct 16, 3 days ago) · ${body} [${id}]`]);
  });
});

describe("the shaped wake (shape on)", () => {
  test("a range: later by both ends, due today with its span, then overdue from its last day", () => {
    const { c, id } = brain(RANGE, true);
    expect(comingUp(wakeOn(c, "2026-10-14"))).toEqual(["Coming up:", `- 10-16–10-18 · Coast trip [${id}]`]);
    for (const at of ["2026-10-16", "2026-10-17", "2026-10-18"]) {
      const w = wakeOn(c, at);
      expect(comingUp(w)).toEqual(["Coming up:", `- Due today (10-16–10-18) · Coast trip [${id}]`]);
      expect(times(w, id)).toBe(1);
    }
    const after = wakeOn(c, "2026-10-19");
    expect(comingUp(after)).toEqual(["Coming up:", `- 1 day overdue · Coast trip [${id}]`]);
    expect(times(after, id)).toBe(1);
    expect(comingUp(wakeOn(c, "2026-10-21"))).toEqual(["Coming up:", `- 3 days overdue · Coast trip [${id}]`]);
  });

  test("a one-day range reads as its day, and its overdue line doesn't throw the shape off", () => {
    const { c, id } = brain("2026-10-16..2026-10-16", true);
    expect(comingUp(wakeOn(c, "2026-10-14"))).toEqual(["Coming up:", `- 10-16 · Coast trip [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-16"))).toEqual(["Coming up:", `- Due today · Coast trip [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-17"))).toEqual(["Coming up:", `- 1 day overdue · Coast trip [${id}]`]);
  });

  test("control: a day item reads byte for byte as before", () => {
    const { c, id } = brain(DAY, true);
    expect(comingUp(wakeOn(c, "2026-10-14"))).toEqual(["Coming up:", `- 10-16 · Coast trip [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-16"))).toEqual(["Coming up:", `- Due today · Coast trip [${id}]`]);
    expect(comingUp(wakeOn(c, "2026-10-17"))).toEqual(["Coming up:", `- 1 day overdue · Coast trip [${id}]`]);
  });
});

describe("an open item dated as a range is said once", () => {
  test("planned work over a range: in Coming up, not also in Still open, on both roads", () => {
    for (const shaped of [false, true]) {
      const { c, id } = brain(RANGE, shaped, { status: "planned" });
      for (const at of ["2026-10-17", "2026-10-19"]) {
        const w = wakeOn(c, at);
        expect(comingUp(w).join("\n")).toContain(id);
        expect(times(w, id)).toBe(1);
      }
    }
  });
});

describe("the doors: recall `coming up` and `still open`", () => {
  test("a range sits under later, then today, then overdue, with its date as stated", () => {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const c = Counterpart.open({ dir: mkdtempSync(join(dir, "store-")), timeZone: "UTC", now: () => clock });
    open.push(c);
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    const id = c.store.put({ type: "memory", kind: "person", title: "Coast trip", body: "The coast trip runs over the long weekend.", learnedOn: "2026-08-25", eventDate: RANGE, salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 } });
    const on = (ymd: string): void => {
      clock = Date.parse(`${ymd}T12:00:00Z`);
    };
    const bucket = (): string => {
      const u = c.comingUp();
      return u.today.some((x) => x.id === id) ? "today" : u.overdue.some((x) => x.id === id) ? "overdue" : u.later.some((x) => x.id === id) ? "later" : "none";
    };
    const listed = () => c.stillOpen().comingUp.find((x) => x.id === id);
    on("2026-10-14");
    expect(bucket()).toBe("later");
    expect(listed()).toEqual({ id, title: "Coast trip", due: RANGE });
    on("2026-10-17");
    expect(bucket()).toBe("today");
    expect(listed()?.overdue).toBeUndefined();
    on("2026-10-19");
    expect(bucket()).toBe("overdue");
    expect(listed()).toEqual({ id, title: "Coast trip", due: RANGE, overdue: true });
  });
});

describe("a month still takes no line in Coming up (tune question (c))", () => {
  test("on both roads, before, inside and after its month", () => {
    for (const shaped of [false, true]) {
      const { c, id } = brain("2026-10", shaped);
      for (const at of ["2026-09-29", "2026-10-16", "2026-11-02"]) expect(comingUp(wakeOn(c, at)).join("\n")).not.toContain(id);
    }
  });
});

describe("the date words", () => {
  test("shortRange: one month, two months, another year; null for anything not a range", () => {
    expect(shortRange(RANGE, "2026")).toBe("Oct 16–18");
    expect(shortRange("2026-10-30..2026-11-02", "2026")).toBe("Oct 30–Nov 2");
    expect(shortRange("2026-12-30..2027-01-02", "2026")).toBe("Dec 30–2027-01-02");
    expect(shortRange("2026-10-16..2026-10-16", "2026")).toBe("Oct 16");
    expect(shortRange(DAY, "2026")).toBeNull();
    expect(shortRange("2026-10", "2026")).toBeNull();
  });

  test("daySpan: a day and a range; a month and a year are not spans", () => {
    expect(daySpan(DAY)).toEqual({ first: DAY, last: DAY });
    expect(daySpan(RANGE)).toEqual({ first: "2026-10-16", last: "2026-10-18" });
    expect(daySpan("2026-10")).toBeNull();
    expect(daySpan("2026")).toBeNull();
  });

  test("arrivingTense reads a span by its last day", () => {
    const lane = (line: string): string => `${FRAMING.horizon}\n${line}\n`;
    expect(arrivingTense(lane("- Aug 25 (due Oct 16–18) · x [mem_a]"), "2026-10-18", 100)).toBe(lane("- Aug 25 (due Oct 16–18) · x [mem_a]"));
    expect(arrivingTense(lane("- Aug 25 (due Oct 16–18) · x [mem_a]"), "2026-10-19", 100)).toBe(lane("- Aug 25 (was due yesterday, Oct 16–18) · x [mem_a]"));
    expect(arrivingTense(lane("- Aug 25 (due Oct 30–Nov 2) · x [mem_a]"), "2026-11-03", 100)).toBe(lane("- Aug 25 (was due yesterday, Oct 30–Nov 2) · x [mem_a]"));
    expect(arrivingTense(lane("- Aug 25 (due Oct 30–Nov 2) · x [mem_a]"), "2026-11-01", 100)).toBe(lane("- Aug 25 (due Oct 30–Nov 2) · x [mem_a]"));
  });
});

const SAL = { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 };

/** A brain on a clock the test moves, in UTC. */
function clocked(start: string): { c: Counterpart; on(stamp: string): void } {
  let clock = Date.parse(start);
  const c = Counterpart.open({ dir: mkdtempSync(join(dir, "store-")), timeZone: "UTC", now: () => clock });
  open.push(c);
  return { c, on: (stamp) => void (clock = Date.parse(stamp)) };
}

describe("overdue order: a range by its last day (review of #833)", () => {
  test("a range 10-01..10-20 and a day 10-15, both overdue on 10-21: ordered by the day each became overdue, on both roads and the doors", () => {
    const { c } = clocked("2026-10-21T12:00:00Z");
    const put = (title: string, eventDate: string): string => c.store.put({ type: "memory", kind: "person", title, body: `${title}, as planned.`, learnedOn: "2026-08-25", eventDate, salience: SAL });
    const range = put("Harbour survey", "2026-10-01..2026-10-20");
    const day = put("Kiln repair", "2026-10-15");
    // Newest overdue first: the range (overdue from 10-20), then the day (from 10-15).
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    expect(comingUp(wakeOn(c, "2026-10-21"))).toEqual(["Coming up:", `- 1 day overdue · Harbour survey [${range}]`, `- 6 days overdue · Kiln repair [${day}]`]);
    expect(c.comingUp().overdue.map((x) => x.id)).toEqual([range, day]);
    // The `still open` door and the composition: the oldest first, the day, then the range.
    expect(c.stillOpen().comingUp.map((x) => x.id)).toEqual([day, range]);
    c.store.setMeta(WAKE_SHAPE_KEY, "off");
    const lines = comingUp(wakeOn(c, "2026-10-21"));
    const at = (id: string): number => lines.findIndex((l) => l.includes(id));
    expect(at(day)).toBeGreaterThan(0);
    expect(at(day)).toBeLessThan(at(range));
  });
});

describe("already happened: a range settles only once its last day has come (review of #833)", () => {
  const item = (c: Counterpart, eventDate: string): string =>
    c.store.put({ type: "memory", kind: "fact", title: "Seal Rock cabin trip", body: "Seal Rock cabin trip with the cousins.", status: "planned", eventDate, salience: SAL });
  const done = (c: Counterpart): string =>
    c.store.put({ type: "memory", kind: "fact", title: "Seal Rock cabin trip went well", body: "Seal Rock cabin trip went well, first day.", status: "done", salience: SAL });

  test("a done memory written on its first day settles nothing until its last day", () => {
    const { c, on } = clocked("2026-10-10T12:00:00Z");
    const id = item(c, RANGE);
    on("2026-10-16T18:00:00Z");
    const d = done(c);
    expect(happenedAlready(c.store, id, "2026-10-16")).toBeNull();
    expect(happenedAlready(c.store, id, "2026-10-17")).toBeNull();
    expect(happenedAlready(c.store, id, "2026-10-18")).toBe(d);
    expect(happenedAlready(c.store, id, "2026-10-19")).toBe(d);
  });

  test("control: the same item dated as a day settles on its day, as before", () => {
    const { c, on } = clocked("2026-10-10T12:00:00Z");
    const id = item(c, DAY);
    on("2026-10-16T18:00:00Z");
    const d = done(c);
    expect(happenedAlready(c.store, id, "2026-10-15")).toBeNull();
    expect(happenedAlready(c.store, id, "2026-10-16")).toBe(d);
  });
});
