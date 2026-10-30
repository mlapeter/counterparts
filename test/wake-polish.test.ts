/**
 * THE WAKE POLISH (2026-10-18, the wake-polish builder; lightly held), from
 * random-6c's 10-17 wake: fewer items with their words beats more items as
 * counts or ids.
 *
 *   1. "Still open" leads with what is live: a thread untouched for
 *      `STILL_OPEN_STALE_DAYS` lived days ranks after the rest, one that would
 *      show as "Unsettled — may be out of date" after a plain one. (Its count
 *      line said how many were that old until 2026-10-25; now it is one calm
 *      count with no ids, `OPEN_TAIL_WORDS`.)
 *   2. A handoff says its staleness in one sentence ("2 days old, with a
 *      newer chapter here since; release 0.3.9 then, 0.3.10 now", the words
 *      since 2026-10-25). (Until WK1, 2026-10-30, when every one listed was
 *      stale the newest was shown and the rest counted; now every other live
 *      handoff keeps a line of its own, `handoff/#standsLadder`.)
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
import { OPEN_TAIL_WORDS, STALE_OPEN_WORDS, countedLanes, moreLine } from "../src/core/self/briefing.js";
import { unsettledAmong } from "../src/core/recall/standing.js";
import { staleWords } from "../src/core/handoff/index.js";
import type { Handoff } from "../src/core/handoff/index.js";
import { STANDS_OTHERS, standsLadder } from "../src/core/handoff/index.js";

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
  });

  test("the boundary is STILL_OPEN_STALE_DAYS lived days untouched, read as #489 D reads it (born or used)", () => {
    const s = store();
    const T = SELF_TUNABLES.STILL_OPEN_STALE_DAYS;
    const day = 40;
    const justStale = thread(s, "Untouched for exactly the stale days.", day - T);
    const justFresh = thread(s, "Untouched one day short of it.", day - T + 1);
    const lanes = rankLanes(scan(s, [justStale, justFresh], day), [], SELF_TUNABLES);
    expect(lanes.threads.map((r) => r.id)).toEqual([justFresh, justStale]);
    expect(T).toBe(14);
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

  test("the count line is calm: no ids, no age count — and the wake's reader still reads its number, old form and new (2026-10-25)", () => {
    const line = moreLine("threads", ["mem_a", "mem_b", "mem_c"]);
    expect(line).toBe(`(3 more open, ${OPEN_TAIL_WORDS})`);
    expect(line).not.toContain("mem_");
    expect(countedLanes(line)).toEqual({ threads: 3 });
    // A bundle stored before 2026-10-25 still reads.
    expect(countedLanes(`(3 more still open, 2 ${STALE_OPEN_WORDS}; recall ids: mem_a, mem_b, mem_c)`)).toEqual({ threads: 3 });
    // Another lane: the line as before.
    expect(moreLine("hints", ["mem_a"])).toBe("(1 more might be relevant)");
  });

  test("composed: the shown items are this week's, and the rest are one calm count", () => {
    const s = store();
    const day = 40;
    // Older, but inside the parking line (P2: 14 lived days): born 27..32, 8..13 untouched on day 40.
    const old = Array.from({ length: 6 }, (_, i) => thread(s, `Old open question ${String(i)} about the glaze log.`, 27 + i));
    const recent = Array.from({ length: 4 }, (_, i) => thread(s, `This week's open question ${String(i)} about the kiln.`, 35 + i));
    const out = new Self({ store: s }).build({ budgetBytes: 100_000, day });
    // THREADS_MAX (5) considered: the four recent, newest first, then one old.
    expect(out.kept.threads.slice(0, 4)).toEqual([...recent].reverse());
    expect(old).toContain(out.kept.threads[4] ?? "?");
    const more = out.text.split("\n").find((l) => l.startsWith("(5 more open"));
    expect(more).toBe(`(5 more open, ${OPEN_TAIL_WORDS})`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2. a handoff's staleness is one sentence", () => {
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
    expect(STALE).toBe("6 days old, with a newer chapter here since; release 0.3.9 then, 0.3.10 now");
    // Only old is not stale: the written date says it.
    expect(staleWords({ writtenWith: "0.3.10", installed: "0.3.10", age: 6 })).toBeNull();
  });

  test("a fresh handoff's line is what it was: when and who, then its first sentence", () => {
    const first = (written: string, stale: string | null): string | undefined =>
      standsLadder({ handoffs: [{ handoff: h(0), at: 1, since: { written, stale } }], day: 10 })[0]?.block.split("\n")[0];
    expect(first("10-17 13:26", null)).toBe(
      "Where this folder stands: a handoff from session kiln-ses, written 10-17 13:26 (sch_000000000000): Handoff 0: the glaze tiles dry on rack two.",
    );
    expect(first("10-12 09:24", STALE)).toBe(
      `Where this folder stands: a handoff from session kiln-ses, written 10-12 09:24 (${STALE ?? ""}) (sch_000000000000): Handoff 0: the glaze tiles dry on rack two.`,
    );
  });

  test("the newest says its sentence; the others a line each, dated, with no sentence of their own", () => {
    const hs = [h(0), h(1), h(2), h(3)];
    const widest = standsLadder({ handoffs: hs.map((handoff, i) => ({ handoff, at: 100 - i, since: i === 0 ? { written: "10-12 09:24", stale: STALE } : null })), day: 10 })[0];
    expect(widest?.shown.map((x) => x.id)).toEqual(hs.map((x) => x.id));
    const lines = (widest?.block ?? "").split("\n");
    expect(lines[0]).toContain(`written 10-12 09:24 (${STALE ?? ""}) (sch_000000000000): Handoff 0`);
    expect(lines[1]).toBe(STANDS_OTHERS);
    expect(lines[2]).toBe("- session kiln-ses, 10-12: Handoff 1: the glaze tiles dry on rack two. (sch_000000000001)");
    expect(lines.filter((l) => l.includes(STALE ?? "?"))).toHaveLength(1);
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
    // The newest says how stale it is, once; the other two keep a line each.
    const head = lines.find((l) => l.startsWith("Where this folder stands: ")) ?? "";
    expect(head).toMatch(/\(3 days old; release 0\.3\.9 then, 0\.3\.10 now\) \(sch_[0-9a-f]+\): Handoff 2/);
    expect(lines.filter((l) => l.includes("release 0.3.9 then"))).toHaveLength(1);
    expect(lines.filter((l) => /^- session kiln-ses, 10-12: Handoff [01]: /.test(l))).toHaveLength(2);
    // Read with the release they were written on: not stale, all three still there.
    const same = c.wake(9_000, { date: "2026-10-15" }, { scope: HERE, session: "reader", installed: "0.3.9" }).text;
    expect(same).not.toContain("release 0.3.9 then");
    expect(same.match(/\(sch_[0-9a-f]+\)/g)).toHaveLength(3);
  });
});
