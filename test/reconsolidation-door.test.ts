/**
 * ONE DOOR FOR "A OVER B" (2026-10-11, Group 2b; review 10 C1, R7, C4, C6;
 * review 07 §4.3). Every path that marks one memory as standing in place of
 * another goes through `reconsolidation.ts#supersede`: a settle, a write's
 * `updates`, a slot confirmed, a dream merge, the core's pressure crossing, a
 * fulfilled plan, a moved reminder. Each writes the pair, the trail and the
 * label, takes its effect from `how` alone (decided by random-06, 2026-10-11:
 * no fourth relation — a merge's originals and a crossed or fulfilled core
 * memory fade, stay live and are labelled earlier), and its undo is exact.
 *
 * The core path's cases are the Han case's SHAPE, in made-up words.
 * Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { Associate, TERMINAL_ARCHIVE_GRACE_MS } from "../src/core/associate/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_MERGE_REASON } from "../src/core/dream/index.js";
import { revisionBar } from "../src/core/physics/index.js";
import { CUE_MODE_META, DATE_MOVED_TO_META, Prospective } from "../src/core/prospective/index.js";
import {
  CONTRADICTION_SETTLED_EVENT,
  CONTRADICTION_TUNABLES,
  FULFILLED_SOURCE,
  PRESSURE_UNDONE_REASON,
  REMINDERS_MOVED_META,
  REMINDER_SPENT_BY_META,
  REMINDER_MOVED_SOURCE,
  SLOT_SOURCE,
  expireUnanswerableSlots,
  flag,
  proposeSlot,
  releaseOrphanSlots,
  settle,
  settleMovedReminders,
  supersede,
  undo,
} from "../src/core/reconsolidation.js";
import { Recall, headOf, standingOf } from "../src/core/recall/index.js";
import { settledOver } from "../src/core/self/index.js";
import { recallTurn } from "../src/core/retrieval.js";
import { applyRevision } from "../src/core/revision.js";
import { Schemas } from "../src/core/schemas/index.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { LEGACY_SLOT_FADE, useSlotFade } from "./slot-fade-fixture.js";
import { findable } from "./store-fixture.js";

// The provisional cut's arithmetic, at the cut a revert restores (flag only since 2026-10-19).
useSlotFade(LEGACY_SLOT_FADE);

const SESSION = "sess_door";
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-door-"));
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

function store(): Store {
  const s = findable(Store.open({ dir }));
  open.push(s);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.advanceClock(d);
  return s;
}

function brain(clock?: { now: number }): Counterpart {
  const c = Counterpart.open({ dir, ...(clock === undefined ? {} : { now: () => clock.now }) });
  findable(c.store);
  open.push(c);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) c.store.advanceClock(d);
  return c;
}

function server(): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one" });
  open.push(s.counterpart);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.counterpart.store.advanceClock(d);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]?.text ?? "{}") as Record<string, unknown>;
}

function put(s: Store, body: string, over: Partial<PutInput> = {}): string {
  return s.put({ type: "memory", kind: "fact", body, source: "authored", origin: { session: SESSION }, ...over } as PutInput);
}

function settledEvents(s: Store): Record<string, unknown>[] {
  return s.eventLog({ name: CONTRADICTION_SETTLED_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
}

/** A core memory: promoted, in the identity band, strong. */
function core(s: Store, body: string, over: Partial<PutInput> = {}): string {
  const id = s.put({
    type: "memory",
    kind: "person",
    body,
    source: "authored",
    salience: { novelty: null, relevance: 1, emotional: 1, predictive: 1, claimed: 1 },
    physics: { birthDay: 0, lastUsedDay: 0 },
    ...over,
  } as PutInput);
  s.updatePhysics(id, { promotedIdentity: true });
  s.setBand(id, "identity", 0);
  return id;
}

describe("the door: every 'A over B' writes the same record", () => {
  test("a settle: the pair, its source on the event, the label, the fade; the undo is exact", () => {
    const s = store();
    const a = put(s, "The router is in the hall.");
    const b = put(s, "The router is in the study.");
    const out = settle(s, { holds: b, over: a, how: "changed", actor: "owner" });
    if (!out.ok) throw new Error(out.reason);
    expect(s.contradiction(out.pair)?.source).toBe("settle");
    expect(settledEvents(s).at(-1)).toMatchObject({ source: "settle", how: "changed", faded: true, leftCore: false });
    expect(standingOf(s, a)?.prefix).toContain(`Earlier (now [${b}])`);
    expect(s.row(a)?.fade).toBeCloseTo(0.5, 6);
    expect(undo(s, { pair: out.pair, actor: "owner" }).ok).toBe(true);
    expect(s.row(a)?.fade).toBe(1);
  });

  test("the write door records whether the writer SENT how or it was defaulted (review 10 C6)", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const a = String(payload(await srv.call("remember", { text: "The garden shed key hangs by the back door." }))["id"]);
    await srv.call("remember", { text: "The garden shed key now hangs inside the pantry.", updates: a });
    const b = String(payload(await srv.call("remember", { text: "The bicycle pump lives in the garden shed." }))["id"]);
    await srv.call("remember", { text: "The bicycle pump lives in the garage now, not the shed.", updates: b, how: "corrected" });
    const writes = settledEvents(s).filter((e) => e["source"] === "write");
    expect(writes.map((e) => [e["how"], e["howSent"]])).toEqual([
      ["changed", false],
      ["corrected", true],
    ]);
  });

  test("a corrected memory hands its links to the one that holds; its undo takes them back, even after the sweep", () => {
    const clock = { now: Date.UTC(2026, 8, 3, 9) };
    const c = brain(clock);
    const s = c.store;
    const friend = put(s, "An older memory both are linked to.");
    const a = put(s, "The ferry leaves at eight from the north pier.");
    const b = put(s, "The ferry leaves at nine from the south pier.");
    const day = s.livedDay();
    s.linkMany([{ src: a, dst: friend, weight: 0.2, day }, { src: friend, dst: a, weight: 0.2, day }]);
    const out = c.settleContradiction({ holds: b, over: a, how: "corrected", why: "it was wrong", actor: "owner" });
    if (!out.ok) throw new Error(out.reason);
    expect(s.row(a)?.archived_reason).toBe("corrected");
    expect(c.associate.linked(b, friend)).toBe(true);
    // The sweep takes `corrected` rows now (its links were carried).
    clock.now += TERMINAL_ARCHIVE_GRACE_MS + 1;
    c.associate.absorb([{ a: b, b: friend, delta: 0.01 }]);
    expect(c.associate.flush().sweptArchived).toBeGreaterThan(0);
    expect(s.edgesFrom(a)).toEqual([]);
    const back = c.undoContradiction({ pair: out.pair, actor: "owner" });
    expect(back).toMatchObject({ ok: true, unarchived: a });
    expect(c.associate.linked(a, friend)).toBe(true);
  });
});

describe("the dream merge goes through the door", () => {
  const ORIGINALS = [
    "The island ferry leaves at eight from the north pier.",
    "The ferry to the island departs the north pier at eight.",
    "At eight the island ferry goes from the north pier.",
  ];

  function merged(c: Counterpart, n = 2): { ids: string[]; a: string; b: string; m: string; dream: string; friend: string } {
    const s = c.store;
    for (let d = 4; d <= 12; d += 1) s.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const ids = ORIGINALS.slice(0, n).map((body) => c.store.put({ type: "memory", kind: "fact", body, origin: { session: "s1" } }));
    const friend = c.store.put({ type: "memory", kind: "fact", body: "The north pier café sells tea.", origin: { session: "s1" } });
    const day = s.livedDay();
    s.linkMany([
      { src: ids[0] as string, dst: friend, weight: 0.2, day },
      { src: friend, dst: ids[0] as string, weight: 0.2, day },
    ]);
    const begun = c.dreams.begin({ session: "night" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const out = c.dreams.propose({ dream: begun.bundle.dream, session: "night", changes: [{ action: "merge", ids, text: "The island ferry leaves the north pier at eight." }] });
    if (!out.ok || out.results[0]?.ok !== true) throw new Error(`propose refused: ${JSON.stringify(out)}`);
    return { ids, a: ids[0] as string, b: ids[1] as string, m: out.results[0]?.id as string, dream: begun.bundle.dream, friend };
  }

  test("one pair per original, plain `changed`, source dream-merge: the originals fade, stay live and are labelled earlier", () => {
    const c = brain();
    const { a, b, m, friend } = merged(c);
    const s = c.store;
    for (const x of [a, b]) {
      expect(s.contradictionBetween(m, x)).toMatchObject({ state: "settled", how: "changed", holds: m, over: x, source: DREAM_MERGE_REASON });
      expect(s.row(x)).toMatchObject({ archived: 0, superseded_by: null });
      expect(s.row(x)?.fade).toBeCloseTo(0.5, 6);
      expect(headOf(s, x)).toBe(m);
    }
    const events = settledEvents(s).filter((e) => e["source"] === DREAM_MERGE_REASON);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e["faded"] === true && e["archived"] === false)).toBe(true);
    // The merged memory took the originals' links (a copy: the original keeps its own).
    expect(c.associate.linked(m, friend)).toBe(true);
    expect(c.associate.linked(a, friend)).toBe(true);
  });

  test("an original already settled under a merged memory is not merged again", () => {
    const c = brain();
    const s = c.store;
    for (let d = 4; d <= 12; d += 1) s.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const [a, b, other] = ORIGINALS.map((body) => s.put({ type: "memory", kind: "fact", body, origin: { session: "s1" } })) as [string, string, string];
    const begun = c.dreams.begin({ session: "night" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: "night",
      changes: [
        { action: "merge", ids: [a, b], text: "The island ferry leaves the north pier at eight." },
        { action: "merge", ids: [a, other], text: "The ferry leaves at eight." },
      ],
    });
    if (!out.ok) throw new Error("propose refused");
    expect(out.results[0]?.ok).toBe(true);
    expect(out.results[1]).toMatchObject({ ok: false, reason: "earlier-is-not-merged" });
    expect(headOf(s, a)).toBe(out.results[0]?.id as string);
    expect(headOf(s, other)).toBeNull();
  });

  test("the dream's undo is a settle's undo: the originals' strength back, the pairs withdrawn, the merged memory archived", () => {
    const c = brain();
    const { ids, m, dream } = merged(c, 3);
    const s = c.store;
    expect(c.dreams.undo(dream).ok).toBe(true);
    for (const x of ids) {
      expect(s.row(x)).toMatchObject({ archived: 0, superseded_by: null, fade: 1 });
      expect(s.contradictionBetween(m, x)).toBeUndefined();
      expect(headOf(s, x)).toBeNull();
    }
    expect(s.row(m)?.archived).toBe(1);
  });

  test("the owner may undo one original's pair of three: it stands again, the other two stay earlier under the merged memory", () => {
    const c = brain();
    const { ids, m, dream } = merged(c, 3);
    const s = c.store;
    const [a, b, d] = ids as [string, string, string];
    const out = c.undoContradiction({ pair: s.contradictionBetween(m, a)?.id as string, actor: "owner" });
    expect(out).toMatchObject({ ok: true, state: "withdrawn" });
    expect(s.row(a)?.fade).toBe(1);
    expect(headOf(s, a)).toBeNull();
    for (const x of [b, d]) {
      expect(s.row(x)?.fade).toBeCloseTo(0.5, 6);
      expect(headOf(s, x)).toBe(m);
    }
    expect(s.row(m)?.archived).toBe(0);
    // The dream's undo afterwards still reverses the rest.
    expect(c.dreams.undo(dream).ok).toBe(true);
    for (const x of ids) expect(s.row(x)?.fade).toBe(1);
    expect(s.row(m)?.archived).toBe(1);
  });

  test("the dream's undo leaves a merge alone when a later memory has settled over the merged one (it stays live now): no duplicates", () => {
    const c = brain();
    const { ids, m, dream } = merged(c);
    const s = c.store;
    const n = s.put({ type: "memory", kind: "fact", body: "The island ferry now leaves the north pier at nine.", origin: { session: "s2" } });
    expect(settle(s, { holds: n, over: m, how: "changed", actor: "owner" }).ok).toBe(true);
    expect(c.dreams.undo(dream)).toMatchObject({ ok: true, kept: 1 });
    expect(s.row(m)?.archived).toBe(0);
    for (const x of ids) {
      expect(s.row(x)?.fade).toBeCloseTo(0.5, 6);
      expect(headOf(s, x)).toBe(n);
    }
  });

  test("a merge from before the door (archived originals, no pairs) is undone the old way", () => {
    const c = brain();
    const s = c.store;
    for (let d = 4; d <= 12; d += 1) s.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const a = s.put({ type: "memory", kind: "fact", body: ORIGINALS[0] as string, origin: { session: "s1" } });
    const m = s.put({ type: "memory", kind: "fact", body: "The island ferry leaves the north pier at eight.", origin: { session: "s1" } });
    s.supersedeInto(a, m, DREAM_MERGE_REASON, { carryReturns: true });
    expect(headOf(s, a)).toBe(m);
    expect(s.restoreSuperseded(a, DREAM_MERGE_REASON)).toBe(true);
    expect(s.row(a)).toMatchObject({ archived: 0, superseded_by: null });
  });

  test("a proposal whose newer memory is merged through the door stays open; confirmed, the chain runs older → newer → merged", () => {
    const s = store();
    const older = put(s, "The release is planned for Friday.");
    const newer = put(s, "The release moved to Monday.");
    const p = proposeSlot(s, { holds: newer, candidate: { over: older, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p.ok) throw new Error(p.reason);
    const m = put(s, "The release moved to Monday morning.");
    expect(supersede(s, { holds: m, over: newer, how: "changed", source: DREAM_MERGE_REASON, actor: "dream" }).ok).toBe(true);
    // Both still stand, so nothing is orphaned or carried.
    expect(releaseOrphanSlots(s)).toBe(0);
    expect(s.contradiction(p.pair)?.state).toBe("unsettled");
    expect(settle(s, { pair: p.pair, holds: newer, how: "changed", why: "the newer state", actor: "dream" }).ok).toBe(true);
    expect(headOf(s, older)).toBe(m);
  });

  test("a later write that `updates` a merged original reaches the merged memory, as the forwarding address did", () => {
    const s = store();
    const a = put(s, "The island ferry leaves at eight from the north pier.");
    const m = put(s, "The island ferry leaves the north pier at eight.");
    expect(supersede(s, { holds: m, over: a, how: "changed", source: DREAM_MERGE_REASON, actor: "dream" }).ok).toBe(true);
    const n = put(s, "The island ferry now leaves the north pier at nine.");
    const out = applyRevision(s, Schemas.open({ store: s }), { updates: a, challengerId: n, day: s.livedDay(), method: "declared", how: "changed" }, {});
    expect(out).toMatchObject({ targetId: m, retargeted: true });
    expect(headOf(s, m)).toBe(n);
    expect(headOf(s, a)).toBe(n);
  });

  test("a proposal whose newer memory was replaced the old way (a forwarding address) is carried to its successor, its cut the same", () => {
    const s = store();
    const older = put(s, "The release is planned for Friday.");
    const newer = put(s, "The release moved to Monday.");
    const p = proposeSlot(s, { holds: newer, candidate: { over: older, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p.ok) throw new Error(p.reason);
    const cut = s.row(older)?.fade as number;
    expect(cut).toBeCloseTo(CONTRADICTION_TUNABLES.SLOT_FADE, 6);
    const m = put(s, "The release moved to Monday morning.");
    s.supersedeInto(newer, m, DREAM_MERGE_REASON);
    expect(releaseOrphanSlots(s)).toBe(1);
    expect(s.contradiction(p.pair)?.state).toBe("withdrawn");
    expect(s.contradictionBetween(m, older)).toMatchObject({ state: "unsettled", source: SLOT_SOURCE });
    expect(s.row(older)?.fade).toBeCloseTo(cut, 6);
  });
});

describe("the core path (review 10 C4), on the Han case's shape", () => {
  test("a declared change at a core memory with no status or date credits the slow cap a day: it crosses on the third lived day, not before", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const promise = core(s, "Promised Robin I would go back to the lake cabin.");
    const bar = revisionBar(s.physicsOf(promise), s.livedDay());
    // The precondition the three-day property is about: a bar a single day's cap cannot reach, two cannot either.
    expect(bar).toBeGreaterThan(0.7);
    expect(bar).toBeLessThan(1);
    const dates = ["2026-09-04", "2026-09-05", "2026-09-06"];
    for (const [i, d] of dates.entries()) {
      s.advanceClock(d);
      await srv.call("remember", {
        text: `Went back to the lake cabin with Robin, visit ${String(i + 1)}: the promise kept.`,
        kind: "person",
        updates: promise,
        how: "changed",
        // A low claim: its own force would be a small fraction of the bar.
        salience: 0.1,
      });
      const head = headOf(s, promise);
      if (i < 2) expect(head).toBeNull();
      else expect(head).not.toBeNull();
    }
    const pressure = s.eventLog({ name: "revision.pressure" }).map((e) => (JSON.parse(e.payload ?? "{}") as { force: number }).force);
    expect(pressure.every((f) => Math.abs(f - 0.35) < 1e-9)).toBe(true);
    // Through the door: a pair, source `pressure`; the old one out of the core, faded, live, labelled earlier.
    const successor = headOf(s, promise) as string;
    const crossing = s.contradictionBetween(successor, promise);
    expect(crossing).toMatchObject({ state: "settled", how: "changed", source: "pressure" });
    expect(s.row(promise)).toMatchObject({ archived: 0, superseded_by: null, promoted_identity: 0 });
    expect(s.row(promise)?.band).not.toBe("identity");
    expect(s.row(promise)?.fade).toBeCloseTo(0.5, 6);
    expect(standingOf(s, promise)?.prefix).toContain(`Earlier (now [${successor}])`);
    expect(s.row(successor)).toMatchObject({ band: "identity", archived: 0 });
    expect(settledEvents(s).at(-1)).toMatchObject({ source: "pressure", leftCore: true });
    // The crossing's undo: the core memory back in the core at full strength, the minted successor put away, the pair withdrawn.
    expect(srv.counterpart.undoContradiction({ pair: crossing?.id as string, actor: "owner" })).toMatchObject({ ok: true, state: "withdrawn" });
    expect(s.row(promise)).toMatchObject({ archived: 0, superseded_by: null, band: "identity", promoted_identity: 1, fade: 1 });
    expect(s.row(successor)).toMatchObject({ archived: 1, archived_reason: PRESSURE_UNDONE_REASON });
    expect(headOf(s, promise)).toBeNull();
  });

  test("a FULFILLED plan (a status, then `done`) leaves the core in one step, and the undo puts it back", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const plan = core(s, "Planning to take Robin back to the lake cabin this autumn.", { status: "planned" } as Partial<PutInput>);
    const r = payload(await srv.call("remember", { text: "Took Robin back to the lake cabin: the autumn plan is done.", kind: "person", updates: plan, how: "changed", status: "done" }));
    const done = String(r["id"]);
    // `changed` plus the core path: out of the core, faded, live, labelled earlier.
    expect(s.row(plan)).toMatchObject({ archived: 0, superseded_by: null, promoted_identity: 0 });
    expect(s.row(plan)?.band).not.toBe("identity");
    expect(s.row(plan)?.fade).toBeCloseTo(0.5, 6);
    expect(headOf(s, plan)).toBe(done);
    // No pressure was needed, and the `done` memory is not core.
    expect(s.eventLog({ name: "revision.pressure" })).toHaveLength(0);
    expect(s.physicsOf(done).promotedIdentity).toBe(false);
    const pair = s.contradictionBetween(done, plan);
    expect(pair).toMatchObject({ state: "settled", how: "changed", source: FULFILLED_SOURCE });
    // The owner can see it happened: the settle's event says the plan left the core.
    expect(settledEvents(s).at(-1)).toMatchObject({ source: FULFILLED_SOURCE, leftCore: true });
    expect(srv.counterpart.undoContradiction({ pair: pair?.id as string, actor: "owner" }).ok).toBe(true);
    expect(s.row(plan)).toMatchObject({ archived: 0, superseded_by: null, band: "identity", fade: 1 });
    expect(s.physicsOf(plan).promotedIdentity).toBe(true);
    expect(headOf(s, plan)).toBeNull();
  });

  test("a DATED core plan (no status) fulfilled by a `done` write: out of the core in one step, and its reminder spent on both memories", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const plan = core(s, "Taking Robin back to the lake cabin on the 20th.", { eventDate: "2099-11-20", meta: { [CUE_MODE_META]: "plain" } } as Partial<PutInput>);
    expect(s.physicsOf(plan).hold?.state).toBe("pending");
    const r = payload(await srv.call("remember", { text: "Took Robin back to the lake cabin: the trip is done.", kind: "person", updates: plan, how: "changed", status: "done" }));
    const done = String(r["id"]);
    expect(headOf(s, plan)).toBe(done);
    expect(s.row(plan)).toMatchObject({ promoted_identity: 0, event_date: null });
    // The `done` memory did not inherit the date to fire on a trip already made.
    expect(s.row(done)?.event_date).toBeNull();
    expect(new Prospective({ store: s }).plainDue({ at: "2099-11-20" })).toEqual([]);
    expect(s.eventLog({ name: "revision.pressure" })).toHaveLength(0);
    // The undo puts the plan back in the core (the date moved at the write, as any write's move does, and stays where it went).
    const pair = s.contradictionBetween(done, plan);
    expect(srv.counterpart.undoContradiction({ pair: pair?.id as string, actor: "owner" }).ok).toBe(true);
    expect(s.row(plan)).toMatchObject({ promoted_identity: 1, band: "identity" });
  });

  test("a settle by a `done` holder over a dated core plan through the door spends the reminder and the undo brings it back", () => {
    const s = store();
    const plan = put(s, "Renew the passport before the trip.", { eventDate: "2099-11-20", meta: { [CUE_MODE_META]: "plain" } } as Partial<PutInput>);
    const done = put(s, "Renewed the passport.", { status: "done" } as Partial<PutInput>);
    const out = supersede(s, { holds: done, over: plan, how: "changed", source: FULFILLED_SOURCE, actor: "session" });
    if (!out.ok) throw new Error(out.reason);
    expect(s.readProse(plan).meta[REMINDER_SPENT_BY_META]).toBe(done);
    expect(new Prospective({ store: s }).plainDue({ at: "2099-11-20" })).toEqual([]);
    expect(undo(s, { pair: out.pair, actor: "owner" }).ok).toBe(true);
    expect(new Prospective({ store: s }).plainDue({ at: "2099-11-20" }).map((d) => d.memoryId)).toContain(plan);
  });

  test("an UNRELATED `done` write that names a core plan is held by the update guard, not fast-laned out of the core", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const plan = core(s, "Planning to take Robin back to the lake cabin this autumn.", { status: "planned" } as Partial<PutInput>);
    await srv.call("remember", { text: "Paid the electricity bill for the flat online.", updates: plan, how: "changed", status: "done" });
    expect(s.row(plan)).toMatchObject({ promoted_identity: 1, band: "identity", fade: 1 });
    expect(headOf(s, plan)).toBeNull();
  });

  test("a protected core plan is never fast-laned out", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const plan = core(s, "Planning to take Robin back to the lake cabin this autumn.", { status: "planned" } as Partial<PutInput>);
    s.updatePhysics(plan, { protected: true });
    await srv.call("remember", { text: "Took Robin back to the lake cabin: the autumn plan is done.", kind: "person", updates: plan, how: "changed", status: "done" });
    expect(s.row(plan)).toMatchObject({ promoted_identity: 1, band: "identity" });
    expect(headOf(s, plan)).toBeNull();
  });

  test("a core memory with no status or date is not fast-laned by a `done` (the brief's rule, held as written)", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const promise = core(s, "Promised Robin I would go back to the lake cabin.");
    await srv.call("remember", { text: "Went back to the lake cabin with Robin: the promise kept.", kind: "person", updates: promise, how: "changed", status: "done" });
    expect(s.row(promise)?.archived).toBe(0);
    expect(s.eventLog({ name: "revision.pressure" })).toHaveLength(1);
  });
});

describe("a pending reminder through the door (review 07)", () => {
  test("a settle over a dated memory carries the reminder to an undated holder, where it FIRES; the undo carries it back", () => {
    const s = store();
    const dated = put(s, "Renew the boat licence before the deadline.", { eventDate: "2099-10-15", meta: { [CUE_MODE_META]: "plain" } } as Partial<PutInput>);
    expect(s.physicsOf(dated).hold?.state).toBe("pending");
    const newer = put(s, "The boat licence renewal form is half filled in.");
    const out = settle(s, { holds: newer, over: dated, how: "changed", why: "the newer state", actor: "dream" });
    if (!out.ok) throw new Error(out.reason);
    expect(s.row(newer)?.event_date).toBe("2099-10-15");
    expect(s.row(dated)?.event_date).toBeNull();
    expect(s.readProse(dated).meta[DATE_MOVED_TO_META]).toBe(newer);
    expect(s.physicsOf(newer).hold?.state).toBe("pending");
    const due = new Prospective({ store: s }).plainDue({ at: "2099-10-15" }).map((d) => d.memoryId);
    expect(due).toContain(newer);
    expect(due).not.toContain(dated);
    expect(undo(s, { pair: out.pair, actor: "owner" }).ok).toBe(true);
    expect(s.row(dated)?.event_date).toBe("2099-10-15");
    expect(s.row(newer)?.event_date).toBeNull();
  });

  test("a holder that says it is done does not take the reminder: it is spent, on neither memory, and the undo puts it back", () => {
    const s = store();
    const dated = put(s, "Renew the boat licence before the deadline.", { eventDate: "2099-10-15", meta: { [CUE_MODE_META]: "plain" } } as Partial<PutInput>);
    const done = put(s, "Renewed the boat licence.", { status: "done" } as Partial<PutInput>);
    const out = settle(s, { holds: done, over: dated, how: "changed", why: "done", actor: "dream" });
    if (!out.ok) throw new Error(out.reason);
    expect(s.row(done)?.event_date).toBeNull();
    expect(s.row(dated)?.event_date).toBeNull();
    expect(new Prospective({ store: s }).plainDue({ at: "2099-10-15" })).toEqual([]);
    expect(undo(s, { pair: out.pair, actor: "owner" }).ok).toBe(true);
    expect(s.row(dated)?.event_date).toBe("2099-10-15");
  });
});

describe("a moved reminder's old memory steps back (review 07 §4.3, C2)", () => {
  test("a reminder carried from further along its chain writes a reminder-moved row from the new holder", async () => {
    const srv = server();
    const s = srv.counterpart.store;
    const first = String(payload(await srv.call("remember", { text: "Dentist appointment for the cleaning.", eventDate: "2099-11-20" }))["id"]);
    const second = String(payload(await srv.call("remember", { text: "Dentist appointment for the cleaning, confirmed by phone.", updates: first }))["id"]);
    expect(s.row(second)?.event_date).toBe("2099-11-20");
    // Addressed by the FIRST id: the reminder lives on the second now.
    const third = String(payload(await srv.call("remember", { text: "Dentist appointment for the cleaning moved to the 21st.", updates: first, eventDate: "2099-11-21" }))["id"]);
    expect(s.row(third)?.event_date).toBe("2099-11-21");
    expect(s.row(second)?.event_date).toBeNull();
    const row = s.contradictionBetween(third, second);
    expect(row).toMatchObject({ state: "settled", how: "changed", holds: third, over: second, source: REMINDER_MOVED_SOURCE });
    // The direct one (first → second) is the writer's own, as before.
    expect(s.contradictionBetween(second, first)?.source).toBe("write");
  });

  test("the once-only pass over older remnants: one row each, idempotent, never a memory that still holds a date", () => {
    const s = store();
    const holder = put(s, "Check the webhook events on the 20th.", { eventDate: "2099-12-20" } as Partial<PutInput>);
    const remnant = put(s, "Check the webhook events soon.", { meta: { [DATE_MOVED_TO_META]: holder } } as Partial<PutInput>);
    const datedRemnant = put(s, "Check the webhook events on the 19th.", { eventDate: "2099-12-19", meta: { [DATE_MOVED_TO_META]: holder } } as Partial<PutInput>);
    expect(settleMovedReminders(s)).toBe(1);
    expect(s.contradictionBetween(holder, remnant)).toMatchObject({ state: "settled", how: "changed", source: REMINDER_MOVED_SOURCE });
    expect(s.row(remnant)?.fade).toBeCloseTo(0.5, 6);
    expect(s.contradictionBetween(holder, datedRemnant)).toBeUndefined();
    expect(s.getMeta(REMINDERS_MOVED_META)).toBeDefined();
    expect(settleMovedReminders(s)).toBe(0);
    expect(settleMovedReminders(s, { force: true })).toBe(0);
  });
});

describe("order: a late answer does not undo a newer settle (review of #420 (a))", () => {
  test("B proposed over A; C settled over B; the proposal stays open, and confirming it later leaves B earlier, under C", () => {
    const s = store();
    const a = put(s, "The launch is planned for March.");
    const b = put(s, "The launch moved to April.");
    const p = proposeSlot(s, { holds: b, candidate: { over: a, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p.ok) throw new Error(p.reason);
    s.advanceClock("2026-09-04");
    const c = put(s, "The launch moved again, to May.");
    expect(settle(s, { holds: c, over: b, how: "changed", actor: "owner" }).ok).toBe(true);
    expect(s.contradiction(p.pair)?.state).toBe("unsettled");
    s.advanceClock("2026-09-05");
    expect(settle(s, { pair: p.pair, holds: b, how: "changed", why: "the newer state", actor: "dream" }).ok).toBe(true);
    expect(headOf(s, b)).toBe(c);
    expect(headOf(s, a)).toBe(c);
    // The wake's "settled over" agrees: B is earlier, not current.
    expect(settledOver(s).has(b)).toBe(true);
  });

  test("a dream FLAG raised before the newer settle, answered after it, does not re-affirm B either", () => {
    const s = store();
    const a = put(s, "The launch is planned for March.");
    const b = put(s, "The launch moved to April.");
    const f = flag(s, { x: a, y: b, source: "dream", day: s.livedDay() });
    if (!f.ok) throw new Error("flag refused");
    s.advanceClock("2026-09-04");
    const c = put(s, "The launch moved again, to May.");
    expect(settle(s, { holds: c, over: b, how: "changed", actor: "owner" }).ok).toBe(true);
    s.advanceClock("2026-09-05");
    // The flag closed through C's settle (Group 2, C5), so the late answer is refused, and B stays under C.
    expect(settle(s, { pair: f.pair, holds: b, how: "changed", why: "the newer state", actor: "dream" })).toMatchObject({ ok: false, reason: "already-settled" });
    expect(headOf(s, b)).toBe(c);
  });

  test("a FRESH direct settle B over A made after C over B speaks only about A and B: B stays under C (Group 3 part B; was #408's re-affirm)", () => {
    const s = store();
    const a = put(s, "The launch is planned for March.");
    const b = put(s, "The launch moved to April.");
    const c = put(s, "The launch moved again, to May.");
    expect(settle(s, { holds: c, over: b, how: "changed", actor: "owner" }).ok).toBe(true);
    s.advanceClock("2026-09-04");
    expect(settle(s, { holds: b, over: a, how: "changed", actor: "owner" }).ok).toBe(true);
    expect(headOf(s, a)).toBe(c);
    expect(headOf(s, b)).toBe(c);
    expect(settledOver(s).has(b)).toBe(true);
  });
});

describe("with dreaming off, nothing answers a proposal (review of #420 (d))", () => {
  test("withdrawn with its cut put back after the wait, only when dreaming is off", () => {
    const s = store();
    const older = put(s, "The bus pass costs forty a month.");
    const newer = put(s, "The bus pass costs forty-five a month now.");
    const p = proposeSlot(s, { holds: newer, candidate: { over: older, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p.ok) throw new Error(p.reason);
    const later = s.livedDay() + CONTRADICTION_TUNABLES.SLOT_EXPIRY_DAYS;
    expect(expireUnanswerableSlots(s, later)).toBe(0);
    s.setMeta("dream.setting", "off");
    expect(expireUnanswerableSlots(s, later - 1)).toBe(0);
    expect(expireUnanswerableSlots(s, later)).toBe(1);
    expect(s.contradiction(p.pair)?.state).toBe("withdrawn");
    expect(s.row(older)?.fade).toBe(1);
  });
});

describe("ambient recall: a quiet pointer to a head hides its earlier version (left from #420)", () => {
  const FILLER = [
    "The garage door opener needs a new battery soon.",
    "Rebasing keeps the history readable for reviewers.",
    "The library closes early on Sundays now.",
    "The kitchen tap drips when the pressure is high.",
    "The bus route changed and adds ten minutes.",
    "Planted three tomato seedlings in the planter.",
    "Fixed the wobbling chair leg with a shim.",
    "Started keeping receipts in one envelope.",
    "The printer jams on heavy paper stock.",
    "Set up a standing desk in the spare bedroom.",
    "Wrote a short letter to an old teacher.",
    "Bought hiking boots that finally fit properly.",
  ];

  test("the turn reaches the earlier version by its words and the head only by a link: the head shows, the earlier does not", () => {
    const s = store();
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const anchor = s.put({ type: "memory", kind: "fact", body: "The sourdough starter died after two weeks of neglect.", physics: { birthDay: 0, lastUsedDay: 0 } });
    const earlier = s.put({ type: "memory", kind: "fact", body: "Sourdough starter feeding: once a week is plenty." });
    const head = s.put({ type: "memory", kind: "fact", body: "Vellichor quixotry zygomorphic ephemera petrichor." });
    expect(settle(s, { holds: head, over: earlier, how: "changed", actor: "owner" }).ok).toBe(true);
    const associate = new Associate({ store: s });
    for (let i = 0; i < 6; i += 1) {
      associate.coactivate([
        { id: anchor, tier: "referenced" },
        { id: head, tier: "referenced" },
      ]);
      associate.flush();
    }
    const r = new Recall({ store: s });
    const d = recallTurn(r, { sessionId: "s1", text: "my sourdough starter died, how often should I feed it" }, { associate }).decision;
    const shown = [...d.surfaced, ...d.footnotes];
    expect(shown).toContain(head);
    expect(shown).not.toContain(earlier);
  });
});
