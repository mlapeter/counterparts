/**
 * The dashboard's one date style (2026-09-30): "Sep 30th", the year when it is
 * not this one or when asked for, the weekday where a title wants it. Pure
 * functions in `web/shared/dates.js`; every page and the server's own
 * sentences go through them.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// @ts-expect-error — a plain browser module, no declarations
import { dateOr, dateWords, ordinal } from "../src/adapters/dashboard/web/shared/dates.js";
import { writtenWhen } from "../src/adapters/dashboard/web/views/memory.js";
import { startOfLocalDay } from "../src/core/time.js";

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

  test("a moment is dated by the server, in the zone it is handed, with its clock named", () => {
    // The browser no longer turns a moment into a day (2026-10-09): the server
    // does, in the person's zone, and the page prints what it is handed.
    const at = Date.UTC(2026, 8, 30, 17, 47, 3);
    expect(writtenWhen(at, "2026-09-30", "America/Denver")).toEqual({ writtenOn: "2026-09-30", writtenClock: "11:47 MDT" });
    expect(writtenWhen(at, "2026-09-30", "UTC")).toEqual({ writtenOn: "2026-09-30", writtenClock: "17:47 UTC" });
    expect(writtenWhen(at, "2026-10-01", "Pacific/Kiritimati")).toEqual({ writtenOn: "2026-10-01", writtenClock: "07:47 GMT+14" });
    // No moment: the recorded day as written, and no clock.
    expect(writtenWhen(null, "2026-09-27", "UTC")).toEqual({ writtenOn: "2026-09-27", writtenClock: null });
    expect(writtenWhen(null, "—", "UTC")).toEqual({ writtenOn: null, writtenClock: null });
  });

  test("the memory card prints its dates in words, never as 2026-09-30", async () => {
    const { memoryCard } = (await import(join(WEB, "shared/memory-modal.js"))) as { memoryCard(d: Record<string, unknown>): string };
    const createdAt = Date.UTC(2026, 8, 28, 17, 47);
    const html = memoryCard({
      id: "mem_1", kind: "fact", title: "A title", text: "Some words.", shownText: "Some words.", confidential: false,
      archived: null, journal: false, chapter: false, curve: null, curveNote: null,
      salience: { relevance: 0, emotional: 0, predictive: 0, novelty: 0, combined: 0, claimed: null },
      createdAt, writtenOn: "2026-09-28", writtenClock: "11:47 MDT",
      learnedOn: "2026-09-28", happenedOn: "2026-09-27", eventDate: "2026-10-02",
      writtenDate: "2026-09-26", prospective: [{ date: "2026-10-02", state: "waiting" }],
      uses: 0, useDays: [], bornDay: 3, day: 5, lastUsedDay: 3, reinforcedDays: 0, promotion: null, promoted: false, protected: false,
      pressure: 0, bar: null, feelings: [], intensity: 0, points: [], edges: [], timeline: [], revision: 1, contentHash: "h",
      band: "episodic", recordedBand: "episodic", strength: 0.5, repetition: 0, consolidated: false, removal: [],
    });
    // Written on the day the server dated, in the person's zone: never re-dated here.
    expect(html).toContain("Written Sep 28th, 2026");
    expect(html).toContain("about Oct 2nd, 2026");
    expect(html).toContain("happened Sep 27th, 2026");
    expect(html).toContain("recorded Sep 28th, 2026");
    expect(html).toContain("reminder Oct 2nd, 2026 · waiting");
    expect(html).toContain("Sep 28th, 2026, 11:47 MDT");
    expect(html).not.toContain("UTC");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("the card's written day is the local one, at either end of the day", async () => {
    // The UTC day it used to read put a Denver evening's memory on tomorrow, and a
    // Tokyo morning's on yesterday. Half past midnight and half past eleven, both
    // local, are the 28th in every zone; only under UTC can the old reading pass.
    // Dated by the server in the zone it is handed (2026-10-09), in four zones.
    const { writtenOn } = (await import(join(WEB, "shared/memory-modal.js"))) as { writtenOn(d: Record<string, unknown>): string | null };
    for (const zone of ["America/Denver", "Asia/Tokyo", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      const midnight = startOfLocalDay("2026-09-28", zone);
      for (const minutes of [30, 23 * 60 + 30]) {
        const at = midnight + minutes * 60_000;
        const served = writtenWhen(at, "2026-09-27", zone);
        expect(served.writtenOn).toBe("2026-09-28");
        expect(writtenOn({ createdAt: at, ...served })).toBe("2026-09-28");
      }
    }
    // No moment: the recorded day, as it was written.
    expect(writtenOn({ createdAt: null, ...writtenWhen(null, "2026-09-27", "UTC") })).toBe("2026-09-27");
    // The page never dates a moment itself: a payload without the served day says nothing.
    expect(writtenOn({ createdAt: Date.UTC(2026, 8, 28, 12) })).toBeNull();
  });
});
