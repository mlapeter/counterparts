/**
 * THE CORE QUESTIONS THAT WAITED (2026-10-20, Mike's go, lightly held — an
 * experiment). On the owner's store five core memories were flagged "being
 * reconsidered" on 10-13 and three still waited on 10-20; nothing made them
 * get answered.
 *
 *   1. The nightly reflection is offered the ones that have waited
 *      `CORE_WAITING_DAYS` lived days (not the fresh ones), at most
 *      `CORE_ASK_MAX` a night, each with its unsettled pair; a keep or retire
 *      lands with its why, the share says it in one line with the way back,
 *      and the row records it. A pair settles only after the retire.
 *   2. An awake keep undoes a reflection's retire (`keepCore`'s restore);
 *      the owner's own retire stays sticky.
 *   3. The wake's "Still open" leads with a week-old one, and its line keeps
 *      "keep or retire it" beside the unsettled label.
 *   4. A store with no waiting ones: nothing changes.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as SLEEP } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { coreSentence } from "../src/core/dream/core-ask.js";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-core-waiting-"));
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
  const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" }, now: () => Date.now() + dateN * 86_400_000 });
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
function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "self",
    about: "me",
    body,
    salience: { relevance: 0.7, emotional: 0.1, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  } as PutInput);
}
/** Into the core by hand, as a promotion would have put it. */
function makeCore(c: Counterpart, id: string): void {
  const day = c.store.livedDay();
  c.store.updatePhysics(id, { promotedIdentity: true });
  c.store.setBand(id, "identity", day);
  c.store.appendCoreEvent({ memoryId: id, action: "promoted", day, lane: "fast", actor: "sleep" });
}
/** Flagged `ago` lived days before today. */
function flag(c: Counterpart, id: string, ago: number, reason = "not-about-me-or-us"): void {
  c.store.appendCoreEvent({ memoryId: id, action: "reconsidering", day: c.store.livedDay() - ago, reason, actor: "sleep" });
}
function begin(c: Counterpart, session = "s-r") {
  const begun = c.reflections.begin({ session });
  if (!begun.ok) throw new Error(begun.reason);
  return begun;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("1. the nightly reflection is offered the core questions that waited a week", () => {
  test("shown the week-old ones, not the fresh ones; the prompt asks it to decide where it can", () => {
    const c = brain();
    nextDay(c);
    const old = mem(c, "Mike laughs at the demo.", { kind: "person", about: "owner" });
    const fresh = mem(c, "Mike reads the changelog first.", { kind: "person", about: "owner" });
    makeCore(c, old);
    makeCore(c, fresh);
    flag(c, old, SLEEP.CORE_WAITING_DAYS);
    flag(c, fresh, SLEEP.CORE_WAITING_DAYS - 1);
    const begun = begin(c);
    expect(begun.bundle.reconsidering.map((r) => r.id)).toEqual([old]);
    expect(begun.bundle.reconsidering[0]?.waited).toBe(SLEEP.CORE_WAITING_DAYS);
    expect(begun.bundle.memories[old]).toBeDefined();
    expect(begun.instructions).toContain("waiting on a keep-or-retire for a week or more");
    expect(begun.instructions).toContain(`waited ${String(SLEEP.CORE_WAITING_DAYS)} lived days`);
    expect(begun.instructions).not.toContain(fresh);
    // The row keeps what it was offered.
    expect(JSON.parse(c.store.reflection(begun.bundle.reflection)!.detail)["coreOffered"]).toEqual([old]);
  });

  test("a retire lands with its why; the share says it in one line with the way back; the row records it", () => {
    const c = brain();
    nextDay(c);
    const old = mem(c, "The plan for tomorrow's share.", { kind: "fact", about: "us" });
    const kept = mem(c, "I like quiet mornings.");
    const cited = mem(c, "I write before I speak.");
    makeCore(c, old);
    makeCore(c, kept);
    flag(c, old, SLEEP.CORE_WAITING_DAYS + 3, "a-plan");
    flag(c, kept, SLEEP.CORE_WAITING_DAYS + 1, "no-recurrence");
    const begun = begin(c);
    expect(begun.bundle.reconsidering.map((r) => r.id)).toEqual([old, kept]);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: "s-r",
      entry: "Two things in my core had waited a week.",
      cites: [cited],
      core: [
        { id: old, decision: "retire", why: "It is a plan we made, not who I am." },
        { id: kept, decision: "keep", why: "Quiet mornings are still me." },
      ],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.core).toEqual([
      { id: old, ok: true, reason: "demoted" },
      { id: kept, ok: true, reason: "kept" },
    ]);
    expect(c.store.physicsOf(old).promotedIdentity).toBe(false);
    expect(c.store.coreEvents({ memoryId: old, action: "demoted" })[0]).toMatchObject({ actor: "reflection" });
    expect(c.store.coreEvents({ memoryId: old, action: "demoted" })[0]?.reason).toContain("It is a plan we made, not who I am.");
    expect(c.store.coreStanding(kept)).toMatchObject({ action: "reaffirmed", actor: "reflection" });
    const row = c.store.reflection(begun.bundle.reflection)!;
    const line = coreSentence(
      [
        { id: old, decision: "retire", why: "It is a plan we made, not who I am." },
        { id: kept, decision: "keep", why: "Quiet mornings are still me." },
      ],
      (id) => c.store.row(id)?.body ?? id,
    );
    expect(line).not.toBeNull();
    expect(row.share).toContain(line!);
    expect(row.share).toContain(`retired "The plan for tomorrow's share." (${old}) — It is a plan we made, not who I am`);
    expect(row.share).toContain("say so and I'll undo it");
    // One line.
    expect(row.share!.match(/On the core, I/g)?.length).toBe(1);
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    expect(detail["coreDecided"]).toEqual([
      { id: old, decision: "retire", why: "It is a plan we made, not who I am." },
      { id: kept, decision: "keep", why: "Quiet mornings are still me." },
    ]);
    expect(detail["coreOffered"]).toEqual([old, kept]);
    expect(detail["counts"]).toMatchObject({ core: 2, coreOffered: 2, coreKept: 1, coreRetired: 1 });
    // The hand-back says how to undo it.
    expect(done.outcome.handBack).toContain('decision: "keep"');
    // A second finish rebuilds the line, not doubles it.
    const again = c.reflections.finish({ reflection: begun.bundle.reflection, session: "s-r", share: { text: "I slept well.", cites: [cited] } });
    if (!again.ok) throw new Error(again.reason);
    const share = c.store.reflection(begun.bundle.reflection)!.share!;
    expect(share.match(/On the core, I/g)?.length).toBe(1);
  });

  test("the cap holds: at most CORE_ASK_MAX a night, and the next night the rest come first", () => {
    const c = brain();
    nextDay(c);
    const ids = Array.from({ length: SLEEP.CORE_ASK_MAX + 2 }, (_, i) => mem(c, `Mike's habit number ${String(i)}.`, { kind: "person", about: "owner" }));
    ids.forEach((id, i) => {
      makeCore(c, id);
      flag(c, id, SLEEP.CORE_WAITING_DAYS + 10 - i);
    });
    const first = begin(c);
    const offered = first.bundle.reconsidering.map((r) => r.id);
    // The longest waiting first.
    expect(offered).toEqual(ids.slice(0, SLEEP.CORE_ASK_MAX));
    const done = c.reflections.finish({ reflection: first.bundle.reflection, session: "s-r", entry: "Nothing much.", cites: [] });
    if (!done.ok) throw new Error(done.reason);
    nextDay(c);
    const second = begin(c, "s-r2");
    const next = second.bundle.reconsidering.map((r) => r.id);
    expect(next.length).toBe(SLEEP.CORE_ASK_MAX);
    // The two not offered last night lead; then the longest waiting of the rest.
    expect(next.slice(0, 2)).toEqual(ids.slice(SLEEP.CORE_ASK_MAX));
    expect(next[2]).toBe(ids[0]);
  });

  test("an unsettled pair is shown both sides, and settles only after the retire", () => {
    const c = brain();
    nextDay(c);
    const core = mem(c, "Mike works from the garage studio.", { kind: "person", about: "owner" });
    makeCore(c, core);
    nextDay(c);
    const newer = mem(c, "Mike moved his studio to the spare room.", { kind: "person", about: "owner" });
    c.store.flagContradiction({ id: "ctr_corewait001", x: core, y: newer, source: "test", day: c.store.livedDay() });
    flag(c, core, SLEEP.CORE_WAITING_DAYS);
    const begun = begin(c);
    expect(begun.bundle.reconsidering).toEqual([{ id: core, reason: "not-about-me-or-us", waited: SLEEP.CORE_WAITING_DAYS, pair: { id: "ctr_corewait001", other: newer, older: true } }]);
    expect(begun.bundle.memories[core]).toBeDefined();
    expect(begun.bundle.memories[newer]).toBeDefined();
    expect(begun.instructions).toContain(`unsettled with ${newer}`);
    expect(begun.instructions).toContain("retire it in this finish first; then settle");
    const reflection = begun.bundle.reflection;
    // Before the retire, the core takes pressure: no settle over it.
    const early = c.reflections.settle({ reflection, session: "s-r", holds: newer, over: core, how: "changed", why: "He moved the studio." });
    expect(early).toMatchObject({ ok: false, reason: "core-takes-pressure" });
    const done = c.reflections.finish({ reflection, session: "s-r", entry: "His studio moved.", cites: [newer], core: [{ id: core, decision: "retire", why: "It is about where he works, and that changed." }] });
    if (!done.ok) throw new Error(done.reason);
    const after = c.reflections.settle({ reflection, session: "s-r", holds: newer, over: core, how: "changed", why: "He moved the studio." });
    expect(after.ok).toBe(true);
    expect(c.store.contradiction("ctr_corewait001")).toMatchObject({ state: "settled", holds: newer, over: core });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2. the way back from a reflection's retire", () => {
  test("an awake keep puts it back in the core; the owner's own retire stays sticky", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "Mike hums while he solders.", { kind: "person", about: "owner" });
    const b = mem(c, "Mike's old car.", { kind: "person", about: "owner" });
    makeCore(c, a);
    makeCore(c, b);
    flag(c, a, SLEEP.CORE_WAITING_DAYS);
    const begun = begin(c);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: "s-r", entry: "One waited.", cites: [], core: [{ id: a, decision: "retire", why: "A habit of his, not of us." }] });
    if (!done.ok) throw new Error(done.reason);
    expect(c.store.physicsOf(a).promotedIdentity).toBe(false);
    // The owner says it was wrong: a keep, awake, restores it.
    expect(c.keepCore(a, { why: "It is part of how we work together.", actor: "owner" })).toEqual({ ok: true, reason: "restored" });
    expect(c.store.physicsOf(a).promotedIdentity).toBe(true);
    expect(c.store.row(a)?.band).toBe("identity");
    expect(c.store.coreDemoted(a)).toBe(false);
    expect(c.store.coreStanding(a)).toMatchObject({ action: "reaffirmed", actor: "owner" });
    // The owner's own retire is not undone by a keep.
    expect(c.demoteCore(b, { reason: "Not who I am.", actor: "owner" }).ok).toBe(true);
    expect(c.keepCore(b, { why: "changed my mind", actor: "self" })).toEqual({ ok: false, reason: "not-core" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("3. the wake leads with a week-old one, both labels shown", () => {
  test("Still open's first slot is the one that waited, unsettled or not, and it still says keep or retire", () => {
    const c = brain();
    nextDay(c);
    const waited = mem(c, "Mike works from the garage studio.", { kind: "person", about: "owner" });
    const fresh = mem(c, "Mike reads the changelog first.", { kind: "person", about: "owner" });
    makeCore(c, waited);
    makeCore(c, fresh);
    nextDay(c);
    const newer = mem(c, "Mike moved his studio to the spare room.", { kind: "person", about: "owner" });
    c.store.flagContradiction({ id: "ctr_corewait002", x: waited, y: newer, source: "test", day: c.store.livedDay() });
    flag(c, waited, SLEEP.CORE_WAITING_DAYS);
    flag(c, fresh, 1);
    for (let i = 0; i < 3; i += 1) {
      c.rebrief({ budgetBytes: 9000 });
      const text = c.wake(9000).text;
      const line = text.split("\n").find((l) => l.includes(`[${waited}]`));
      expect(line).toBeDefined();
      expect(line).toContain(`Core, being reconsidered — keep or retire it (remember core) [${waited}]; Unsettled — may be out of date, see [${newer}]: `);
      // RECONSIDERING_MAX (1): the fresh one waits behind it, every day.
      expect(text).not.toContain(`(remember core) [${fresh}]`);
      nextDay(c);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("doctor counts the core questions that waited", () => {
  test("the Reflection line says how many waited a week; none, it says nothing", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    nextDay(c);
    const a = mem(c, "Mike laughs at the demo.", { kind: "person", about: "owner" });
    makeCore(c, a);
    flag(c, a, 2);
    const quiet = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(quiet?.detail).not.toContain("for a keep or retire");
    expect(quiet?.data["coreWaited"]).toBe(0);
    flag(c, a, SLEEP.CORE_WAITING_DAYS + 1);
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).toContain(`1 core memory has waited ${String(SLEEP.CORE_WAITING_DAYS)}+ lived days for a keep or retire`);
    expect(line?.data["coreWaited"]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("4. a store with no waiting ones: nothing changes", () => {
  test("no core offer, no core line, no detail; the fresh ones still take turns in the wake", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "Mike laughs at the demo.", { kind: "person", about: "owner" });
    const b = mem(c, "Mike reads the changelog first.", { kind: "person", about: "owner" });
    makeCore(c, a);
    makeCore(c, b);
    flag(c, a, 1);
    flag(c, b, 2);
    const begun = begin(c);
    expect(begun.bundle.reconsidering).toEqual([]);
    expect(begun.instructions).not.toContain("- core (optional");
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: "s-r", entry: "Nothing much.", cites: [] });
    if (!done.ok) throw new Error(done.reason);
    const detail = JSON.parse(c.store.reflection(begun.bundle.reflection)!.detail) as Record<string, unknown>;
    expect(detail["coreOffered"]).toBeUndefined();
    expect(detail["coreDecided"]).toBeUndefined();
    expect(detail["coreLine"]).toBeUndefined();
    const led = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      c.rebrief({ budgetBytes: 9000 });
      const text = c.wake(9000).text;
      expect(text.match(/Core, being reconsidered — keep or retire it \(remember core\)/g)?.length).toBe(1);
      led.add(text.includes(`[${a}]`) ? a : b);
      nextDay(c);
    }
    expect(led).toEqual(new Set([a, b]));
  });
});
