/**
 * THE WAKE POLISH (2026-10-18, the wake-polish builder; lightly held), from
 * random-6c's 10-17 wake: fewer items with their words beats more items as
 * counts or ids.
 *
 *   1. "Still open" leads with what is live: a thread untouched for
 *      `STILL_OPEN_STALE_DAYS` lived days ranks after the rest, one that would
 *      show as "Unsettled — may be out of date" after a plain one, and the
 *      count line says how many of what it counts are that old.
 *   2. A handoff says its staleness in one sentence ("2 days old; since then:
 *      a newer chapter here; written on 0.3.9, 0.3.10 now"), and when every
 *      one listed is stale, the newest is shown and the rest counted.
 *   3. (The Yesterday line's folders are in `wake-fresh-today.test.ts`.)
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { SELF_TUNABLES, Self, rankLanes, scanOne } from "../src/core/self/index.js";
import type { Scanned } from "../src/core/self/identity.js";
import { STALE_OPEN_WORDS, countedLanes, moreLine } from "../src/core/self/briefing.js";
import { unsettledAmong } from "../src/core/recall/standing.js";
import { pointerBlock, pointerLadder, staleWords } from "../src/core/handoff/index.js";
import type { Handoff } from "../src/core/handoff/index.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-wake-polish-"));
});

afterEach(() => {
  for (const s of open.splice(0)) s.close();
  rmSync(dir, { recursive: true, force: true });
});

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

/** An open thread born on `born`, last used on `used` (default: never since). */
function thread(s: Store, body: string, born: number, opts: { used?: number; person?: boolean } = {}): string {
  const id = s.put({
    type: "memory",
    kind: opts.person === true ? "person" : "fact",
    body,
    meta: { unresolved: true },
    salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
    physics: { birthDay: born },
  });
  if (opts.used !== undefined) s.updatePhysics(id, { lastUsedDay: opts.used });
  return id;
}

function scan(s: Store, ids: readonly string[], day: number): Scanned[] {
  return ids.map((id) => scanOne(s, id, day)).filter((x): x is Scanned => x !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
describe("1. Still open leads with what is live", () => {
  test("touched within two weeks first (the most recently touched first), plain before unsettled, the weeks-old last — person-scoped first among them", () => {
    const s = store();
    const day = 30;
    const oldFact = thread(s, "An old fact thread nobody closed.", 2);
    const fresh = thread(s, "A fact thread opened this week.", 20);
    const revived = thread(s, "An old thread that a session used again lately.", 3, { used: 25 });
    const unsettled = thread(s, "A fresh thread that a newer memory may have overtaken.", 22);
    const oldPerson = thread(s, "An old promise to Robin, still unkept.", 1, { person: true });
    const lanes = rankLanes(scan(s, [oldFact, fresh, revived, unsettled, oldPerson], day), [], SELF_TUNABLES, {
      unsettled: new Set([unsettled]),
    });
    expect(lanes.threads.map((r) => r.id)).toEqual([revived, fresh, unsettled, oldPerson, oldFact]);
    // The weeks-old ones, named for the count line.
    expect([...(lanes.threadsStale ?? [])].sort()).toEqual([oldFact, oldPerson].sort());
  });

  test("the boundary is STILL_OPEN_STALE_DAYS lived days untouched, read as #489 D reads it (born or used)", () => {
    const s = store();
    const T = SELF_TUNABLES.STILL_OPEN_STALE_DAYS;
    const day = 40;
    const justStale = thread(s, "Untouched for exactly the stale days.", day - T);
    const justFresh = thread(s, "Untouched one day short of it.", day - T + 1);
    const lanes = rankLanes(scan(s, [justStale, justFresh], day), [], SELF_TUNABLES);
    expect(lanes.threads.map((r) => r.id)).toEqual([justFresh, justStale]);
    expect(lanes.threadsStale).toEqual([justStale]);
    // The words are pinned to the default: change one and the other changes too.
    expect(T).toBe(14);
    expect(STALE_OPEN_WORDS).toBe("untouched for 2+ weeks");
  });

  test("an unsettled pair's older memory is found in one read, and ranks after a plain open one in the composed wake", () => {
    const s = store();
    const older = thread(s, "The kiln wants cone six for the stoneware.", 9);
    const newer = s.put({ type: "memory", kind: "fact", body: "The kiln wants cone five for the new stoneware clay.", physics: { birthDay: 10 } });
    const plain = thread(s, "Whether the shelf wash needs a second coat.", 8);
    s.flagContradiction({ id: "ctr_polish00001", x: older, y: newer, source: "test", day: 10 });
    expect([...unsettledAmong(s, [older, plain, newer])]).toEqual([older]);
    const out = new Self({ store: s }).build({ budgetBytes: 100_000, day: 11 });
    // Born later, but unsettled: after the plain one.
    expect(out.kept.threads).toEqual([plain, older]);
    expect(out.text).toContain("Unsettled — may be out of date");
  });

  test("the core memories being reconsidered take turns in one rotation, unsettled or not; one that waited a week leads (2026-10-20)", () => {
    const s = store();
    const a = s.put({ type: "memory", kind: "person", body: "Robin prefers mornings.", band: "identity", physics: { birthDay: 1, promotedIdentity: true } });
    const b = s.put({ type: "memory", kind: "person", body: "Robin keeps the ledger.", band: "identity", physics: { birthDay: 2, promotedIdentity: true } });
    const flagged = (day: number): Scanned[] => scan(s, [a, b], day).map((x) => ({ ...x, reconsidering: true }));
    // Until 2026-10-20 the unsettled one (a) never led while a plain one waited;
    // now both pools are one rotation (review of #430), so a leads some days.
    const led = new Set([3, 4].map((day) => rankLanes(flagged(day), [], SELF_TUNABLES, { unsettled: new Set([a]) }).threads[0]?.id));
    expect(led).toEqual(new Set([a, b]));
    // One that has waited a week takes the first slot every day, unsettled or not.
    for (const day of [3, 4, 5, 6]) {
      const lanes = rankLanes(flagged(day), [], SELF_TUNABLES, { unsettled: new Set([a]), waiting: new Set([a]) });
      expect(lanes.threads[0]?.id).toBe(a);
      expect(lanes.overflow?.threads).toContain(b);
    }
  });

  test("the count line says how many of what it counts are weeks old, and the wake's reader still reads its number", () => {
    const line = moreLine("threads", ["mem_a", "mem_b", "mem_c"], undefined, ["mem_b", "mem_c", "mem_x"]);
    expect(line).toBe("(3 more still open, 2 untouched for 2+ weeks; recall ids: mem_a, mem_b, mem_c)");
    expect(countedLanes(line)).toEqual({ threads: 3 });
    // None old, or another lane: the line as before.
    expect(moreLine("threads", ["mem_a"], undefined, ["mem_x"])).toBe("(1 more still open; recall ids: mem_a)");
    expect(moreLine("hints", ["mem_a"], undefined, ["mem_a"])).toBe("(1 more might be relevant; recall ids: mem_a)");
  });

  test("composed: the shown items are this week's, and the count names the old ones among the rest", () => {
    const s = store();
    const day = 40;
    const old = Array.from({ length: 6 }, (_, i) => thread(s, `Old open question ${String(i)} about the glaze log.`, 2 + i));
    const recent = Array.from({ length: 4 }, (_, i) => thread(s, `This week's open question ${String(i)} about the kiln.`, 35 + i));
    const out = new Self({ store: s }).build({ budgetBytes: 100_000, day });
    // THREADS_MAX (5) considered: the four recent, newest first, then one old.
    expect(out.kept.threads.slice(0, 4)).toEqual([...recent].reverse());
    expect(old).toContain(out.kept.threads[4] ?? "?");
    const more = out.text.split("\n").find((l) => l.startsWith("(5 more still open"));
    expect(more).toBe(`(5 more still open, 5 ${STALE_OPEN_WORDS}; recall ids: ${old.filter((id) => !out.kept.threads.includes(id)).sort((x, y) => old.indexOf(y) - old.indexOf(x)).join(", ")})`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2. a handoff's staleness is one sentence; when all are stale, one is shown", () => {
  const h = (i: number, extra: Partial<Handoff> = {}): Handoff => ({
    id: `sch_00000000000${String(i)}`,
    scope: "/tmp/kiln",
    body: `Handoff ${String(i)}: the glaze tiles dry on rack two.`,
    bytes: 40,
    writtenOn: "2026-10-12",
    writtenDay: 10,
    session: `kiln-session-${String(i)}`,
    model: null,
    version: 1,
    ...extra,
  });
  const STALE = staleWords({ writtenWith: "0.3.9", installed: "0.3.10", newerChapter: true, age: 6 });

  test("the sentence: how old, what happened since, the release it was written on", () => {
    expect(STALE).toBe("6 days old; since then: a newer chapter here; written on 0.3.9, 0.3.10 now");
    // Only old is not stale: the written date says it.
    expect(staleWords({ writtenWith: "0.3.10", installed: "0.3.10", age: 6 })).toBeNull();
  });

  test("a fresh handoff's line is what it was: when and who, then its first sentence", () => {
    expect(pointerBlock(h(0), 10, 14, { written: "10-17 13:26", stale: null })?.split("\n")[0]).toBe(
      "Where I left off in this directory (written 10-17 13:26 by session kiln-ses): Handoff 0: the glaze tiles dry on rack two.",
    );
    expect(pointerBlock(h(0), 10, 14, { written: "10-12 09:24", stale: STALE })?.split("\n")[0]).toBe(
      `Where I left off in this directory (written 10-12 09:24 by session kiln-ses — ${STALE ?? ""}): Handoff 0: the glaze tiles dry on rack two.`,
    );
  });

  test("every one listed stale: the widest block shows the newest whole and counts the rest", () => {
    const hs = [h(0), h(1), h(2), h(3)];
    const since = hs.map(() => ({ written: "10-12 09:24", stale: STALE }));
    const ladder = pointerLadder(hs, 10, { since });
    const widest = ladder[0]?.block ?? "";
    expect(ladder[0]?.shown.map((x) => x.id)).toEqual([hs[0]?.id ?? "?"]);
    expect(widest).toContain(`1) From session kiln-ses, written 10-12 09:24 (${STALE ?? ""}): Handoff 0`);
    expect(widest).not.toContain("2) From");
    expect(widest).toContain(`+3 older here: ${hs[1]?.id ?? ""} (10-12), ${hs[2]?.id ?? ""} (10-12), ${hs[3]?.id ?? ""} (10-12).`);
  });

  test("the newest fresh: up to three listed, each older one with its own sentence", () => {
    const hs = [h(0), h(1), h(2), h(3)];
    const since = hs.map((_, i) => ({ written: "10-12 09:24", stale: i === 0 ? null : STALE }));
    const widest = pointerLadder(hs, 10, { since })[0];
    expect(widest?.shown.map((x) => x.id)).toEqual(hs.slice(0, 3).map((x) => x.id));
    expect(widest?.block).toContain("1) From session kiln-ses, written 10-12 09:24: Handoff 0");
    expect(widest?.block).toContain(`2) From session kiln-ses, written 10-12 09:24 (${STALE ?? ""}): Handoff 1`);
  });

  test("the reserve is sized to the whole ladder, not the collapsed one", () => {
    const hs = [h(0), h(1), h(2), h(3)];
    const since = hs.map(() => ({ written: "10-12 09:24", stale: STALE }));
    expect(pointerLadder(hs, 10, { since, collapseStale: false })[0]?.shown).toHaveLength(3);
  });

  test("delivered: three handoffs, all from an older release with a newer chapter since, read days later", () => {
    const day0 = Date.UTC(2026, 9, 12, 15, 0);
    let now = day0;
    const c = Counterpart.open({ dir, now: () => now });
    open.push(c);
    const HERE = "/tmp/kiln-studio";
    for (const i of [0, 1, 2]) {
      now = day0 + i * 60_000;
      expect(c.writeHandoff(`Handoff ${String(i)}: the glaze tiles dry on rack two.`, { scope: HERE, session: `kiln-session-${String(i)}`, build: "0.3.9" }).written).toBe(true);
    }
    now = day0 + 3 * 86_400_000;
    c.rebrief({ budgetBytes: 9_000, at: "2026-10-15" });
    const text = c.wake(9_000, { date: "2026-10-15" }, { scope: HERE, session: "reader", installed: "0.3.10" }).text;
    const lines = text.split("\n");
    expect(lines.filter((l) => /^\d\) From /.test(l))).toHaveLength(1);
    expect(lines.find((l) => l.startsWith("1) From "))).toContain("(3 days old; written on 0.3.9, 0.3.10 now): Handoff 2");
    expect(lines.some((l) => l.startsWith("+2 older here: "))).toBe(true);
    // Read with the release they were written on: not stale, all three listed.
    const same = c.wake(9_000, { date: "2026-10-15" }, { scope: HERE, session: "reader", installed: "0.3.9" }).text;
    expect(same.split("\n").filter((l) => /^\d\) From /.test(l))).toHaveLength(3);
  });
});
