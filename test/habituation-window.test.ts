/**
 * H14 (2026-11-01): the habituation window is 14 lived days, not 7.
 *
 * Through the real doors: a turn is `Counterpart#recallForTurn` (what the
 * UserPromptSubmit hook calls), a rating is `session_end`'s `rated` on a real
 * McpServer, a lived day is `Store#advanceClock`. What it pins: a memory rated 0
 * in two sessions ten lived days ago is held at 14 and was not at 7; a later 2
 * clears it; it recovers on the fifteenth day; the box-3 note a 7-day build left
 * heals at the next rating row; and a store with more rating rows in the window
 * than `eventLog`'s default of 500 still reads its newest ones.
 *
 * Hermetic: every store is a fresh temp dir, removed after; an unnamed store
 * refuses (`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { HABITUATION_ROWS_MAX, RATED_EVENT_NAME, TUNABLES as RECALL, habituatedIds, habituationRows } from "../src/core/recall/index.js";
import type { CandidateVerdict, RecallDecision } from "../src/core/recall/index.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const EXPLICIT = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
let dir: string;
let priorEnv: string | undefined;
let priorExplicit: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorExplicit = process.env[EXPLICIT];
  dir = mkdtempSync(join(tmpdir(), "counterparts-h14-"));
  process.env[ENV] = dir;
  process.env[EXPLICIT] = "1";
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  if (priorExplicit === undefined) delete process.env[EXPLICIT];
  else process.env[EXPLICIT] = priorExplicit;
  rmSync(dir, { recursive: true, force: true });
});

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Fixed the wobbling chair leg with a shim.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The heating engineer comes on Thursday morning.",
  "The parcel was left with the neighbour across the road.",
  "Renewed the passport two months before the trip.",
];
const NOISE = "Mrs Okafor lent me her wicker proving basket and its drying rack.";
const OTHER = "The sourdough starter lives in the cold pantry and gets fed with rye.";
/** Reaches the memory so strongly it shows through the raised bar: how a session gets to rate it. */
const STRONG = "the wicker proving basket and drying rack Mrs Okafor lent me";
const REACH_OTHER = "how often should the sourdough starter be fed with rye?";
/** Reaches it well enough to clear its plain bar, not the raised one: the other memory sets the bar. */
const PROBE = "sourdough starter cold pantry rye and the rack";

/** The simulated day, as a calendar date the store and the MCP server's clock agree on. */
let calendar = 0;
function date(): string {
  return new Date(Date.UTC(2026, 7, 1 + calendar)).toISOString().slice(0, 10);
}

function brain(window?: number): Counterpart {
  const c = Counterpart.open({ dir, ...(window === undefined ? {} : { recallTunables: { HABITUATION_WINDOW_DAYS: window } }) });
  findable(c.store);
  open.push(c);
  return c;
}

function reopen(c: Counterpart, window?: number): Counterpart {
  c.close();
  open.splice(open.indexOf(c), 1);
  return brain(window);
}

/** Lived days pass one at a time: the clock counts days lived, not the calendar's gaps. */
function liveTo(c: Counterpart, day: number): void {
  while (c.store.livedDay() < day) {
    calendar += 1;
    c.store.advanceClock(date());
  }
  expect(c.store.livedDay()).toBe(day);
}

function world(c: Counterpart): { noise: string; other: string } {
  calendar = 0;
  c.store.advanceClock(date());
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
  return { noise: c.store.put({ type: "memory", kind: "fact", body: NOISE }), other: c.store.put({ type: "memory", kind: "fact", body: OTHER }) };
}

function turn(c: Counterpart, session: string, text: string): RecallDecision {
  return c.recallForTurn({ sessionId: session, text }).decision;
}

function shown(d: RecallDecision): string[] {
  return [...d.surfaced, ...d.footnotes];
}

function verdict(d: RecallDecision, id: string): CandidateVerdict | undefined {
  return d.verdicts.find((v) => v.id === id);
}

async function rate(c: Counterpart, session: string, rated: { id: string; score: number }[]): Promise<Record<string, unknown>> {
  const s = new McpServer({ counterpart: c, session, scope: "/work/h14", registryDir: join(dir, "registry"), now: () => Date.parse(`${date()}T12:00:00.000Z`) });
  const out = (await s.call("session_end", { session, memories: [], rated })).structuredContent;
  return out["rated"] as Record<string, unknown>;
}

/** Two sessions are shown `id` by a turn that reaches it, and call it noise. */
async function ratedNoiseTwice(c: Counterpart, id: string): Promise<void> {
  for (const s of ["noise-1", "noise-2"]) {
    expect(shown(turn(c, s, STRONG))).toContain(id);
    expect((await rate(c, s, [{ id, score: 0 }]))["rated"]).toBe(1);
  }
}

let probes = 0;
/** A fresh session's turn, so the session's own dedup never answers for the window. */
function probe(c: Counterpart): RecallDecision {
  probes += 1;
  return turn(c, `probe-${String(probes)}`, PROBE);
}

/** Held: the gate says so, and the turn that would otherwise show it doesn't. */
function expectHeld(c: Counterpart, id: string): void {
  const d = probe(c);
  expect(verdict(d, id)?.habituated).toBe(true);
  expect(verdict(d, id)?.verdict).toBe("below-bar");
  expect(shown(d)).not.toContain(id);
}

function expectFree(c: Counterpart, id: string): void {
  const d = probe(c);
  expect(verdict(d, id)?.habituated).toBeUndefined();
  expect(shown(d)).toContain(id);
}

function note(c: Counterpart): { through: number; rows: { zero: string[] }[] } {
  return JSON.parse(c.store.cacheNote("habituation") ?? "null") as { through: number; rows: { zero: string[] }[] };
}

function newestRated(c: Counterpart): number {
  return c.store.eventLog({ name: RATED_EVENT_NAME, order: "desc", limit: 1 })[0]?.seq ?? 0;
}

describe("H14: the window, through a real turn and real ratings", () => {
  test("rated 0 in two sessions ten lived days ago: held at 14, not at 7", async () => {
    const c = brain();
    const { noise } = world(c);
    const rated = c.store.livedDay();
    expectFree(c, noise);
    await ratedNoiseTwice(c, noise);
    expectHeld(c, noise);
    liveTo(c, rated + 10);
    expectHeld(c, noise);
    expectFree(reopen(c, 7), noise);
  });

  test("a later 2 clears it, while the window still holds its zeros", async () => {
    const c = brain();
    const { noise } = world(c);
    await ratedNoiseTwice(c, noise);
    liveTo(c, c.store.livedDay() + 10);
    expectHeld(c, noise);
    // A lift, never a veto: a turn that reaches it strongly still shows it, so it can be rated.
    expect(shown(turn(c, "clears", STRONG))).toContain(noise);
    expect((await rate(c, "clears", [{ id: noise, score: 2 }]))["rated"]).toBe(1);
    expectFree(c, noise);
  });

  test("it recovers by itself the day its zeros leave the window: the rating day counts, so day 15 at 14", async () => {
    const c = brain();
    const { noise } = world(c);
    const rated = c.store.livedDay();
    const window = c.recall.tunables.HABITUATION_WINDOW_DAYS;
    expect(window).toBe(14);
    await ratedNoiseTwice(c, noise);
    liveTo(c, rated + window - 1);
    expectHeld(c, noise);
    liveTo(c, rated + window);
    expectFree(c, noise);
  });

  test("a rating row the note hasn't seen: the rows answer, not the note", async () => {
    const c = brain();
    const { noise } = world(c);
    await ratedNoiseTwice(c, noise);
    expectHeld(c, noise);
    // A row whose note write never happened (a busy cache, a process that died after its row).
    c.store.appendEvent({ name: RATED_EVENT_NAME, day: c.store.livedDay(), ref: "elsewhere", payload: { session: "elsewhere", ratings: [{ id: noise, score: 2 }] } });
    expect(note(c).through).toBeLessThan(newestRated(c));
    expectFree(c, noise);
  });
});

describe("H14: the box-3 note a 7-day build left", () => {
  test("right after the upgrade it reads as current and sees only 7 days; the next rating row heals it", async () => {
    const old = brain(7);
    const { noise, other } = world(old);
    await ratedNoiseTwice(old, noise);
    liveTo(old, old.store.livedDay() + 10);
    // The 7-day build's last rating row writes a note that has already let the zeros go.
    expect(shown(turn(old, "old-1", REACH_OTHER))).toContain(other);
    expect((await rate(old, "old-1", [{ id: other, score: 1 }]))["rated"]).toBe(1);
    expect(note(old).through).toBe(newestRated(old));
    expect(note(old).rows.flatMap((r) => r.zero)).not.toContain(noise);

    const c = reopen(old);
    // Still current (no rating since), so the window's older rows aren't in it.
    expect(note(c).through).toBe(newestRated(c));
    expectFree(c, noise);
    // The rows themselves hold them: what's missing is only the note's.
    expect(habituationRows(c.store, c.store.livedDay(), c.recall.tunables).rows.flatMap((r) => r.zero)).toContain(noise);

    expect(shown(turn(c, "new-1", REACH_OTHER))).toContain(other);
    expect((await rate(c, "new-1", [{ id: other, score: 1 }]))["rated"]).toBe(1);
    expect(note(c).through).toBe(newestRated(c));
    expect(note(c).rows.flatMap((r) => r.zero)).toContain(noise);
    expectHeld(c, noise);
  });

  test("the undo: a 14-day note read at 7 is right at once, with no rating needed", async () => {
    const c = brain();
    const { noise, other } = world(c);
    await ratedNoiseTwice(c, noise);
    liveTo(c, c.store.livedDay() + 10);
    expect(shown(turn(c, "s", REACH_OTHER))).toContain(other);
    await rate(c, "s", [{ id: other, score: 1 }]);
    expect(note(c).rows.flatMap((r) => r.zero)).toContain(noise);
    const seven = reopen(c, 7);
    expect(note(seven).through).toBe(newestRated(seven));
    expectFree(seven, noise);
  });
});

describe("H14: more rating rows in the window than eventLog's default read", () => {
  /** Rating rows from elsewhere, as a heavy store has them (546 in 14 lived days on 2026-11-01), without the calls. */
  function busy(c: Counterpart, rows: number): void {
    const day = c.store.livedDay();
    for (let i = 0; i < rows; i++) {
      const session = `busy-${String(i)}`;
      c.store.appendEvent({ name: RATED_EVENT_NAME, day, ref: session, payload: { session, ratings: [{ id: "mem_elsewhere", score: 0 }] } });
    }
  }

  test("the newest rows still count: a 2 past the 500th row clears, and the note stays current", async () => {
    const c = brain();
    const { noise } = world(c);
    await ratedNoiseTwice(c, noise);
    liveTo(c, c.store.livedDay() + 1);
    busy(c, 600);
    expectHeld(c, noise);
    expect(shown(turn(c, "clears", STRONG))).toContain(noise);
    expect((await rate(c, "clears", [{ id: noise, score: 2 }]))["rated"]).toBe(1);
    expect(note(c).through).toBe(newestRated(c));
    expect(note(c).rows.length).toBeGreaterThan(600);
    expectFree(c, noise);
  });

  test("past the bound it loses the window's oldest rows, never the newest", () => {
    const total = HABITUATION_ROWS_MAX + 10;
    const rows = Array.from({ length: total }, (_, i) => ({
      seq: i + 1,
      day: 10,
      ref: "s",
      payload: JSON.stringify({ session: `s${String(i)}`, ratings: [{ id: `mem_${String(i)}`, score: 0 }] }),
    }));
    const eventLog = (f: { order?: "asc" | "desc"; limit?: number } = {}) => (f.order === "desc" ? [...rows].reverse() : rows).slice(0, f.limit ?? 500);
    const store = { eventLog, cacheNote: () => null } as unknown as Parameters<typeof habituatedIds>[0];
    const read = habituationRows(store, 10, RECALL);
    expect(read.through).toBe(total);
    expect(read.rows.length).toBe(HABITUATION_ROWS_MAX);
    expect(read.rows[0]?.seq).toBe(11);
    expect(read.rows.at(-1)?.seq).toBe(total);
  });
});
