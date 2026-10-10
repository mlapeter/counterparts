/**
 * Lane 0 (2026-10-10), dreaming review 09 C1: a memory leaves the dream's
 * queue only once it was delivered. When the host cut a part of the bundle the
 * headless run could not open, the new memories that part carried go back in
 * the queue (out of `dreams.shown`), counted, minus any the dream acted on.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { readIndex } from "../src/core/fit/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-requeue-"));
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
  const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" } });
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

const WORDS = ["harbor", "lantern", "orchard", "granite", "meadow", "copper", "willow", "ember", "falcon", "thistle", "quarry", "saffron"];

/** Enough long, distinct new memories that tonight's bundle comes in parts. */
function busyDay(c: Counterpart, n = 60): string[] {
  c.store.advanceClock("2026-09-10");
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const w = (k: number): string => WORDS[(i * 7 + k) % WORDS.length] as string;
    const body = `Note ${String(i)} about the ${w(0)} and the ${w(1)}: ` + `${w(2)} ${w(3)} ${w(4)} ${String(i)} `.repeat(60);
    ids.push(mem(c, body));
  }
  return ids;
}

function shownOf(c: Counterpart, id: string): string[] {
  return JSON.parse(c.store.dream(id)?.shown ?? "[]") as string[];
}

describe("Lane 0 09 C1: requeue on spill", () => {
  test("a cut later part: its new memories go back in the queue, minus one the dream replayed; the next night takes them", () => {
    const c = brain();
    busyDay(c);
    const out = c.dreams.begin({ session: "s1", scope: "/proj", at: "2026-09-20" });
    if (!out.ok) throw new Error(out.reason);
    const dream = out.bundle.dream;
    expect(out.bundle.parts).not.toBeNull();
    const index = readIndex(c.store, "dream");
    expect(index?.ref).toBe(dream);
    // The later part carrying the most new memories.
    const parts = index?.parts ?? [];
    const newIn = parts.map((keys) => keys.filter((k) => k.startsWith("m:new:")).map((k) => k.slice(6)));
    const n = newIn.reduce((best, ids, i) => (ids.length > (newIn[best] ?? []).length ? i : best), 0);
    const carried = newIn[n] ?? [];
    expect(carried.length).toBeGreaterThan(1);
    // The dream acted on one of them anyway (it reached it some other way).
    const acted = carried[0] as string;
    const r = c.dreams.propose({ dream, session: "s1", changes: [{ action: "replayed", id: acted }] as never });
    expect(r.ok).toBe(true);

    const waitingBefore = out.bundle.queue.waiting;
    const res = c.dreams.requeueSpilled(dream, [{ phase: "part", part: n + 2 }]);
    expect(res).toEqual({ requeued: carried.length - 1, kept: 1, unattributed: 0 });
    const shown = shownOf(c, dream);
    for (const id of carried.slice(1)) expect(shown).not.toContain(id);
    expect(shown).toContain(acted);
    const row = c.store.eventLog({ name: "dream.requeued" }).at(-1);
    expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({ requeued: carried.length - 1, kept: 1 });

    // The next night's queue holds what waited AND what came back.
    c.dreams.journal({ dream, session: "s1", title: "Parts", text: "A dream." });
    c.store.advanceClock("2026-09-21");
    const next = c.dreams.begin({ session: "s2", scope: "/proj", at: "2026-09-21" });
    if (!next.ok) throw new Error(next.reason);
    expect(next.bundle.queue.new).toBe(waitingBefore + carried.length - 1);
  });

  test("a cut part fetched again whole was delivered: nothing goes back", () => {
    const c = brain();
    busyDay(c);
    const out = c.dreams.begin({ session: "s1", scope: "/proj", at: "2026-09-20" });
    if (!out.ok) throw new Error(out.reason);
    const before = shownOf(c, out.bundle.dream);
    const res = c.dreams.requeueSpilled(out.bundle.dream, [{ phase: "part", part: 2 }], [{ phase: "part", part: 2 }]);
    expect(res).toEqual({ requeued: 0, kept: 0, unattributed: 0 });
    expect(shownOf(c, out.bundle.dream)).toEqual(before);
  });

  test("a cut begin returns the whole fresh list (it rides in part 1)", () => {
    const c = brain();
    busyDay(c, 8);
    const out = c.dreams.begin({ session: "s1", scope: "/proj", at: "2026-09-20" });
    if (!out.ok) throw new Error(out.reason);
    const fresh = out.bundle.fresh.map((f) => f.id);
    expect(fresh.length).toBeGreaterThan(0);
    const res = c.dreams.requeueSpilled(out.bundle.dream, [{ phase: "begin" }]);
    expect(res.requeued).toBe(fresh.length);
    const shown = shownOf(c, out.bundle.dream);
    for (const id of fresh) expect(shown).not.toContain(id);
  });

  test("without the dream's own index the cut parts are counted, never guessed", () => {
    const c = brain();
    busyDay(c, 8);
    const out = c.dreams.begin({ session: "s1", scope: "/proj", at: "2026-09-20" });
    if (!out.ok) throw new Error(out.reason);
    c.store.setMeta("fit.index.dream", "{}");
    const before = shownOf(c, out.bundle.dream);
    const res = c.dreams.requeueSpilled(out.bundle.dream, [{ phase: "begin" }]);
    expect(res).toEqual({ requeued: 0, kept: 0, unattributed: 1 });
    expect(shownOf(c, out.bundle.dream)).toEqual(before);
  });
});
