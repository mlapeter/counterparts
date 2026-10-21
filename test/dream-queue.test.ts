/**
 * THE DREAM QUEUE, GROUP 3 PART C (2026-10-11; item 16 part 2, review 09 C2/C3).
 *
 *   - the whole not-yet-dreamed queue is read (no newest-2,000 cut) and ranked
 *     by value × fragility on the curve into tonight's room;
 *   - a memory stays queued while it is within reach, not a fixed 7 days, and
 *     one that falls below reach undreamed is counted once;
 *   - a refused fold's foldable parts are carried to the next night, together,
 *     first, and counted; an exempt-only fold carries nothing.
 *
 * Hermetic: every test opens its own temp store and removes it. No model is
 * called: the "dreamer" is the test, calling the module as the MCP tool does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, replayPriorityOf } from "../src/core/dream/index.js";
import { TUNABLES as PHYSICS, curveSal, strength } from "../src/core/physics/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-dream-queue-"));
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

const SESSION = "s-dream";

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, now: () => Date.now() + dateN * 86_400_000 });
  open.push(c);
  return c;
}
function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(date(dateN));
  return c.store.livedDay();
}
const ROUTINE = { relevance: 0.25, emotional: 0, predictive: 0.25 };
function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    about: "work",
    body,
    salience: { relevance: 0.5, emotional: 0.1, predictive: 0.5 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  } as PutInput);
}
function begin(c: Counterpart) {
  const out = c.dreams.begin({ session: SESSION, scope: "/proj" });
  if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
  return out.bundle;
}
function journal(c: Counterpart, dream: string): void {
  const j = c.dreams.journal({ dream, session: SESSION, title: "A night", text: "I dreamed." });
  if (!j.ok) throw new Error(String(j.reason));
}
function propose(c: Counterpart, dream: string, changes: Record<string, unknown>[]) {
  const out = c.dreams.propose({ dream, session: SESSION, changes: changes as never });
  if (!out.ok) throw new Error(`propose refused: ${out.reason}`);
  return out.results;
}

describe("replay priority is value × fragility on the curve", () => {
  test("the weakly held rank above the strongly held; the strong keep a floor; a held date is not zero", () => {
    const c = brain();
    nextDay(c);
    const day = c.store.livedDay();
    const weak = mem(c, "A note held a few days.", { salience: { relevance: 0.4, emotional: 0, predictive: 0.4 } });
    const strong = mem(c, "A note held for months.", { salience: { relevance: 0.95, emotional: 0, predictive: 0.95 } });
    const dated = mem(c, "The essay is due at the end of the year.", { eventDate: "2099-12-31" } as Partial<PutInput>);
    const p = (id: string, dated = false) => replayPriorityOf(c.store.physicsOf(id), day, { dated, onMind: false });
    // Worth more, but held for months: barely fragile, so it ranks below the
    // weakly held — and keeps the floor, so its value still counts.
    expect(p(weak)).toBeGreaterThan(p(strong));
    expect(p(strong)).toBeCloseTo(curveSal(c.store.physicsOf(strong)) * DREAM_TUNABLES.FRAGILITY_FLOOR, 6);
    expect(p(strong)).toBeGreaterThan(0);
    // A pending date holds its strength, yet its tag and its first day after the hold still count.
    expect(p(dated, true)).toBeGreaterThan(0);
    // Fragility is how far below whole it stands by the next night.
    const ph = c.store.physicsOf(weak);
    expect(p(weak)).toBeCloseTo(0.4 * (1 - strength(ph, day + 1)), 2);
    // The same memory, older and weaker on its curve, is MORE fragile: no age penalty.
    expect(replayPriorityOf(ph, day + 3, { dated: false, onMind: false })).toBeGreaterThan(p(weak));
  });
});

describe("the whole queue is read, by reach, not by position or a fixed window", () => {
  test("a valuable memory written first is found behind more than the old 2,000-row read", () => {
    const c = brain();
    nextDay(c);
    const first = mem(c, "The release broke a promise to a user; I said so plainly.", { salience: { relevance: 0.6, emotional: 0, predictive: 0.6 } });
    for (let i = 0; i < 2_050; i += 1) mem(c, `Routine step ${String(i)}.`, { salience: ROUTINE });
    const b = begin(c);
    expect(b.queue.new).toBe(2_051);
    expect(b.fresh[0]?.id).toBe(first);
    expect(b.queue.tonight + b.queue.waiting).toBe(b.queue.new);
  }, 120_000);

  test("the core never leaves the queue by reach, even faded by a settle (physics' belowReach; review of #436)", () => {
    const c = brain();
    nextDay(c);
    const core = mem(c, "Who I am when the work gets hard.", { kind: "self", about: "me", salience: ROUTINE });
    c.store.updatePhysics(core, { promotedIdentity: true, fade: 0.1 });
    for (let i = 0; i < 3; i += 1) nextDay(c);
    expect(strength(c.store.physicsOf(core), c.store.livedDay())).toBeLessThan(PHYSICS.REACH);
    const b = begin(c);
    expect(b.fresh.map((f) => f.id)).toContain(core);
    expect(b.queue.agedOut).toBe(0);
  });

  test("a store that has never dreamed queues only its last week: its life before dreaming is not a backlog (review of #436)", () => {
    const c = brain();
    nextDay(c);
    const KEPT = { relevance: 0.8, emotional: 0, predictive: 0.8 };
    const old = mem(c, "A salient note from before dreaming was turned on.", { salience: KEPT });
    for (let i = 0; i < DREAM_TUNABLES.FIRST_DREAM_DAYS + 3; i += 1) nextDay(c);
    expect(strength(c.store.physicsOf(old), c.store.livedDay())).toBeGreaterThanOrEqual(PHYSICS.REACH);
    const recent = mem(c, "A note from this week.", { salience: KEPT });
    expect(c.store.firstDreamDay()).toBeNull();
    const first = begin(c);
    expect(first.fresh.map((f) => f.id)).toEqual([recent]);
    expect(first.queue.new).toBe(1);
    expect(first.queue.agedOut).toBe(0);
    journal(c, first.dream);
    // Once dreaming has begun the horizon stays where it began: still not queued.
    nextDay(c);
    mem(c, "The next day's note.");
    expect(begin(c).fresh.map((f) => f.id)).not.toContain(old);
  });

  test("a routine memory leaves the queue the day it falls below reach, counted; a salient one waits past seven days", () => {
    const c = brain();
    nextDay(c);
    mem(c, "Dreamed tonight.");
    const d1 = begin(c);
    journal(c, d1.dream);
    nextDay(c);
    const routine = mem(c, "A routine step nobody dreamed.", { salience: ROUTINE });
    const salient = mem(c, "A salient memory nobody dreamed yet.", { salience: { relevance: 0.7, emotional: 0, predictive: 0.7 } });
    for (let i = 0; i < 9; i += 1) nextDay(c);
    expect(strength(c.store.physicsOf(routine), c.store.livedDay())).toBeLessThan(PHYSICS.REACH);
    mem(c, "Something new.");
    const d2 = begin(c);
    const fresh = d2.fresh.map((f) => f.id);
    expect(fresh).toContain(salient);
    expect(fresh).not.toContain(routine);
    expect(d2.queue.agedOut).toBe(1);
  });
});

describe("a refused fold's parts are carried to the next night, together and first", () => {
  test("the sixth fold's foldable parts come back as new, grouped at the top; counted on the night row and said", () => {
    const c = brain();
    nextDay(c);
    const ids = Array.from({ length: 14 }, (_, i) => mem(c, `Release step ${String(i)} went through without a hitch, number ${String(i)}.`));
    // An exempt part (dated): tied, never faded — so not carried.
    const dated = mem(c, "The next release is due at the end of the year.", { eventDate: "2099-12-31" } as Partial<PutInput>);
    const b = begin(c);
    const folds = Array.from({ length: DREAM_TUNABLES.FOLDS }, (_, i) => ({ action: "gist", fold: true, text: `Stretch ${String(i)} shipped.`, sources: [ids[2 * i], ids[2 * i + 1]] }));
    const sixth = [ids[10] as string, ids[11] as string, ids[12] as string];
    const results = propose(c, b.dream, [
      ...folds,
      { action: "gist", fold: true, text: "The last stretch shipped.", sources: [...sixth, dated] },
      // An exempt-only refused fold: nothing to carry.
      { action: "gist", fold: true, text: "The date and one step.", sources: [dated, ids[13]] },
    ]);
    expect(results[DREAM_TUNABLES.FOLDS]).toMatchObject({ ok: false, reason: "limit-reached" });
    expect(results[DREAM_TUNABLES.FOLDS]?.detail).toContain("3 foldable parts are carried");
    expect(results[DREAM_TUNABLES.FOLDS + 1]?.detail).toContain("nothing was carried");
    const changed = c.store.eventLog({ name: "dream.changed", ref: b.dream });
    const payload = JSON.parse(changed[changed.length - 1]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["foldOverflow"]).toBe(2);
    expect(payload["foldCarried"]).toBe(3);
    journal(c, b.dream);
    expect(c.dreams.handBackOf(b.dream) ?? "").toContain("3 of their parts are carried to the next night");
    // The next night: the carried parts are new again, first, together.
    nextDay(c);
    for (let i = 0; i < 30; i += 1) mem(c, `A new day's note ${String(i)}, worth a little more than a release step.`, { salience: { relevance: 0.55, emotional: 0, predictive: 0.55 } });
    const next = begin(c);
    expect(next.queue.carried).toBe(3);
    expect(next.fresh.slice(0, 3).map((f) => f.id).sort()).toEqual([...sixth].sort());
    expect(next.fresh.map((f) => f.id)).not.toContain(dated);
    // Once shown again, they are dreamed: the night after does not carry them.
    journal(c, next.dream);
    nextDay(c);
    mem(c, "Another day.");
    const third = begin(c);
    expect(third.queue.carried ?? 0).toBe(0);
    for (const id of sixth) expect(third.fresh.map((f) => f.id)).not.toContain(id);
  });

  test("a carried part the owner removes meanwhile leaves the carry; its journal is redacted and what the dream saw stays (review of #436)", async () => {
    const c = brain();
    nextDay(c);
    const ids = Array.from({ length: 13 }, (_, i) => mem(c, `Migration step ${String(i)} finished cleanly, number ${String(i)}.`));
    const b = begin(c);
    const folds = Array.from({ length: DREAM_TUNABLES.FOLDS }, (_, i) => ({ action: "gist", fold: true, text: `Batch ${String(i)} migrated.`, sources: [ids[2 * i], ids[2 * i + 1]] }));
    const [gone, archived, left] = [ids[10] as string, ids[11] as string, ids[12] as string];
    const results = propose(c, b.dream, [...folds, { action: "gist", fold: true, text: "The last batch migrated.", sources: [gone, archived, left] }]);
    expect(results[DREAM_TUNABLES.FOLDS]?.detail).toContain("3 foldable parts are carried");
    journal(c, b.dream);
    // The owner removes one part; another is archived.
    c.store.appendRemovalRecord({ memoryId: gone, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: gone, stage: "dark", actor: "owner", reason: "test" });
    const { chaseRemoved } = await import("../src/core/store/owner-op-seam.js");
    chaseRemoved(c.store, gone);
    c.store.archive(archived, "test");
    // The dream that showed it is redacted; what it saw is not edited.
    expect(c.store.dream(b.dream)?.journal).toContain("redacted");
    expect(JSON.parse(c.store.dream(b.dream)?.shown ?? "[]")).toContain(gone);
    nextDay(c);
    mem(c, "A new day's note.");
    const next = begin(c);
    const fresh = next.fresh.map((f) => f.id);
    expect(fresh).not.toContain(gone);
    expect(fresh).not.toContain(archived);
    expect(Object.keys(next.memories)).not.toContain(gone);
    // One part left is no fold: it is not counted as carried, and it waits in the queue as any memory.
    expect(next.queue.carried ?? 0).toBe(0);
    expect(fresh).toContain(left);
  });

  test("an undone night carries nothing: its parts are simply undreamed again", () => {
    const c = brain();
    nextDay(c);
    const ids = Array.from({ length: 12 }, (_, i) => mem(c, `Step ${String(i)} of the move, done.`));
    const b = begin(c);
    const folds = Array.from({ length: DREAM_TUNABLES.FOLDS }, (_, i) => ({ action: "gist", fold: true, text: `Part ${String(i)} moved.`, sources: [ids[2 * i], ids[2 * i + 1]] }));
    propose(c, b.dream, [...folds, { action: "gist", fold: true, text: "The rest moved.", sources: [ids[10], ids[11]] }]);
    journal(c, b.dream);
    c.dreams.undo(b.dream);
    nextDay(c);
    const next = begin(c);
    expect(next.queue.carried ?? 0).toBe(0);
    expect(next.queue.new).toBeGreaterThanOrEqual(12);
  });
});

describe("the queue's read of the dreams is bounded where it can be (review of #436)", () => {
  test("the gate reads only the last week's dreams, without their journals; an older dream's carry still comes back first", () => {
    const c = brain();
    nextDay(c);
    const KEPT = { relevance: 0.7, emotional: 0, predictive: 0.7 };
    const ids = Array.from({ length: 12 }, (_, i) => mem(c, `Release step ${String(i)} went through, number ${String(i)}.`, { salience: KEPT }));
    const b = begin(c);
    // More carry rows than one page of the event log, of a dream that is not
    // there: the read must not stop at the log's default page and lose the
    // real carry recorded after them.
    for (let i = 0; i < 500; i += 1) c.store.appendEvent({ name: "dream.carried", day: c.store.livedDay(), ref: "drm_gone", payload: { ids: "mem_a,mem_b", parts: 2 } });
    const folds = Array.from({ length: DREAM_TUNABLES.FOLDS }, (_, i) => ({ action: "gist", fold: true, text: `Stretch ${String(i)} shipped.`, sources: [ids[2 * i], ids[2 * i + 1]] }));
    const sixth = [ids[10] as string, ids[11] as string];
    const results = propose(c, b.dream, [...folds, { action: "gist", fold: true, text: "The last stretch shipped.", sources: sixth }]);
    expect(results[DREAM_TUNABLES.FOLDS]?.detail).toContain("2 foldable parts are carried");
    journal(c, b.dream);
    const dreamDay = c.store.livedDay();
    for (let i = 0; i < DREAM_TUNABLES.ASK_QUEUE_DAYS + 2; i += 1) nextDay(c);
    for (const id of sixth) expect(strength(c.store.physicsOf(id), c.store.livedDay())).toBeGreaterThanOrEqual(PHYSICS.REACH);
    // The store's read: oldest first, by day, and no journal.
    const all = c.store.dreamsShown();
    expect(all.map((d) => d.id)).toEqual([b.dream]);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(["date", "day", "id", "shown", "started_at", "state"]);
    expect(c.store.dreamsShown({ sinceDay: c.store.livedDay() - DREAM_TUNABLES.ASK_QUEUE_DAYS })).toEqual([]);
    expect(c.store.firstDreamDay()).toBe(dreamDay);
    // The gate counts the week's new memory, not the older carried parts.
    mem(c, "One new note this week.");
    expect(c.dreams.status(date(dateN)).newSince).toBe(1);
    // The night's full read still finds the carry, first.
    const next = begin(c);
    expect(next.queue.carried).toBe(2);
    expect(next.fresh.slice(0, 2).map((f) => f.id).sort()).toEqual([...sixth].sort());
  });
});
