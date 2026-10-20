/**
 * THE CORE, GROUP 3 PART A (2026-10-11; item 14, review 08 C1, C2, C4).
 *
 *   - the slow lane is the RECURRENCE lane: a memory or its slot (the
 *     memories a standing "A over B" ties it to) used awake, cited by a
 *     reflection or re-encoded, on 4 lived days from 3 sessions over 7, inside
 *     a trailing 30, the row used itself; engaged days count half, never alone;
 *   - identity means about me or us, of kind self, person or entity, not a plan;
 *   - a core member the narrowed test moves out, or one quiet for 60 lived
 *     days, is FLAGGED "being reconsidered" — never demoted by the phase; a
 *     decision (mine awake or in a reflection, or the owner's) demotes or keeps it.
 *
 * Hermetic: every test opens its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, partialSourceOf, promotionEligibility } from "../src/core/physics/index.js";
import { TUNABLES as SLEEP, coreContextFor, coreRecurrence, identityBlock, runCycle, slotOf, weighCore } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-core-recurrence-"));
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
function sleepNow(c: Counterpart): ReturnType<typeof runCycle> {
  dateN += 1;
  return runCycle({ store: c.store, date: date(dateN), cadence: { consolidate: 1 } });
}
function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "self",
    about: "me",
    body,
    // Not strongly felt: the fast lane stays shut, so a crossing is the slow lane's.
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

describe("the recurrence lane counts the slot, the sessions and the window", () => {
  test("a use, a newer state written into the slot and that one's use are three days of one slot; a fourth carries the current state across by the slow lane", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "I read slowly when a book bites.");
    nextDay(c);
    expect(c.resolveUse("s1", a, "referenced").credited).toBe(true);
    // The session is on the return (v13's column, written since 2026-10-11).
    expect(c.store.returnsOf(a).map((r) => r.session)).toEqual(["s1"]);
    nextDay(c);
    const b = mem(c, "I read slowly when a book bites, and I write it down after.", { origin: { session: "s2" } });
    expect(c.settleContradiction({ holds: b, over: a, how: "changed", actor: "session", actorId: "s2" }).ok).toBe(true);
    expect(slotOf(c.store, a).sort()).toEqual([a, b].sort());
    nextDay(c);
    expect(c.resolveUse("s3", b, "referenced").credited).toBe(true);
    let day = c.store.livedDay();
    let rec = coreRecurrence(c.store, a, day);
    // Day 2 (a's use, s1), day 3 (b written: a re-encoding, s2), day 4 (b's use, s3).
    expect(rec).toMatchObject({ days: 3, fullDays: 3, sessions: 3, anchored: true });
    expect(promotionEligibility(c.store.physicsOf(a), coreContextFor(c.store, c.store.row(a)!, day)).slow.met).toBe(false);
    // The anchor is the row's own use: b has one (day 4), so b counts the same slot too.
    expect(coreRecurrence(c.store, b, day).anchored).toBe(true);
    for (let i = 0; i < 5; i += 1) nextDay(c);
    expect(c.resolveUse("s4", a, "referenced").credited).toBe(true);
    day = c.store.livedDay();
    rec = coreRecurrence(c.store, a, day);
    expect(rec.days).toBe(4);
    expect((rec.last ?? 0) - (rec.first ?? 0)).toBeGreaterThanOrEqual(PHYSICS.CORE_SLOW_SPAN_DAYS);
    // The slot's recurrence lifts its CURRENT state: a is the earlier one now.
    expect(rec.earlier).toBe(true);
    expect(coreRecurrence(c.store, b, day)).toMatchObject({ days: 4, anchored: true });
    const crossed = sleepNow(c).promoted;
    expect(crossed.map((p) => p.id)).toEqual([b]);
    expect(crossed[0]?.lane).toBe("slow");
  });

  test("a slot proposal still waiting is not a slot: only a settled pair pools the uses (coordinator and random-06, 2026-10-11)", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "I take the long way round a hard question.");
    nextDay(c);
    const b = mem(c, "I take the long way round, and I say so.", { origin: { session: "s2" } });
    nextDay(c);
    expect(c.resolveUse("s3", b, "referenced").credited).toBe(true);
    const pr = c.store.proposeContradiction({ id: "ctr_wait", holds: b, over: a, source: "slot", day: c.store.livedDay(), actor: "detector", actorId: null, fade: null });
    expect(pr.created).toBe(true);
    // Unconfirmed: a's slot is a alone, and b's use is not a's recurrence.
    expect(slotOf(c.store, a)).toEqual([a]);
    expect(coreRecurrence(c.store, a, c.store.livedDay())).toMatchObject({ days: 0, anchored: false });
    // Confirmed (settled `changed`): now it is one slot.
    expect(c.settleContradiction({ holds: b, over: a, how: "changed", actor: "session", actorId: "s3" }).ok).toBe(true);
    expect(slotOf(c.store, a).sort()).toEqual([a, b].sort());
  });

  test("a write that confirms an older memory credits it with the write's session (review of #430)", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "I keep the notes short.");
    nextDay(c);
    const out = c.self.noteSelfConfirmation({ elementId: a, source: "authored", direction: "confirm", day: c.store.livedDay(), session: "s-write" });
    expect(out.reinforced).toBe(true);
    expect(c.store.returnsOf(a).map((r) => r.session)).toEqual(["s-write"]);
  });

  test("an engaged day counts half, and engaged days alone never meet the lane (at a full drewOn, 2026-10-19, a full day)", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "I notice when I hedge.");
    nextDay(c);
    c.resolveUse("s1", a, "engaged");
    const day = c.store.livedDay();
    const rec = coreRecurrence(c.store, a, day);
    // The experiment of 2026-10-19 tries drewOn as a full use: its return is
    // an awake one, so the day is a full day. At the half weight, as before.
    const full = partialSourceOf("engaged") === null;
    expect(rec.days).toBe(full ? 1 : PHYSICS.ENGAGED_RECURRENCE_WEIGHT);
    expect(rec.fullDays).toBe(full ? 1 : 0);
    expect(rec.anchored).toBe(true);
    if (!full) {
      const v = promotionEligibility(c.store.physicsOf(a), { aboutMe: true, recurrence: { ...rec, days: 10, sessions: 5, first: 1, last: 20 }, day });
      expect(v.slow.met).toBe(false);
    }
  });

  test("a return with no session counts one session per lived day; the window is the trailing 30", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "I like plain words.");
    const days: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      nextDay(c);
      nextDay(c);
      const d = c.store.livedDay();
      // No session: as every return before 2026-10-11 reads.
      c.store.reinforce(a, d, "referenced", { cued: true });
      days.push(d);
    }
    const day = c.store.livedDay();
    expect(c.store.returnsOf(a).every((r) => r.session === null)).toBe(true);
    expect(coreRecurrence(c.store, a, day)).toMatchObject({ days: 3, sessions: 3 });
    // A month and more later, none of it is inside the window; the last is still known.
    const late = coreRecurrence(c.store, a, day + PHYSICS.CORE_SLOW_WINDOW_DAYS);
    expect(late).toMatchObject({ days: 0, sessions: 0, first: null, lastEver: days.at(-1) });
  });
});

describe("identity means about me or us, not a plan", () => {
  test("owner, a fact and a plan are not what the core is for; me and us of a core kind are", () => {
    const c = brain();
    nextDay(c);
    const block = (over: Partial<PutInput>) => identityBlock(c.store, c.store.row(mem(c, `m ${JSON.stringify(over)}`, over))!);
    expect(block({ about: "me" })).toBeNull();
    expect(block({ about: "us", kind: "person" })).toBeNull();
    expect(block({ about: "us", kind: "entity" })).toBeNull();
    expect(block({ about: "owner", kind: "person" })).toBe("not-about-me-or-us");
    expect(block({ about: "work" })).toBe("not-about-me-or-us");
    expect(block({ about: "us", kind: "fact" })).toBe("not-a-core-kind");
    expect(block({ about: "us", kind: "skill" })).toBe("not-a-core-kind");
    expect(block({ about: "us", status: "planned" } as Partial<PutInput>)).toBe("a-plan");
    expect(block({ about: "me", status: "done" } as Partial<PutInput>)).toBeNull();
  });
});

describe("the core weighs itself, and nothing leaves it without a decision", () => {
  test("a member the narrowed test moves out is flagged once, stays core, and is shown; a re-mark lifts the flag", () => {
    const c = brain();
    nextDay(c);
    const aboutHim = mem(c, "Mike keeps his promises.", { kind: "person", about: "owner" });
    const plan = mem(c, "We will reflect after dreaming.", { kind: "fact", about: "us" });
    const me = mem(c, "I am patient with hard problems.");
    // Unmarked: in by recognition or before marks — not flagged for its mark.
    const unmarked = mem(c, "I recognised myself in the old handoff.", { about: undefined });
    for (const id of [aboutHim, plan, me, unmarked]) makeCore(c, id);
    sleepNow(c);
    const flagged = c.store.coreReconsidering();
    const byId = (a: string[], b: string[]) => (a[0] as string) < (b[0] as string) ? -1 : 1;
    expect(flagged.map((r) => [r.id, r.reason as string]).sort(byId)).toEqual(
      [
        [aboutHim, "not-about-me-or-us"],
        [plan, "not-a-core-kind"],
      ].sort(byId),
    );
    // Still core, still decay-exempt: the phase never demotes.
    for (const id of [aboutHim, plan]) expect(c.store.physicsOf(id).promotedIdentity).toBe(true);
    expect(c.coreList().reconsidering.map((r) => r.id).sort()).toEqual([aboutHim, plan].sort());
    // Flagged once, not every night.
    sleepNow(c);
    expect(c.store.coreEvents({ memoryId: aboutHim, action: "reconsidering" })).toHaveLength(1);
    // The reflection re-marks it as about us: the next consolidation lifts the flag.
    c.store.setAbout(aboutHim, "us", { by: "reflection", why: "it is about the two of us" });
    sleepNow(c);
    expect(c.store.coreStanding(aboutHim)).toMatchObject({ action: "reaffirmed", reason: "cause-gone", actor: "sleep" });
    expect(c.store.coreReconsidering().map((r) => r.id)).toEqual([plan]);
  });

  test("the owner keeps one (not flagged again for what it is) and I retire one (back to ordinary fading)", () => {
    const c = brain();
    nextDay(c);
    const kept = mem(c, "Mike's promise to Han.", { kind: "person", about: "owner" });
    const retired = mem(c, "The plan for the morning share.", { kind: "fact", about: "us" });
    makeCore(c, kept);
    makeCore(c, retired);
    sleepNow(c);
    expect(c.keepCore(kept, { why: "", actor: "owner" })).toEqual({ ok: false, reason: "reason-required" });
    expect(c.keepCore(kept, { why: "It is part of us.", actor: "owner" })).toEqual({ ok: true, reason: "kept" });
    expect(c.demoteCore(retired, { reason: "A plan, not who I am.", actor: "self" })).toEqual({ ok: true, reason: "demoted" });
    expect(c.store.physicsOf(retired).promotedIdentity).toBe(false);
    expect(c.store.coreEvents({ memoryId: retired, action: "demoted" })[0]).toMatchObject({ actor: "self" });
    sleepNow(c);
    expect(c.store.coreStanding(kept)).toMatchObject({ action: "reaffirmed", actor: "owner" });
    expect(c.store.coreReconsidering()).toEqual([]);
    // A demotion is sticky: the lanes do not promote it again.
    expect(c.store.coreDemoted(retired)).toBe(true);
  });

  test("quiet: 60 lived days without a recurrence day flags it; a recurrence after the flag lifts it", () => {
    const c = brain();
    nextDay(c);
    const id = mem(c, "I write the test before I trust the fix.");
    makeCore(c, id);
    const row = c.store.row(id)!;
    const day = c.store.livedDay();
    expect(weighCore(c.store, row, day + SLEEP.CORE_QUIET_DAYS - 1)).toBeNull();
    expect(weighCore(c.store, row, day + SLEEP.CORE_QUIET_DAYS)).toEqual({ action: "reconsidering", reason: "no-recurrence" });
    c.store.appendCoreEvent({ memoryId: id, action: "reconsidering", day, reason: "no-recurrence", actor: "sleep" });
    nextDay(c);
    c.resolveUse("s9", id, "referenced");
    expect(weighCore(c.store, c.store.row(id)!, c.store.livedDay())).toEqual({ action: "reaffirmed", reason: "cause-gone" });
  });

  test("a keep outlives a quiet flag and its lift: it is still not flagged for what it is", () => {
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike's promise to Han.", { kind: "person", about: "owner" });
    makeCore(c, id);
    let day = c.store.livedDay();
    expect(weighCore(c.store, c.store.row(id)!, day)).toEqual({ action: "reconsidering", reason: "not-about-me-or-us" });
    expect(c.keepCore(id, { why: "It is part of us.", actor: "owner" }).ok).toBe(true);
    expect(weighCore(c.store, c.store.row(id)!, day)).toBeNull();
    // Quiet for 60 lived days: flagged for going quiet, as it should be.
    day += SLEEP.CORE_QUIET_DAYS;
    expect(weighCore(c.store, c.store.row(id)!, day)).toEqual({ action: "reconsidering", reason: "no-recurrence" });
    c.store.appendCoreEvent({ memoryId: id, action: "reconsidering", day, reason: "no-recurrence", actor: "sleep" });
    // It comes back; sleep lifts the quiet flag.
    c.store.reinforce(id, day + 1, "referenced", { cued: true, session: "s-back" });
    expect(weighCore(c.store, c.store.row(id)!, day + 1)).toEqual({ action: "reaffirmed", reason: "cause-gone" });
    c.store.appendCoreEvent({ memoryId: id, action: "reaffirmed", day: day + 1, reason: "cause-gone", actor: "sleep" });
    // The owner's keep still stands: not flagged again for its mark.
    expect(weighCore(c.store, c.store.row(id)!, day + 2)).toBeNull();
  });

  test("the wake lists a flagged member under Still open, labelled, instead of under Who I am — one at a time", () => {
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike laughs at the demo.", { kind: "person", about: "owner" });
    const second = mem(c, "Mike reads the changelog first.", { kind: "person", about: "owner" });
    const question = mem(c, "Which day does the store move?", { meta: { unresolved: true } } as Partial<PutInput>);
    for (const m of [id, second]) {
      makeCore(c, m);
      c.store.appendCoreEvent({ memoryId: m, action: "reconsidering", day: c.store.livedDay(), reason: "not-about-me-or-us", actor: "sleep" });
    }
    c.rebrief({ budgetBytes: 9000 });
    const text = c.wake(9000).text;
    expect(text).toContain("Still open:");
    // At most RECONSIDERING_MAX (1) leads the lane; an open question still shows beside it.
    expect(text.match(/Core, being reconsidered — keep or retire it \(remember core\)/g)?.length).toBe(1);
    const shownFirst = text.includes(`[${id}]`) ? id : second;
    expect(text).toContain(`Core, being reconsidered — keep or retire it (remember core) [${shownFirst}]`);
    expect(text).toContain("Which day does the store move?");
    // They take turns by lived day: the next day the other one leads (review of #430).
    nextDay(c);
    c.rebrief({ budgetBytes: 9000 });
    const next = c.wake(9000).text;
    expect(next.match(/Core, being reconsidered — keep or retire it \(remember core\)/g)?.length).toBe(1);
    expect(next).toContain(`Core, being reconsidered — keep or retire it (remember core) [${shownFirst === id ? second : id}]`);
    void question;
  });
});

describe("my doors: remember's core, and the reflection's core part", () => {
  test("remember {core} keeps or retires, as me, with the why", async () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "Mike's promise.", { kind: "person", about: "owner" });
    const b = mem(c, "The plan we agreed.", { kind: "fact", about: "us" });
    makeCore(c, a);
    makeCore(c, b);
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: "s-core", scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: "s-core", scope: "/proj", owner: true });
    try {
      const keep = await s.call("remember", { core: { id: a, decision: "keep", why: "It is about us." } });
      expect(keep.structuredContent["reason"]).toBe("core-only");
      expect(keep.structuredContent["core"]).toMatchObject({ ok: true, reason: "kept" });
      const retire = await s.call("remember", { core: { id: b, decision: "retire", why: "A plan, not who I am." } });
      expect(retire.structuredContent["core"]).toMatchObject({ ok: true, reason: "demoted" });
      const again = await s.call("remember", { core: { id: b, decision: "retire", why: "again" } });
      expect(again.structuredContent["core"]).toMatchObject({ ok: false, reason: "not-core" });
      expect(s.counterpart.store.coreStanding(a)).toMatchObject({ action: "reaffirmed", actor: "self" });
      expect(s.counterpart.store.coreEvents({ memoryId: b, action: "demoted" })[0]).toMatchObject({ actor: "self" });
    } finally {
      s.counterpart.close();
    }
  });

  test("the reflection is handed what is being reconsidered and may retire it; its citation's session is the reflection", () => {
    const c = brain();
    nextDay(c);
    const flagged = mem(c, "The plan for tomorrow's share.", { kind: "fact", about: "us" });
    const cited = mem(c, "I like quiet mornings.");
    makeCore(c, flagged);
    // Flagged a week before (since 2026-10-20 the reflection is offered only the ones that waited).
    c.store.appendCoreEvent({ memoryId: flagged, action: "reconsidering", day: c.store.livedDay() - SLEEP.CORE_WAITING_DAYS, reason: "not-a-core-kind", actor: "sleep" });
    nextDay(c);
    nextDay(c);
    const begun = c.reflections.begin({ session: "s-r" });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.reconsidering).toEqual([{ id: flagged, reason: "not-a-core-kind", waited: SLEEP.CORE_WAITING_DAYS + 2 }]);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: "s-r",
      entry: "Looking back, one thing in my core is a plan.",
      cites: [cited],
      core: [{ id: flagged, decision: "retire", why: "It is a plan we made, not who I am." }],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.core).toEqual([{ id: flagged, ok: true, reason: "demoted" }]);
    expect(c.store.physicsOf(flagged).promotedIdentity).toBe(false);
    expect(c.store.coreEvents({ memoryId: flagged, action: "demoted" })[0]).toMatchObject({ actor: "reflection" });
    expect(c.store.returnsOf(cited).find((r) => r.source === "reflection")?.session).toBe(begun.bundle.reflection);
  });
});
