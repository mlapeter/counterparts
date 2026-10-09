/**
 * The dashboard's one date style (2026-09-30): "Sep 30th", the year when it is
 * not this one or when asked for, the weekday where a title wants it. Pure
 * functions in `web/shared/dates.js`; every page and the server's own
 * sentences go through them.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// @ts-expect-error — a plain browser module, no declarations
import { dateOr, dateWords, localIso, ordinal, stampWords } from "../src/adapters/dashboard/web/shared/dates.js";

const WEB = join(import.meta.dir, "..", "src", "adapters", "dashboard", "web");
/** The memory card touches `window` at load (`window.openMemory = …`); give it one. */
(globalThis as { window?: unknown }).window ??= globalThis;

const THIS_YEAR = new Date().getFullYear();

describe("the dashboard's dates", () => {
  test("a day reads as words, with its ordinal", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
    expect([21, 22, 23, 30, 31].map(ordinal)).toEqual(["21st", "22nd", "23rd", "30th", "31st"]);
    expect(dateWords("2026-09-30", { year: true })).toBe("Sep 30th, 2026");
    expect(dateWords("2026-09-30", { year: false })).toBe("Sep 30th");
    expect(dateWords("2026-01-01", { year: false })).toBe("Jan 1st");
  });

  test("the year is left out only when it is this one", () => {
    expect(dateWords(`${THIS_YEAR}-03-02`)).toBe("Mar 2nd");
    expect(dateWords(`${THIS_YEAR - 1}-03-02`)).toBe(`Mar 2nd, ${THIS_YEAR - 1}`);
  });

  test("a title can carry the weekday", () => {
    expect(dateWords("2026-09-30", { weekday: true, year: false })).toBe("Wed, Sep 30th");
    expect(dateWords("2026-09-27", { weekday: true, year: true })).toBe("Sun, Sep 27th, 2026");
  });

  test("what is not a calendar day is never dressed up as one", () => {
    for (const x of [null, undefined, "", "lived day 3", "2026-09", "2026-13-01", "2026-09-30T10:00:00Z", "Sep 30"]) {
      expect(dateWords(x)).toBeNull();
    }
    expect(dateOr("2026-10")).toBe("2026-10");
    expect(dateOr(null)).toBe("");
    expect(dateOr("2026-09-30", { year: true })).toBe("Sep 30th, 2026");
  });

  test("a timestamp keeps its minute and says which clock", () => {
    expect(stampWords("2026-09-30T17:47:03.000Z")).toBe("Sep 30th, 2026, 17:47 UTC");
    expect(stampWords("not a stamp")).toBe("not a stamp");
    expect(localIso(new Date(2026, 8, 5, 12).getTime())).toBe("2026-09-05");
  });

  test("the memory card prints its dates in words, never as 2026-09-30", async () => {
    const { memoryCard } = (await import(join(WEB, "shared/memory-modal.js"))) as { memoryCard(d: Record<string, unknown>): string };
    const createdAt = Date.UTC(2026, 8, 28, 17, 47);
    const html = memoryCard({
      id: "mem_1", kind: "fact", title: "A title", text: "Some words.", shownText: "Some words.", confidential: false,
      archived: null, journal: false, chapter: false, curve: null, curveNote: null,
      salience: { relevance: 0, emotional: 0, predictive: 0, novelty: 0, combined: 0, claimed: null },
      createdAt, learnedOn: "2026-09-28", happenedOn: "2026-09-27", eventDate: "2026-10-02",
      writtenDate: "2026-09-26", prospective: [{ date: "2026-10-02", state: "waiting" }],
      uses: 0, useDays: [], bornDay: 3, day: 5, lastUsedDay: 3, reinforcedDays: 0, promotion: null, promoted: false, protected: false,
      pressure: 0, bar: null, feelings: [], intensity: 0, points: [], edges: [], timeline: [], revision: 1, contentHash: "h",
      band: "episodic", recordedBand: "episodic", strength: 0.5, repetition: 0, consolidated: false, removal: [],
    });
    // Written on this computer's calendar: Sep 28th in most of the world, the 29th at UTC+14.
    expect(html).toContain(`Written ${dateWords(localIso(createdAt), { year: true })}`);
    expect(html).toContain("about Oct 2nd, 2026");
    expect(html).toContain("happened Sep 27th, 2026");
    expect(html).toContain("recorded Sep 28th, 2026");
    expect(html).toContain("reminder Oct 2nd, 2026 · waiting");
    expect(html).toContain("Sep 28th, 2026, 17:47 UTC");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("the card's written day is the local one, at either end of the day", async () => {
    // The UTC day it used to read put a Denver evening's memory on tomorrow, and a
    // Tokyo morning's on yesterday. Half past midnight and half past eleven, both
    // local, are the 28th in every zone; only under UTC can the old reading pass.
    const { writtenOn } = (await import(join(WEB, "shared/memory-modal.js"))) as { writtenOn(d: Record<string, unknown>): string | null };
    expect(writtenOn({ createdAt: new Date(2026, 8, 28, 0, 30).getTime() })).toBe("2026-09-28");
    expect(writtenOn({ createdAt: new Date(2026, 8, 28, 23, 30).getTime() })).toBe("2026-09-28");
    // No moment: the recorded day, as it was written.
    expect(writtenOn({ createdAt: null, learnedOn: "2026-09-27" })).toBe("2026-09-27");
  });
});
