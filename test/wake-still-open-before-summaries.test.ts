/**
 * "STILL OPEN" KEEPS ITS ITEMS BEFORE "TODAY SO FAR" KEEPS ITS SUMMARIES
 * (2026-10-24; W1 → W1b, Mike 21:11, lightly held — `self/briefing.ts#ROOM_ORDER`'s
 * `todaySoFarSummaries`). Through the delivery a SessionStart hook makes
 * (`Counterpart#wake` with a date and a `here`, which assembles the wake for
 * the moment): on a tight day "Today so far here" steps its summaries down to
 * titles only before "Still open" drops an item; its titles still outrank
 * "Still open" past its first item, as W1 placed them.
 *
 * The W1 order, for comparison, is the same wake with the request's
 * `todaySoFarSummaries` left out (`w1Order`): no switch, only the order moves.
 *
 * Hermetic: every store is a temp dir made and removed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TODAY_SO_FAR_HEAD } from "../src/core/handoff/last-here.js";
import { readSentinel } from "../src/core/self/index.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { readableDate } from "../src/core/time.js";

const HOUR = 3_600_000;
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const OPEN = 5;
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;
const S1 = "c1c2c3c4-0000-4000-8000-000000000001";
const READER = "d5d6d7d8-0000-4000-8000-00000000000d";

const S = SELF_TUNABLES as { TODAY_SO_FAR: boolean };
const was = S.TODAY_SO_FAR;

let root: string;
let HERE: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-w1b-")));
  HERE = join(root, "garden");
  mkdirSync(HERE, { recursive: true });
  S.TODAY_SO_FAR = true;
});

afterEach(() => {
  S.TODAY_SO_FAR = was;
  for (const c of opened.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

type K = { c: Counterpart; set(t: number): void };

/** A garden store: a long page, `OPEN` open threads, two chapters yesterday,
 *  and today two earlier chapters (with summaries) and the newest "Last here" names. */
function garden(): K {
  let now = at(D1, 7);
  const c = Counterpart.open({ dir: join(root, "store"), budgetBytes: 9_000, now: () => now, timeZone: "UTC" });
  opened.push(c);
  const k: K = { c, set: (t) => void (now = t) };
  c.revisePage(`## Core\n\n${"I keep the garden's ledger and say what I do not know. ".repeat(30)}`, { by: "owner", reason: "seed" });
  k.set(at(D1, 8));
  for (let i = 0; i < OPEN; i++) {
    c.store.put({ type: "memory", kind: "fact", body: `Open: whether bed ${String(i)} wants lime this autumn, given the rain and the soil test.`, meta: { unresolved: true }, origin: { session: S1, scope: HERE } });
  }
  for (let i = 5; i < 30; i++) c.store.put({ type: "memory", kind: "fact", body: `Note ${String(i)}: bed ${String(i)} was dug over.`, origin: { session: S1, scope: HERE } });
  const chapter = (session: string, title: string, date: string, hour: number): void => {
    k.set(at(date, hour));
    const id = c.store.put({
      type: "episode",
      kind: "self",
      title,
      body: `## chapter 1 — ${readableDate(date)} · lived day 1\n\nWhat happened in ${title}.\n`,
      meta: { sessionId: session, chapters: 1 },
      source: "episode",
      origin: { session, scope: HERE },
    });
    c.store.put({
      type: "memory",
      kind: "self",
      body: `I worked on ${title.toLowerCase()} and decided the next step.`,
      meta: { episodeId: id, chapter: 1, chapterSummary: "written" },
      source: "episode",
      origin: { session, scope: HERE, ref: id },
    });
  };
  for (const [i, t] of ["Sowing the broad beans", "Mending the cold frame"].entries()) chapter(`e1e2e3e4-0000-4000-8000-00000000000${String(i)}`, t, D1, 9 + i);
  for (const [i, t] of ["Potting on the tomatoes", "The irrigation timer", "Netting the brassicas"].entries()) chapter(`f1f2f3f4-0000-4000-8000-00000000000${String(i)}`, t, D2, 8 + i);
  return k;
}

function wakeAt(k: K, budget: number): string {
  k.set(at(D2, 15));
  k.c.rebrief({ budgetBytes: budget, at: D2 });
  return k.c.wake(budget, { date: D2 }, { scope: HERE, session: READER, exportsFrom: () => true }).text;
}

/** The same wake in W1's order: the request's `todaySoFarSummaries` left out. */
function w1Order(k: K, budget: number): string {
  const self = k.c.self;
  const assemble = self.assemble.bind(self);
  self.assemble = (req) => {
    const { todaySoFarSummaries: _, ...rest } = req;
    return assemble(rest);
  };
  try {
    return wakeAt(k, budget);
  } finally {
    self.assemble = assemble;
  }
}

type Read = { text: string; bytes: number; items: number; today: string | undefined; summaries: boolean; titles: number; earlier: boolean };
function read(text: string): Read {
  const today = text.split("\n").find((l) => l.startsWith(`${TODAY_SO_FAR_HEAD} `));
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    items: (text.match(/^- .*Open: whether bed/gm) ?? []).length,
    today,
    summaries: today?.includes(" — ") ?? false,
    titles: (today?.match(/\(epi_[0-9a-f]+\)/g) ?? []).length,
    earlier: today !== undefined && / and \d+ earlier\.$/.test(today),
  };
}

const BUDGETS = (from: number, to: number, step = 20): number[] => {
  const out: number[] = [];
  for (let b = from; b >= to; b -= step) out.push(b);
  return out;
};

describe("Still open keeps its items before Today so far keeps its summaries (W1b)", () => {
  test("1. a tight room, 5 Still open items, 2 earlier chapters today: the summaries step down to titles before any Still open item drops, and every wake stays under its cap", () => {
    const k = garden();
    let titlesBesideAll = 0;
    let w1Dropped = 0;
    for (const budget of BUDGETS(3_600, 2_900)) {
      const text = wakeAt(k, budget);
      if (!readSentinel(text).intact) continue;
      const w = read(text);
      expect(w.bytes).toBeLessThanOrEqual(budget);
      // An item gone: no summary is left in "Today so far".
      if (w.items < OPEN) expect(w.summaries).toBe(false);
      if (w.items === OPEN && w.today !== undefined && !w.summaries) titlesBesideAll += 1;
      // W1's order, on the same budget, dropped an item to keep the summaries.
      const old = read(w1Order(k, budget));
      if (old.items < w.items && old.summaries) w1Dropped += 1;
    }
    expect(titlesBesideAll).toBeGreaterThan(0);
    expect(w1Dropped).toBeGreaterThan(0);
  });

  test("2. tighter still: Still open items drop, as before, while Today so far keeps its titles — a title gives way only once Still open is down to its first item", () => {
    const k = garden();
    let itemsDroppedTitlesKept = 0;
    for (const budget of BUDGETS(3_200, 1_400)) {
      const text = wakeAt(k, budget);
      if (!readSentinel(text).intact) continue;
      const w = read(text);
      expect(w.bytes).toBeLessThanOrEqual(budget);
      if (w.items < OPEN && w.items > 0) expect(w.summaries).toBe(false);
      if (w.items > 1 && w.items < OPEN && w.today !== undefined && !w.earlier) itemsDroppedTitlesKept += 1;
      // "Today so far" past its titles (fewer, counted as earlier): Still open lists at most its first.
      if (w.earlier) expect(w.items).toBeLessThanOrEqual(1);
    }
    expect(itemsDroppedTitlesKept).toBeGreaterThan(0);
  });

  test("3. room enough: the wake is W1's, byte for byte, summaries and every item in", () => {
    const k = garden();
    for (const budget of [9_000, 6_000, 3_600]) {
      const text = wakeAt(k, budget);
      expect(text).toBe(w1Order(k, budget));
      const w = read(text);
      expect(w.items).toBe(OPEN);
      expect(w.summaries).toBe(true);
      expect(w.titles).toBe(2);
    }
  });

  test("4. self.TODAY_SO_FAR off: no summary forms reach the render, and every wake is the order before W1b's, byte for byte", () => {
    const k = garden();
    S.TODAY_SO_FAR = false;
    const self = k.c.self;
    const assemble = self.assemble.bind(self);
    let marked = 0;
    self.assemble = (req) => {
      if (req.todaySoFarSummaries !== undefined) marked += 1;
      return assemble(req);
    };
    const off: string[] = [];
    try {
      for (const budget of BUDGETS(9_000, 1_400, 200)) off.push(wakeAt(k, budget));
    } finally {
      self.assemble = assemble;
    }
    expect(marked).toBe(0);
    for (const [i, budget] of BUDGETS(9_000, 1_400, 200).entries()) {
      expect(off[i]).not.toContain(TODAY_SO_FAR_HEAD);
      expect(off[i]).toBe(w1Order(k, budget));
    }
  });
});
