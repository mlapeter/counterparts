/**
 * THE CALENDAR DAY IS THE PERSON'S — owner's ruling 2026-09-23 (roadmap B3).
 *
 * The six-a-day ask cap reset at UTC midnight (18:00 for an owner at UTC−6) and
 * the "nightly" page writer turned over at about 17:00 Pacific
 * (`claude-code/INTERFACE-GAPS` §13). Both now take the calendar day in the
 * machine's LOCAL zone (`core/self/calendar.ts`). Two other clocks must not
 * move: the LIVED day (physics) and the PROVENANCE date (`learned_on`, UTC).
 *
 * Every test here PINS the zone it means — `Self` takes one, and the helper
 * takes one — so the suite reads the same under `TZ=UTC`, `TZ=America/Chicago`
 * or any other zone the machine happens to be in. The one test of the default
 * compares it with the machine's own getters, which is what "local" means.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { pageWriterFindings } from "../src/adapters/claude-code/index.js";
import {
  Self,
  calendarDate,
  pageWriterAbout,
  pageWriterNight,
} from "../src/core/self/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-local-day-"));
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A store on a clock the test turns by hand. */
function clocked(start: string): { store: Store; set(iso: string): void } {
  let at = Date.parse(start);
  const store = Store.open({ dir, now: () => at });
  open.push(store);
  return {
    store,
    set(iso: string): void {
      at = Date.parse(iso);
    },
  };
}

const SUBSTANCE = { turns: 9, bytes: 6_000 };

// ═══════════════════════════════════════════════════════════════════════════
describe("the helper", () => {
  test("one instant, three zones, three honest dates", () => {
    // 01:30 UTC on the 19th is still the evening of the 18th in Chicago, and
    // already the morning of the 19th in Tokyo.
    const at = Date.parse("2026-09-19T01:30:00Z");
    expect(calendarDate(at, "UTC")).toBe("2026-09-19");
    expect(calendarDate(at, "America/Chicago")).toBe("2026-09-18");
    expect(calendarDate(at, "Asia/Tokyo")).toBe("2026-09-19");
    // And across a year boundary, where string arithmetic most often slips.
    const newYear = Date.parse("2027-01-01T03:00:00Z");
    expect(calendarDate(newYear, "America/Los_Angeles")).toBe("2026-12-31");
    expect(calendarDate(newYear, "UTC")).toBe("2027-01-01");
  });

  test("no zone means the MACHINE's zone — the same answer the Date getters give", () => {
    for (const iso of ["2026-09-19T01:30:00Z", "2026-09-19T12:00:00Z", "2026-09-19T23:30:00Z"]) {
      const d = new Date(Date.parse(iso));
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      expect(calendarDate(d.getTime())).toBe(local);
    }
  });

  test("an unreadable zone falls back to the machine's day rather than throwing inside a hook", () => {
    const at = Date.parse("2026-09-19T12:00:00Z");
    expect(calendarDate(at, "Not/AZone")).toBe(calendarDate(at));
    expect(calendarDate(Number.NaN)).toBe("");
  });

  test("a Counterpart built with no zone decides its days on the machine's clock, off the STORE's instant", () => {
    const at = Date.parse("2026-09-19T01:30:00Z");
    const c = Counterpart.open({ dir, now: () => at });
    open.push(c);
    expect(c.self.calendarToday()).toBe(calendarDate(at));
    // The provenance date is untouched: still UTC, still `store/`'s.
    expect(c.store.today()).toBe("2026-09-19");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the ask cap turns over at LOCAL midnight", () => {
  test("Chicago: capped at 18:30, STILL capped at 20:00 (past UTC midnight), refilled at 00:30", () => {
    const t = clocked("2026-09-18T23:30:00Z"); // 18:30 CDT, the 18th
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 2 }, zone: "America/Chicago" });
    expect(self.openChapter("s1", SUBSTANCE, 4).asked).toBe(true);
    expect(self.openChapter("s1", { turns: 18, bytes: 15_000 }, 4).asked).toBe(true);
    expect(self.openChapter("s1", { turns: 30, bytes: 25_000 }, 4).verdict.reason).toBe("session-ask-cap");
    expect(self.episodeState("s1", 4).asksDay).toBe("2026-09-18");

    // 20:00 CDT: UTC has already turned over to the 19th. Under the old key
    // this is exactly where the evening's allowance came back.
    t.set("2026-09-19T01:00:00Z");
    expect(t.store.today()).toBe("2026-09-19");
    const evening = self.openChapter("s1", { turns: 42, bytes: 35_000 }, 4);
    expect(evening.asked).toBe(false);
    expect(evening.verdict.reason).toBe("session-ask-cap");

    // 00:30 CDT on the 19th: the person's day has turned. A fresh allowance.
    t.set("2026-09-19T05:30:00Z");
    const morning = self.openChapter("s1", { turns: 54, bytes: 45_000 }, 4);
    expect(morning.asked).toBe(true);
    expect(self.episodeState("s1", 4).asksDay).toBe("2026-09-19");
    expect(self.episodeState("s1", 4).asksToday).toBe(1);
  });

  test("the same instants in UTC refill at UTC midnight — the zone is the only thing that differs", () => {
    const t = clocked("2026-09-18T23:30:00Z");
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 2 }, zone: "UTC" });
    expect(self.openChapter("s1", SUBSTANCE, 4).asked).toBe(true);
    expect(self.openChapter("s1", { turns: 18, bytes: 15_000 }, 4).asked).toBe(true);
    t.set("2026-09-19T01:00:00Z");
    expect(self.openChapter("s1", { turns: 42, bytes: 35_000 }, 4).asked).toBe(true);
  });

  test("askDue reads the same day openChapter charges — a verdict and its advance cannot disagree", () => {
    const t = clocked("2026-09-18T23:30:00Z");
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 1 }, zone: "America/Chicago" });
    expect(self.openChapter("s1", SUBSTANCE, 4).asked).toBe(true);
    t.set("2026-09-19T01:00:00Z");
    expect(self.askDue("s1", { turns: 30, bytes: 30_000 }, 4).reason).toBe("session-ask-cap");
    t.set("2026-09-19T05:30:00Z");
    expect(self.askDue("s1", { turns: 30, bytes: 30_000 }, 4).due).toBe(true);
  });

  test("the LIVED day does not move: nothing here advances the physics clock", () => {
    const t = clocked("2026-09-18T23:30:00Z");
    const before = t.store.livedDay();
    const self = new Self({ store: t.store, zone: "America/Chicago" });
    self.openChapter("s1", SUBSTANCE);
    t.set("2026-09-19T05:30:00Z");
    self.openChapter("s1", { turns: 30, bytes: 30_000 });
    self.pageWriterDue({ mode: "session" });
    expect(t.store.livedDay()).toBe(before);
  });

  test("the day of the change: a UTC-stamped allowance read against a local day refills at most once", () => {
    // A state written by the old build on the UTC date 2026-09-19, read at
    // 20:00 CDT on the 18th: the stamps differ, so it reads as nothing spent —
    // one early refill, which the ruling accepted (self NOTES §22). It never
    // reads as MORE spent than there was.
    const t = clocked("2026-09-19T01:00:00Z");
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 1 }, zone: "America/Chicago" });
    t.store.setMeta(
      "self.episode.s1",
      JSON.stringify({
        sessionId: "s1",
        episodeId: null,
        chapters: 0,
        asks: 1,
        asksToday: 1,
        asksDay: "2026-09-19",
        appendedAtAsk: 0,
        askedAtTurns: 9,
        askedAtBytes: 6_000,
        lastDay: 4,
        ingestedKey: null,
        ingestedMemoryId: null,
        firstIngestDay: null,
      }),
    );
    expect(self.openChapter("s1", { turns: 30, bytes: 30_000 }, 4).asked).toBe(true);
    // ...and from then on the stamp is local, so the cap binds as it should.
    expect(self.episodeState("s1", 4).asksDay).toBe("2026-09-18");
    expect(self.openChapter("s1", { turns: 50, bytes: 50_000 }, 4).verdict.reason).toBe("session-ask-cap");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the page writer's night turns over at LOCAL midnight", () => {
  function memoryOn(store: Store, learnedOn: string): void {
    store.put({ type: "memory", kind: "fact", body: `Something that happened on ${learnedOn}.`, learnedOn });
  }

  test("Chicago at 20:00: UTC has turned, the person's night has NOT — nothing new is owed", () => {
    const t = clocked("2026-09-19T01:00:00Z"); // 20:00 CDT on the 18th
    memoryOn(t.store, "2026-09-17");
    memoryOn(t.store, "2026-09-18");
    const self = new Self({ store: t.store, zone: "America/Chicago" });
    expect(pageWriterNight(t.store, "America/Chicago")).toEqual({ today: "2026-09-18", about: "2026-09-17" });
    const due = self.pageWriterDue({ mode: "session" });
    // The night owed is the 17th — the day before the person's today — and
    // never the 18th, which the person is still living.
    expect(due.about).toBe("2026-09-17");
    expect(due.due).toBe(true);
    // A UTC-keyed writer would have been asking about the 18th already.
    expect(pageWriterAbout(t.store.today())).toBe("2026-09-18");
  });

  test("after local midnight the 18th is owed, and the claim closes when the person's next day begins", () => {
    const t = clocked("2026-09-19T05:30:00Z"); // 00:30 CDT on the 19th
    memoryOn(t.store, "2026-09-18");
    const self = new Self({ store: t.store, zone: "America/Chicago" });
    const due = self.pageWriterDue({ mode: "session" });
    expect(due).toEqual({ due: true, about: "2026-09-18", attempt: 1 });
    expect(self.recordPageWriterRun({ about: "2026-09-18", mode: "session", outcome: "asked" })).toBe(true);
    // The claim is stamped with the day it was MADE on — the local one.
    expect(self.pageWriterRuns({ about: "2026-09-18" })[0]?.on).toBe("2026-09-19");
    expect(self.pageWriterClaimOpen("2026-09-18")).toBe(true);

    // 23:00 CDT on the 19th: UTC is already the 20th, the claim is still live.
    t.set("2026-09-20T04:00:00Z");
    expect(self.pageWriterClaimOpen("2026-09-18")).toBe(true);
    expect(self.pageWriterStatus("2026-09-18").outcome).toBe("asked");

    // 00:30 CDT on the 20th: the day that made the claim is over.
    t.set("2026-09-20T05:30:00Z");
    expect(self.pageWriterClaimOpen("2026-09-18")).toBe(false);
    const status = self.pageWriterStatus("2026-09-18");
    expect(status.outcome).toBe("nothing-to-say");
    expect(status.derived).toBe(true);
  });

  test("EAST of UTC the night waits for its UTC date to close — a store made this morning still has no yesterday", () => {
    // 01:00 in Tokyo on the 20th is 16:00 UTC on the 19th. The local
    // yesterday (the 19th) is a UTC date still being written, and the rows
    // stamped with it are hours old.
    const t = clocked("2026-09-19T16:00:00Z");
    memoryOn(t.store, t.store.today()); // learned "today", by the store's own UTC stamp
    const self = new Self({ store: t.store, zone: "Asia/Tokyo" });
    expect(self.calendarToday()).toBe("2026-09-20");
    const night = pageWriterNight(t.store, "Asia/Tokyo");
    expect(night).toEqual({ today: "2026-09-20", about: "2026-09-18" });
    const due = self.pageWriterDue({ mode: "session" });
    expect(due.due === false ? due.reason : "due").toBe("no-previous-day");

    // Once UTC's 19th has closed (09:30 in Tokyo on the 20th), it is owed.
    t.set("2026-09-20T00:30:00Z");
    expect(pageWriterNight(t.store, "Asia/Tokyo").about).toBe("2026-09-19");
    expect(self.pageWriterDue({ mode: "session" })).toEqual({ due: true, about: "2026-09-19", attempt: 1 });
  });

  test("WEST of UTC the guard never bites: the night is always the local yesterday", () => {
    for (const iso of ["2026-09-19T05:30:00Z", "2026-09-19T15:00:00Z", "2026-09-20T04:59:00Z"]) {
      const at = Date.parse(iso);
      const t = clocked(iso);
      const local = calendarDate(at, "America/Chicago");
      expect(pageWriterNight(t.store, "America/Chicago")).toEqual({
        today: local,
        about: pageWriterAbout(local),
      });
      t.store.close();
      open.pop();
    }
  });

  test("a caller that names the day gets the plain rule — the day before it, no guard", () => {
    const t = clocked("2026-09-19T16:00:00Z");
    memoryOn(t.store, "2026-09-19");
    const self = new Self({ store: t.store, zone: "Asia/Tokyo" });
    expect(self.pageWriterDue({ mode: "session", today: "2026-09-20" }).about).toBe("2026-09-19");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The boundaries the PR #189 review asked for, and its two repros (M2, m7)
// ═══════════════════════════════════════════════════════════════════════════
/** Run `fn` with the MACHINE's zone pinned (`TZ`), for the one reader that takes
 *  no zone of its own — doctor — and restore it after, whatever happens. */
function inZone<T>(zone: string, fn: () => T): T {
  const prior = process.env["TZ"];
  process.env["TZ"] = zone;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env["TZ"];
    else process.env["TZ"] = prior;
  }
}

describe("the boundaries, by the clock", () => {
  function memoryOn(store: Store, learnedOn: string): void {
    store.put({ type: "memory", kind: "fact", body: `Something that happened on ${learnedOn}.`, learnedOn });
  }

  test("UTC−7 at 23:30 (Los Angeles, PDT): still the 18th — the cap's day and the night are the local ones", () => {
    const t = clocked("2026-09-19T06:30:00Z");
    const self = new Self({ store: t.store, zone: "America/Los_Angeles" });
    expect(t.store.today()).toBe("2026-09-19");
    expect(self.calendarToday()).toBe("2026-09-18");
    expect(pageWriterNight(t.store, "America/Los_Angeles")).toEqual({ today: "2026-09-18", about: "2026-09-17" });
    self.openChapter("s1", SUBSTANCE);
    expect(self.episodeState("s1").asksDay).toBe("2026-09-18");
  });

  test("UTC+9 at 08:00 (Tokyo): the local 19th is still being filed under in UTC, so the night is the 18th until 09:00", () => {
    const t = clocked("2026-09-19T23:00:00Z"); // 08:00 JST on the 20th
    expect(pageWriterNight(t.store, "Asia/Tokyo")).toEqual({ today: "2026-09-20", about: "2026-09-18" });
    t.set("2026-09-20T00:00:00Z"); // 09:00 JST: UTC's 19th has closed
    expect(pageWriterNight(t.store, "Asia/Tokyo")).toEqual({ today: "2026-09-20", about: "2026-09-19" });
  });

  test("00:10 local: the allowance spent at 23:50 is back, and the night just ended is owed", () => {
    const t = clocked("2026-09-19T04:50:00Z"); // 23:50 CDT on the 18th
    memoryOn(t.store, "2026-09-18");
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 1 }, zone: "America/Chicago" });
    expect(self.openChapter("s1", SUBSTANCE, 4).asked).toBe(true);
    expect(self.openChapter("s1", { turns: 30, bytes: 30_000 }, 4).verdict.reason).toBe("session-ask-cap");
    t.set("2026-09-19T05:10:00Z"); // 00:10 CDT on the 19th
    expect(self.openChapter("s1", { turns: 50, bytes: 50_000 }, 4).asked).toBe(true);
    expect(self.pageWriterDue({ mode: "session" })).toEqual({ due: true, about: "2026-09-18", attempt: 1 });
  });

  test("the DST days: a 25-hour day and a 23-hour day are each ONE calendar day", () => {
    // Fall back, 2026-11-01 in Chicago: 00:30 CDT and 23:30 CST are the same date.
    expect(calendarDate(Date.parse("2026-11-01T05:30:00Z"), "America/Chicago")).toBe("2026-11-01");
    expect(calendarDate(Date.parse("2026-11-02T05:30:00Z"), "America/Chicago")).toBe("2026-11-01");
    expect(calendarDate(Date.parse("2026-11-02T06:10:00Z"), "America/Chicago")).toBe("2026-11-02");
    // Spring forward, 2026-03-08: 01:30 CST and 03:30 CDT are the same date.
    expect(calendarDate(Date.parse("2026-03-08T07:30:00Z"), "America/Chicago")).toBe("2026-03-08");
    expect(calendarDate(Date.parse("2026-03-08T08:30:00Z"), "America/Chicago")).toBe("2026-03-08");

    // And the cap is charged once across the whole 25-hour day.
    const t = clocked("2026-11-01T05:30:00Z");
    const self = new Self({ store: t.store, tunables: { MAX_ASKS_PER_SESSION: 1 }, zone: "America/Chicago" });
    expect(self.openChapter("s1", SUBSTANCE, 4).asked).toBe(true);
    t.set("2026-11-02T05:30:00Z"); // 23:30 CST, still the 1st
    expect(self.openChapter("s1", { turns: 30, bytes: 30_000 }, 4).verdict.reason).toBe("session-ask-cap");
    t.set("2026-11-02T06:10:00Z"); // 00:10 CST on the 2nd
    expect(self.openChapter("s1", { turns: 50, bytes: 50_000 }, 4).asked).toBe(true);
    expect(pageWriterNight(t.store, "America/Chicago")).toEqual({ today: "2026-11-02", about: "2026-11-01" });
  });

  test("m7, EAST of UTC: a night whose claim's day has ended is SETTLED, and is not asked about again", () => {
    const t = clocked("2026-09-19T06:00:00Z"); // 15:00 JST on the 19th
    memoryOn(t.store, "2026-09-18");
    memoryOn(t.store, "2026-09-19");
    const self = new Self({ store: t.store, zone: "Asia/Tokyo" });
    expect(self.pageWriterDue({ mode: "session" })).toEqual({ due: true, about: "2026-09-18", attempt: 1 });
    self.recordPageWriterRun({ about: "2026-09-18", mode: "session", outcome: "asked" });

    t.set("2026-09-19T16:00:00Z"); // 01:00 JST on the 20th — the night is still held to the 18th
    const status = self.pageWriterStatus("2026-09-18");
    expect({ outcome: status.outcome, derived: status.derived }).toEqual({ outcome: "nothing-to-say", derived: true });
    expect(self.pageWriterClaimOpen("2026-09-18")).toBe(false);
    // The three readings agree: settled, closed, and NOT asked again.
    const due = self.pageWriterDue({ mode: "session" });
    expect(due).toEqual({ due: false, about: "2026-09-18", reason: "already-claimed" });

    t.set("2026-09-20T00:30:00Z"); // 09:30 JST — UTC's 19th has closed, and it is owed
    expect(self.pageWriterDue({ mode: "session" })).toEqual({ due: true, about: "2026-09-19", attempt: 1 });
  });

  test("M2, doctor: the evening in Chicago reads the claim as in flight and the SAME night as owed — what Self says", () => {
    inZone("America/Chicago", () => {
      let at = Date.parse("2026-09-18T15:00:00Z"); // 10:00 CDT on the 18th
      const c = Counterpart.open({ dir, owner: true, now: () => at });
      open.push(c);
      for (const d of ["2026-09-16", "2026-09-17", "2026-09-18"]) memoryOn(c.store, d);
      expect(c.pageWriterDue({ mode: "session" }).about).toBe("2026-09-17");
      c.recordPageWriterRun({ about: "2026-09-17", mode: "session", outcome: "asked" });

      at = Date.parse("2026-09-19T01:30:00Z"); // 20:30 CDT on the 18th — UTC has turned
      expect(c.pageWriterDue({ mode: "session" })).toEqual({ due: true, about: "2026-09-17", attempt: 2 });
      expect(c.pageWriterStatus("2026-09-17").outcome).toBe("asked");
      expect(c.pageWriterClaimOpen("2026-09-17")).toBe(true);

      const f = pageWriterFindings(c.store, { dataDir: dir, owner: true })[0];
      expect(f?.detail).toContain("last ran for 2026-09-17 on 2026-09-18 — asked");
      expect(f?.detail).not.toContain("derived");
      expect(f?.detail).toContain("2026-09-17 is owed");
      expect(f?.detail).not.toContain("2026-09-18 is owed");
      expect(f?.data["owedFor"]).toBe("2026-09-17");
      expect(f?.data["staleFor"]).toBe(0);
    });
  });
});

