/**
 * FEEDBACK LOOP, PART E (2026-10-19, an experiment): the dream replays the
 * day. What the day since the last dream used, rated useful or drew on is
 * listed in the bundle (`today`) and, when already dreamed, joins it in the
 * role `today`; a queued memory the day marked ranks ahead of tonight's other
 * new ones; pairs used together in one session are listed (`todayPairs`).
 *
 * The day is made through the real paths: recall shows the memories in a
 * session, the session rates them (`rateShown`) and names one in `drewOn`
 * (`creditDrewOn`). Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT, RECALL_RATED_EVENT } from "../src/core/counterpart-events.js";
import { DAY_CREDIT_EVENT, DAY_DECISION_EVENT, DAY_RATED_EVENT, readDay } from "../src/core/dream/day.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-dream";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-dream-day-"));
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
];

/** Day one, dreamed: the memories the next day will use are already dreamed. */
function dayOne(c: Counterpart): { kiln: string; glaze: string; clay: string } {
  c.store.advanceClock("2026-10-17");
  for (const body of FILLER) mem(c, body);
  const kiln = mem(c, "The kiln element cracked during the glaze firing on Friday.");
  const glaze = mem(c, "The celadon glaze crawls when it is applied too thick over wax.");
  const clay = mem(c, "The stoneware clay from the coast supplier shrinks twelve percent.");
  const first = c.dreams.begin({ session: SESSION, scope: "/studio", at: "2026-10-17" });
  if (!first.ok) throw new Error(`begin refused: ${first.reason}`);
  for (const id of [kiln, glaze, clay]) expect(Object.keys(first.bundle.memories)).toContain(id);
  expect(c.dreams.journal({ dream: first.bundle.dream, session: SESSION, text: "I dreamed of the kiln." }).ok).toBe(true);
  return { kiln, glaze, clay };
}

describe("part E: the dream replays the day", () => {
  test("a day that used memories already dreamed: they come back as today, the reward first, with the pair used together", () => {
    const c = brain();
    const { kiln, glaze, clay } = dayOne(c);
    c.store.advanceClock("2026-10-18");
    // Something new tonight, so there is a dream at all; and two new ones,
    // one the day will rate useful (lifted) and one it will not.
    // `quiet` is dated, which alone ranks it ahead (+0.4 value); only the day's lift can put `lifted` first.
    const quiet = mem(c, "The studio's spare shelf brackets are in the blue bin.", { eventDate: "2026-12-01" });
    const lifted = mem(c, "The new kiln element arrives Tuesday from the supplier.");

    // The lived day: a session is shown them, rates them and draws on one.
    const s = "s-studio";
    const shown = new Set<string>();
    for (const text of ["the kiln element cracked during the glaze firing", "celadon glaze crawls over wax", "the new kiln element arrives Tuesday", "stoneware clay from the coast shrinks"]) {
      const turn = c.recallForTurn({ sessionId: s, text });
      for (const id of [...turn.decision.surfaced, ...turn.decision.footnotes]) shown.add(id);
    }
    for (const id of [kiln, glaze, lifted, clay]) expect(shown.has(id)).toBe(true);
    const rated = c.rateShown(s, [
      { id: kiln, score: 3 },
      { id: glaze, score: 2 },
      { id: lifted, score: 2 },
      { id: clay, score: 0 },
    ]);
    expect(rated.recorded).toBe(true);

    const out = c.dreams.begin({ session: SESSION, scope: "/studio", at: "2026-10-18" });
    if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
    const b = out.bundle;
    const today = new Map(b.today.map((t) => [t.id, t.mark]));
    expect(today.get(kiln)).toBe("reward");
    expect(today.get(glaze)).toBe("useful");
    expect(today.get(lifted)).toBe("useful");
    // Rated noise: not replayed for having been shown.
    expect(today.has(clay)).toBe(false);
    expect(b.today[0]?.id).toBe(kiln);
    // Already dreamed, so not new: in the bundle in the role `today`.
    expect(b.memories[kiln]?.why).toBe("today");
    expect(b.memories[glaze]?.why).toBe("today");
    // The new one the day rated stays new, and ranks ahead of the one it did not.
    const fresh = b.fresh.map((f) => f.id);
    expect(fresh).toContain(lifted);
    expect(fresh).toContain(quiet);
    expect(fresh.indexOf(lifted)).toBeLessThan(fresh.indexOf(quiet));
    expect(b.memories[lifted]?.why).toBe("new");
    // Used together in one session, both shown tonight.
    const pairs = b.todayPairs.map(([x, y]) => [x, y].sort().join("|"));
    expect(pairs).toContain([kiln, glaze].sort().join("|"));
    // The dream may replay what the day used (only ids the bundle showed).
    const replay = c.dreams.propose({ dream: b.dream, session: SESSION, changes: [{ action: "replayed", id: kiln }, { action: "link", a: kiln, b: glaze }] });
    expect(replay.ok).toBe(true);
    // The begun row says what the day put in.
    const begun = c.store.eventLog({ name: "dream.begun", order: "desc", limit: 1 })[0];
    const p = JSON.parse(begun?.payload ?? "{}") as Record<string, unknown>;
    expect(p["todayReward"]).toBe(1);
    expect(p["todayDreamed"]).toBeGreaterThanOrEqual(2);
    expect(p["freshMarked"]).toBeGreaterThanOrEqual(1);
    // And the launch prompt tells the dreamer what `today` is.
    expect(c.dreams.launchPrompt({ session: SESSION })).toContain('"today"');
  });

  test("a day that marked nothing: the bundle carries no today and composes as before", () => {
    const c = brain();
    dayOne(c);
    c.store.advanceClock("2026-10-18");
    mem(c, "The studio's spare shelf brackets are in the blue bin.");
    const out = c.dreams.begin({ session: SESSION, scope: "/studio", at: "2026-10-18" });
    if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
    expect(out.bundle.today).toEqual([]);
    expect(out.bundle.todayPairs).toEqual([]);
  });

  test("drewOn is the reward tag, and only the stretch since the last dream counts", () => {
    const c = brain();
    const { kiln, glaze } = dayOne(c);
    c.store.advanceClock("2026-10-18");
    const s = "s-studio";
    c.recallForTurn({ sessionId: s, text: "the kiln element cracked during the glaze firing" });
    const drew = c.creditDrewOn(s, [kiln]);
    expect(drew.credited).toContain(kiln);
    // The durable row the MCP tools write beside it (`server-session-end.ts`).
    c.noteAdapterEvent(RECALL_CREDIT_EVENT, { source: "drewOn", session: s, ids: drew.credited, how: drew.credited.map(() => "drewOn") });
    const read = readDay(c.store, { sinceDay: 0, sinceAt: 0 });
    expect(read.marks.get(kiln)).toBe("reward");
    // A window that starts after it reads nothing of it.
    const later = readDay(c.store, { sinceDay: c.store.livedDay(), sinceAt: Date.now() + 60_000 });
    expect(later.marks.has(kiln)).toBe(false);
    expect(later.marks.has(glaze)).toBe(false);
  });

  test("the day's event names are the composition root's", () => {
    expect(DAY_CREDIT_EVENT).toBe(RECALL_CREDIT_EVENT);
    expect(DAY_RATED_EVENT).toBe(RECALL_RATED_EVENT);
    expect(DAY_DECISION_EVENT).toBe(RECALL_DECISION_EVENT);
  });
});
