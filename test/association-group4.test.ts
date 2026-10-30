/**
 * Group 4 — association (2026-10-11, review 06 §5–6, bench item 5). Ants:
 * faint trails laid by co-activation, strengthened by use, evaporating
 * without it. Item 1 (drewOn deposits) is in `drewon.test.ts`; item 6 (lag 1
 * only) in `association-build2.test.ts` › "4.".
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as ASSOCIATE_TUNABLES, TERMINAL_ARCHIVE_GRACE_MS, TERMINAL_ARCHIVE_LATCHES,
  TERMINAL_ARCHIVE_REASONS, planAtWrite } from "../src/core/associate/index.js";
import { DREAM_MERGE_REASON } from "../src/core/dream/index.js";
import { EPISODE_REGROWN_REASON } from "../src/core/leaving.js";
import { ASKED_KIND, activate, askedTurn, freshGateState, loadGateState, saveGateState, withTunables as withRecallTunables } from "../src/core/recall/index.js";
import { mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import { LIGHT, MEMORY_MECHANISMS, readMechanism } from "../src/adapters/cli/mechanisms.js";
import { MECHANISM_DAYS, lightOf } from "../src/adapters/dashboard/web/views/mechanisms.js";
import type { GateState } from "../src/core/recall/index.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const brains: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-group4-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of brains.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

const T = ASSOCIATE_TUNABLES;
/** `WRITE_LINK_MAX` before the 2026-10-19 experiment turned it off: the revert value. */
const WRITE_LINK_MAX_WHEN_ON = 4;

function brainAt(clock: { now: number }, opts: { observer?: boolean } = {}): Counterpart {
  const c = Counterpart.open({ dir, now: () => clock.now, ...(opts.observer === true ? { observer: true } : {}) });
  findable(c.store);
  brains.push(c);
  return c;
}

function memoryIn(c: Counterpart, session: string, body: string): string {
  return c.store.put({ type: "memory", kind: "fact", body, origin: { session } });
}

/** A memory written in the moment, through the jot door (the note tool). */
async function jotIn(c: Counterpart, session: string, content: string): Promise<string> {
  const out = await c.submitJot({ content, kind: "fact" }, { session, scope: "proj" });
  expect(out.deposited).toBe(true);
  return out.memoryId as string;
}

/** A memory written in a session's write-up (the session_end door). */
async function writtenUpIn(c: Counterpart, session: string, content: string): Promise<string> {
  const out = await c.submitSessionEnd({ content, kind: "fact" }, { session, scope: "proj" });
  expect(out.deposited).toBe(true);
  return out.memoryId as string;
}

/** Turn a write-time knob for one brain (no `open` option takes the associate's tunables). */
function tune(c: Counterpart, over: Partial<typeof ASSOCIATE_TUNABLES>): void {
  const a = c.associate as unknown as { tunables: typeof ASSOCIATE_TUNABLES };
  a.tunables = { ...a.tunables, ...over };
}

/** Record `ids` as shown to `sessionId` on `turn`, as recall's own save would. */
function shown(c: Counterpart, sessionId: string, turn: number, ids: readonly string[], over: Partial<GateState["surfaced"][string]> = {}): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true, ...over };
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn: Math.max(prior.turn, turn), lastDay: c.store.livedDay(), surfaced }, 200);
}

const DAY = 24 * 60 * 60_000;

// ═══════════════════════════════════════════════════════════════════════════
// 2. Write-time links: a new memory, faintly linked to what was in mind
// ═══════════════════════════════════════════════════════════════════════════
describe("2. write-time links to what was in mind (bench item 5)", () => {
  // Off by default since 2026-10-19 (an experiment; check ~10-22): these tests
  // turn them back on, as they were, so the mechanism stays proven for a revert.
  const ON = { ...T, WRITE_LINK_MAX: WRITE_LINK_MAX_WHEN_ON };
  function brainOn(clock: { now: number }, opts: { observer?: boolean } = {}): Counterpart {
    const c = brainAt(clock, opts);
    tune(c, { WRITE_LINK_MAX: WRITE_LINK_MAX_WHEN_ON });
    return c;
  }

  test("off (WRITE_LINK_MAX 0, the 2026-10-19 experiment): a memory written in the moment gets no write-time link, contiguity still lands, existing edges stay", async () => {
    const clock = { now: Date.UTC(2026, 4, 20, 9) };
    const c = brainAt(clock);
    tune(c, { WRITE_LINK_MAX: 0 });
    c.store.advanceClock("2026-05-20");
    const left = memoryIn(c, "conv-0520", "I left home at 7 AM on Monday to get to the clinic appointment.");
    const laid = memoryIn(c, "conv-0520", "An older write-time link's other end.");
    await c.sessionEnd({ date: "2026-05-20", budgetBytes: 9000, session: "conv-0520" });
    // An edge laid before the switch, at the write-time weight: kept.
    const before = c.store.livedDay();
    c.store.linkMany([
      { src: left, dst: laid, weight: T.WRITE_LINK_WEIGHT, day: before },
      { src: laid, dst: left, weight: T.WRITE_LINK_WEIGHT, day: before },
    ]);
    clock.now += DAY;
    c.store.advanceClock("2026-05-21");
    const out = c.recallForTurn({ sessionId: "conv-0521", text: "how long does the trip to the clinic take" });
    expect([...out.decision.surfaced, ...out.decision.footnotes]).toContain(left);
    clock.now += 60_000;
    const took = await jotIn(c, "conv-0521", "It took two hours to get to the clinic last time.");
    clock.now += 60_000;
    const next = await jotIn(c, "conv-0521", "Next time I will take the earlier bus to the clinic.");
    const report = await c.sessionEnd({ date: "2026-05-21", budgetBytes: 9000, session: "conv-0521" });
    expect(report.contiguity.atWrite).toBeUndefined();
    expect(c.associate.linked(took, left)).toBe(false);
    expect(c.associate.linked(next, left)).toBe(false);
    // Contiguity is unchanged: the two jots, written next to each other, are linked.
    expect(c.associate.linked(took, next)).toBe(true);
    const rows = c.store.eventLog({ name: "associate.flush" });
    const last = JSON.parse(rows[rows.length - 1]?.payload ?? "{}") as { atWrite?: unknown };
    expect(last.atWrite).toBeUndefined();
    // The edge laid before is still there, fading on its own.
    expect(c.store.edgesFrom(left).some((e) => e.dst === laid)).toBe(true);
  });

  test("the planner: nearest in mind first, at most WRITE_LINK_MAX, never to itself or a memory of the same pass", () => {
    const inMind = ["x1", "new2", "x2", "x1", "new1", "x3", "x4", "x5", "x6"];
    const plan = planAtWrite(
      [
        { id: "new1", inMind },
        { id: "new2", inMind: ["x1"] },
      ],
      ON,
    );
    const first = plan.pairs.filter((p) => p.a === "new1").map((p) => p.b);
    expect(first).toEqual(["x1", "x2", "x3", "x4"].slice(0, ON.WRITE_LINK_MAX));
    expect(plan.pairs.filter((p) => p.a === "new2").map((p) => p.b)).toEqual(["x1"]);
    expect(plan.memories).toBe(2);
    expect(planAtWrite([{ id: "solo", inMind: ["solo"] }], ON).pairs).toEqual([]);
    // Off (`WRITE_LINK_MAX` 0) plans nothing.
    expect(planAtWrite([{ id: "new1", inMind }], { ...T, WRITE_LINK_MAX: 0 }).pairs).toEqual([]);
  });

  test("the clinic pair (bench 73d42213): a memory written in the moment, after recall showed an older one, is linked to it, faintly", async () => {
    const clock = { now: Date.UTC(2026, 4, 20, 9) };
    const c = brainOn(clock);
    c.store.advanceClock("2026-05-20");
    for (const body of [
      "The bakery on the corner sells out of rye bread by noon on Saturdays.",
      "The library returns box is emptied twice a day, at nine and at four.",
      "The bus to the station runs every twenty minutes until midnight.",
    ]) memoryIn(c, "conv-0520", body);
    const left = memoryIn(c, "conv-0520", "I left home at 7 AM on Monday to get to the clinic appointment.");
    await c.sessionEnd({ date: "2026-05-20", budgetBytes: 9000, session: "conv-0520" });

    clock.now += 10 * DAY;
    c.store.advanceClock("2026-05-30");
    const out = c.recallForTurn({ sessionId: "conv-0530", text: "how long does the trip to the clinic take" });
    expect([...out.decision.surfaced, ...out.decision.footnotes]).toContain(left);
    clock.now += 60_000;
    const took = await jotIn(c, "conv-0530", "It took two hours to get to the clinic last time.");
    const report = await c.sessionEnd({ date: "2026-05-30", budgetBytes: 9000, session: "conv-0530" });

    expect(report.contiguity.atWrite?.reason).toBe("linked");
    expect(report.contiguity.atWrite?.landed).toBeGreaterThanOrEqual(1);
    const day = c.store.edgesFrom(took).find((e) => e.dst === left)?.last_day ?? -1;
    expect(c.associate.weightAt(took, left, day)).toBeCloseTo(T.WRITE_LINK_WEIGHT, 10);
    expect(c.associate.weightAt(left, took, day)).toBeCloseTo(T.WRITE_LINK_WEIGHT, 10);
    // Counted on the boundary's row.
    const rows = c.store.eventLog({ name: "associate.flush" });
    const last = JSON.parse(rows[rows.length - 1]?.payload ?? "{}") as { atWrite?: Record<string, unknown> };
    expect(last.atWrite?.["landed"]).toBe(report.contiguity.atWrite?.landed);
  });

  test("the same memory written in the session's write-up is linked to nothing: what the last turns showed was not in mind when it happened", async () => {
    const clock = { now: Date.UTC(2026, 4, 20, 9) };
    const c = brainOn(clock);
    c.store.advanceClock("2026-05-20");
    const left = memoryIn(c, "conv-0520", "I left home at 7 AM on Monday to get to the clinic appointment.");
    await c.sessionEnd({ date: "2026-05-20", budgetBytes: 9000, session: "conv-0520" });
    clock.now += 10 * DAY;
    c.store.advanceClock("2026-05-30");
    const out = c.recallForTurn({ sessionId: "conv-0530", text: "how long does the trip to the clinic take" });
    expect([...out.decision.surfaced, ...out.decision.footnotes]).toContain(left);
    clock.now += 60_000;
    const took = await writtenUpIn(c, "conv-0530", "It took two hours to get to the clinic last time.");
    // A chapter copy or any row without a door reads the same way.
    const copied = memoryIn(c, "conv-0530", "A row with no deposit behind it, like a chapter copy.");
    const report = await c.sessionEnd({ date: "2026-05-30", budgetBytes: 9000, session: "conv-0530" });
    expect(report.contiguity.atWrite).toBeUndefined();
    expect(c.associate.linked(took, left)).toBe(false);
    expect(c.associate.linked(copied, left)).toBe(false);
  });

  test("only the write's own turn is in mind (WRITE_LINK_TURNS); an ambiguous handle and another session's showings are not", async () => {
    expect(T.WRITE_LINK_TURNS).toBe(1);
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainOn(clock);
    c.store.advanceClock("2026-09-01");
    const old = memoryIn(c, "s0", "Shown on the turn before.");
    const recent = memoryIn(c, "s0", "Shown on the write's own turn.");
    const ambiguous = memoryIn(c, "s0", "Shown only through an ambiguous handle.");
    const elsewhere = memoryIn(c, "s0", "Shown to another session.");
    await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    clock.now += DAY;
    c.store.advanceClock("2026-09-02");
    shown(c, "s1", 1, [old]);
    shown(c, "s1", 1 + T.WRITE_LINK_TURNS, [recent]);
    shown(c, "s1", 1 + T.WRITE_LINK_TURNS, [ambiguous], { trains: false });
    shown(c, "s2", 1 + T.WRITE_LINK_TURNS, [elsewhere]);
    const fresh = await jotIn(c, "s1", "Noted in the moment, on that turn.");
    const report = await c.sessionEnd({ date: "2026-09-02", budgetBytes: 9000 });
    expect(report.contiguity.atWrite?.pairs).toBe(1);
    expect(c.associate.linked(fresh, recent)).toBe(true);
    for (const other of [old, ambiguous, elsewhere]) expect(c.associate.linked(fresh, other)).toBe(false);
  });

  test("a deliberate question's answer is not in mind by default; with WRITE_LINK_ASKED_MS on, a near one is, first, for any door", async () => {
    expect(T.WRITE_LINK_ASKED_MS).toBe(0);
    for (const on of [false, true]) {
      const clock = { now: Date.UTC(2026, 8, 1, 9) };
      const c = brainOn(clock);
      if (on) tune(c, { WRITE_LINK_ASKED_MS: 15 * 60_000 });
      c.store.advanceClock("2026-09-01");
      const asked = memoryIn(c, `s0-${String(on)}`, "The answer to a deliberate question.");
      const stale = memoryIn(c, `s0-${String(on)}`, "Asked about hours before.");
      await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
      clock.now += DAY;
      c.store.advanceClock("2026-09-02");
      const day = c.store.livedDay();
      const s = `s1-${String(on)}`;
      c.store.setGateRecords([
        { sessionId: s, kind: ASKED_KIND, ref: stale, turn: askedTurn(clock.now - 3 * 60 * 60_000), lastDay: day, tier: "asked", trains: true },
        { sessionId: s, kind: ASKED_KIND, ref: asked, turn: askedTurn(clock.now - 60_000), lastDay: day, tier: "asked", trains: true },
      ]);
      const fresh = await writtenUpIn(c, s, `Written up just after asking, ${on ? "with" : "without"} the knob.`);
      await c.sessionEnd({ date: "2026-09-02", budgetBytes: 9000 });
      expect(c.associate.linked(fresh, asked)).toBe(on);
      expect(c.associate.linked(fresh, stale)).toBe(false);
      c.close();
      brains.splice(0);
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-group4-"));
      process.env[ENV] = dir;
    }
  });

  test("room-only: a full node refuses the faint link and loses nothing it learned", async () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainOn(clock, {});
    c.store.advanceClock("2026-09-01");
    const hub = memoryIn(c, "s0", "A memory whose links are full.");
    const others = Array.from({ length: T.MAX_EDGES_PER_NODE }, (_, i) => memoryIn(c, "sx", `Neighbour number ${String(i)} of the hub.`));
    await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    const day = c.store.livedDay();
    c.store.linkMany(others.flatMap((o) => [
      { src: hub, dst: o, weight: 0.1, day },
      { src: o, dst: hub, weight: 0.1, day },
    ]));
    shown(c, "s1", 1, [hub]);
    const fresh = await jotIn(c, "s1", "Noted while the hub was in mind.");
    const report = await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    expect(report.contiguity.atWrite?.noRoom).toBe(1);
    expect(c.associate.linked(fresh, hub)).toBe(false);
    expect(c.store.edgesFrom(hub).filter((e) => e.weight > T.EDGE_FLOOR).length).toBe(T.MAX_EDGES_PER_NODE);
  });

  test("an observer lays nothing at write time", async () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const owner = brainOn(clock);
    owner.store.advanceClock("2026-09-01");
    const before = memoryIn(owner, "s0", "Shown before the write.");
    await owner.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    shown(owner, "s1", 1, [before]);
    await jotIn(owner, "s1", "Noted while it was in mind.");
    owner.close();
    brains.splice(0);
    const watcher = brainOn(clock, { observer: true });
    const report = await watcher.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    expect(report.contiguity.reason).toBe("observer");
    expect(watcher.store.edgesFrom(before)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Replay deposits: the bundle proposes faint links, no model call
// ═══════════════════════════════════════════════════════════════════════════
describe("3. replay deposits (review 06 C2)", () => {
  /** An older memory, ten lived days back, and two new ones today that share its words. */
  function night(c: Counterpart): { old: string; fresh: string[] } {
    c.store.advanceClock("2026-05-20");
    const old = c.store.put({
      type: "memory",
      kind: "fact",
      body: "I left home at seven on Monday morning to reach the clinic appointment in time.",
      origin: { session: "conv-0520" },
      salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    });
    for (let d = 21; d <= 30; d += 1) c.store.advanceClock(`2026-05-${String(d)}`);
    const fresh = [
      "It took two hours to get to the clinic appointment last time.",
      "The clinic appointment moved to Thursday afternoon.",
    ].map((body) => c.store.put({ type: "memory", kind: "fact", body, origin: { session: "conv-0530" }, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 } }));
    return { old, fresh };
  }

  test("opening a dream links each new memory to the older neighbours shown beside it, at REPLAY_LINK_WEIGHT, room-only", () => {
    const clock = { now: Date.UTC(2026, 4, 30, 22) };
    const c = brainAt(clock);
    const { old, fresh } = night(c);
    const out = c.dreams.begin({ session: "night" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const pairs = out.bundle.fresh.flatMap((f) => f.neighbours.map((n) => [f.id, n] as const));
    expect(pairs.some(([, n]) => n === old)).toBe(true);
    const day = c.store.livedDay();
    for (const [a, b] of pairs) {
      expect(c.associate.weightAt(a, b, day)).toBeCloseTo(DREAM_TUNABLES.REPLAY_LINK_WEIGHT, 10);
      expect(c.associate.weightAt(b, a, day)).toBeCloseTo(DREAM_TUNABLES.REPLAY_LINK_WEIGHT, 10);
    }
    expect(fresh.some((f) => c.associate.linked(f, old))).toBe(true);
    // Durable, on the dream's own row — and not a change the dream made.
    const begun = JSON.parse(c.store.eventLog({ name: "dream.begun" }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    expect(begun["replayPairs"]).toBe(pairs.length);
    expect(begun["replayLinks"]).toBe(pairs.length);
    // F1: how far down the queue the night reached.
    expect(begun["freshCutP"]).toBeGreaterThan(0);
    expect(c.store.dreamChanges(out.bundle.dream)).toEqual([]);
  });

  test("a stronger link use already laid is never lowered by the replay", () => {
    const clock = { now: Date.UTC(2026, 4, 30, 22) };
    const c = brainAt(clock);
    const { old, fresh } = night(c);
    const day = c.store.livedDay();
    c.store.linkMany(fresh.flatMap((f) => [
      { src: f, dst: old, weight: 0.3, day },
      { src: old, dst: f, weight: 0.3, day },
    ]));
    expect(c.dreams.begin({ session: "night" }).ok).toBe(true);
    for (const f of fresh) expect(c.associate.weightAt(f, old, day)).toBeCloseTo(0.3, 10);
  });

  test("undoing the dream leaves the replay's trails, and the evidence still counts them", () => {
    const clock = { now: Date.UTC(2026, 4, 30, 22) };
    const c = brainAt(clock);
    const { old, fresh } = night(c);
    const out = c.dreams.begin({ session: "night" });
    if (!out.ok) throw new Error("begin refused");
    const linked = fresh.filter((f) => c.associate.linked(f, old));
    expect(linked.length).toBeGreaterThan(0);
    expect(c.dreams.undo(out.bundle.dream).ok).toBe(true);
    for (const f of linked) expect(c.associate.linked(f, old)).toBe(true);
    const day = c.store.livedDay();
    const v = mechanismEvidence(c.store, { sinceDay: day - 6, today: day }).verdicts.find((x) => x.id === "association")!;
    expect(v.parts.find((p) => p.key === "replayed")?.count).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The sweep: rows whose endpoint is archived for good
// ═══════════════════════════════════════════════════════════════════════════
describe("5. rows with an endpoint archived for good are swept (review 06 C3)", () => {
  test("the reasons are the regrown copy's, the dream merge's and (Group 2b) a correction's — the constants those paths write", () => {
    expect([...TERMINAL_ARCHIVE_REASONS].sort()).toEqual([DREAM_MERGE_REASON, EPISODE_REGROWN_REASON, "corrected"].sort());
  });

  test("after a flush: regrown, dream-merge and corrected rows go; a decay archive and a pinned memory keep theirs", async () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainAt(clock);
    c.store.advanceClock("2026-09-01");
    const hub = memoryIn(c, "s0", "The hub every other memory is linked to.");
    const ends = Object.fromEntries(
      ["regrown", "merged", "decayed", "corrected", "live"].map((k) => [k, memoryIn(c, "s0", `The ${k} end of a link.`)]),
    ) as Record<string, string>;
    ends["pinned"] = c.store.put({ type: "memory", kind: "fact", body: "The pinned end of a link.", origin: { session: "s0" }, physics: { protected: true } });
    await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    const day = c.store.livedDay();
    c.store.linkMany(Object.values(ends).flatMap((e) => [
      { src: hub, dst: e, weight: 0.2, day },
      { src: e, dst: hub, weight: 0.2, day },
    ]));
    c.store.archive(ends["regrown"]!, EPISODE_REGROWN_REASON);
    c.store.archive(ends["merged"]!, DREAM_MERGE_REASON);
    c.store.archive(ends["decayed"]!, "pruned");
    c.store.archive(ends["corrected"]!, "corrected");
    c.store.archive(ends["pinned"]!, EPISODE_REGROWN_REASON);
    clock.now += TERMINAL_ARCHIVE_GRACE_MS + 1;
    // Any flush sweeps: here, a co-use the boundary lands.
    c.associate.absorb([{ a: hub, b: ends["live"]!, delta: 0.1 }]);
    const report = c.associate.flush();
    // Every row touching the two (the hub's, and the boundary's own contiguity rows).
    const touching = (x: string): number => c.store.allEdges().filter((e) => e.src === x || e.dst === x).length;
    expect(report.sweptArchived).toBeGreaterThanOrEqual(6);
    expect(touching(ends["regrown"]!) + touching(ends["merged"]!) + touching(ends["corrected"]!)).toBe(0);
    const linked = (x: string): boolean => c.store.edgesFrom(hub).some((e) => e.dst === x) || c.store.edgesFrom(x).some((e) => e.dst === hub);
    expect(linked(ends["regrown"]!)).toBe(false);
    expect(linked(ends["merged"]!)).toBe(false);
    expect(linked(ends["corrected"]!)).toBe(false);
    for (const k of ["decayed", "pinned", "live"]) expect(linked(ends[k]!)).toBe(true);
  });

  test("a reason whose one-time carry has not latched is left alone (review of #423; Group 2b)", async () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainAt(clock);
    c.store.advanceClock("2026-09-01");
    const hub = memoryIn(c, "s0", "The hub every other memory is linked to.");
    const regrown = memoryIn(c, "s0", "The regrown end of a link.");
    const corrected = memoryIn(c, "s0", "The corrected end of a link.");
    await c.sessionEnd({ date: "2026-09-01", budgetBytes: 9000 });
    const day = c.store.livedDay();
    c.store.linkMany([regrown, corrected].flatMap((e) => [
      { src: hub, dst: e, weight: 0.2, day },
      { src: e, dst: hub, weight: 0.2, day },
    ]));
    c.store.archive(regrown, EPISODE_REGROWN_REASON);
    c.store.archive(corrected, "corrected");
    // As if each pass had thrown before it latched.
    c.store.updateMeta(TERMINAL_ARCHIVE_LATCHES["episode-regrown"] as string, () => null);
    c.store.updateMeta(TERMINAL_ARCHIVE_LATCHES["corrected"] as string, () => null);
    clock.now += TERMINAL_ARCHIVE_GRACE_MS + 1;
    c.associate.absorb([{ a: hub, b: regrown, delta: 0.01 }]);
    c.associate.flush();
    expect(c.store.edgesFrom(regrown).length).toBeGreaterThan(0);
    expect(c.store.edgesFrom(corrected).length).toBeGreaterThan(0);
  });

  test("a merge through the one door (Group 2b): the merged memory copies the originals' links, the originals keep theirs (nothing to sweep), and the undo leaves them linked", () => {
    const clock = { now: Date.UTC(2026, 4, 30, 22) };
    const c = brainAt(clock);
    c.store.advanceClock("2026-05-20");
    const friend = memoryIn(c, "s0", "An older memory the near-copies are both linked to.");
    for (let d = 21; d <= 30; d += 1) c.store.advanceClock(`2026-05-${String(d)}`);
    const a = memoryIn(c, "s1", "The ferry to the island leaves at eight from the north pier.");
    const b = memoryIn(c, "s1", "The island ferry departs from the north pier at eight.");
    const day = c.store.livedDay();
    c.store.linkMany([a, b].flatMap((x) => [
      { src: x, dst: friend, weight: 0.2, day },
      { src: friend, dst: x, weight: 0.2, day },
    ]));
    const begun = c.dreams.begin({ session: "night" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const out = c.dreams.propose({ dream: begun.bundle.dream, session: "night", changes: [{ action: "merge", ids: [a, b], text: "The island ferry leaves the north pier at eight." }] });
    if (!out.ok) throw new Error("propose refused");
    const merged = out.results[0]?.id as string;
    expect(c.associate.linked(merged, friend)).toBe(true);
    // The originals stay live (settled `changed` under the merged memory), so a flush sweeps none of their rows.
    clock.now += TERMINAL_ARCHIVE_GRACE_MS + 1;
    c.associate.absorb([{ a: merged, b: friend, delta: 0.01 }]);
    c.associate.flush();
    for (const x of [a, b]) expect(c.associate.linked(x, friend)).toBe(true);
    expect(c.dreams.undo(begun.bundle.dream).ok).toBe(true);
    for (const x of [a, b]) expect(c.associate.linked(x, friend)).toBe(true);
  });

  test("a flush landing between the archive and the carry takes nothing: the carry still finds every row (both reasons)", async () => {
    for (const reason of [EPISODE_REGROWN_REASON, DREAM_MERGE_REASON]) {
      const clock = { now: Date.UTC(2026, 8, 1, 9) };
      const c = brainAt(clock);
      c.store.advanceClock("2026-09-01");
      const friend = memoryIn(c, "s0", `A memory linked to the one being replaced (${reason}).`);
      const old = memoryIn(c, "s0", `The copy that is replaced (${reason}).`);
      const successor = memoryIn(c, "s0", `What replaces it (${reason}).`);
      const day = c.store.livedDay();
      c.store.linkMany([
        { src: old, dst: friend, weight: 0.2, day },
        { src: friend, dst: old, weight: 0.2, day },
      ]);
      // The path's first step: archived (a merge folds it in; a regrown copy is archived).
      if (reason === DREAM_MERGE_REASON) c.store.supersedeInto(old, successor, reason);
      else c.store.archive(old, reason);
      // Another process's boundary flushes before the second step.
      c.associate.absorb([{ a: friend, b: successor, delta: 0.01 }]);
      expect(c.associate.flush().sweptArchived ?? 0).toBe(0);
      expect(c.store.edgesFrom(old).length).toBe(1);
      // The second step: the carry.
      c.associate.retargetOnSupersede(old, successor, day);
      expect(c.associate.weightAt(successor, friend, day)).toBeGreaterThanOrEqual(0.2 - 1e-9);
      // Past the grace, the next flush sweeps what is now an inert copy.
      clock.now += TERMINAL_ARCHIVE_GRACE_MS + 1;
      c.associate.absorb([{ a: friend, b: successor, delta: 0.01 }]);
      expect(c.associate.flush().sweptArchived).toBeGreaterThanOrEqual(2);
      expect(c.store.edgesFrom(old)).toEqual([]);
      expect(c.associate.linked(successor, friend)).toBe(true);
      c.close();
      brains.splice(0);
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-group4-"));
      process.env[ENV] = dir;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Honest evidence: links laid, and links that reached recall
// ═══════════════════════════════════════════════════════════════════════════
describe("7. honest evidence (review 06 C6)", () => {
  test("a candidate a hop lifted into the cut is marked and counted; one already in the cut is not", async () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainAt(clock);
    c.store.advanceClock("2026-09-01");
    // Ordinary background, so rarity can discriminate (recall §9 G4).
    for (const body of [
      "The garage door opener needs a new battery soon.",
      "The library closes early on Sundays now.",
      "The kitchen tap drips when the pressure is high.",
      "The bus route changed and adds ten minutes.",
      "Planted three tomato seedlings in the planter.",
      "The printer jams on heavy paper stock.",
    ]) memoryIn(c, "s0", body);
    const ids = [
      "The sourdough starter died after two weeks of neglect.",
      "The sourdough starter died when the kitchen got too cold.",
    ].map((body) => memoryIn(c, "s0", body));
    const turn = { text: "my sourdough starter died", day: c.store.livedDay(), selfFelt: false, maxCandidates: 1, storeSize: 8 };
    const t = withRecallTunables({ SPREAD_SEEDS: 0 });
    const plain = activate(c.store, turn, t);
    const kept = plain.candidates.map((x) => x.id);
    expect(kept.length).toBe(1);
    const outside = ids.find((id) => !kept.includes(id)) as string;
    const hopped = activate(c.store, { ...turn, spread: () => ({ contributions: [{ id: outside, activation: 1_000 }] }) }, t);
    // Lifted only if the capped hop out-ranks what the cut kept; then it is marked.
    const lifted = hopped.candidates.find((x) => x.id === outside);
    expect(lifted?.lifted).toBe(true);
    expect(hopped.spread?.lifted).toBe(1);
    // A candidate already in the cut that a hop raised is not "lifted".
    const raisedInside = activate(c.store, { ...turn, spread: () => ({ contributions: [{ id: kept[0]!, activation: 0.001 }] }) }, t);
    expect(raisedInside.candidates.some((x) => x.lifted === true)).toBe(false);
  });

  test("the decision row's linksReached is pointers shown plus lifted ones shown", () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainAt(clock);
    c.store.advanceClock("2026-09-01");
    memoryIn(c, "s0", "The ferry stops running an hour earlier once the clocks change.");
    c.recallForTurn({ sessionId: "s1", text: "when does the ferry stop" });
    const row = JSON.parse(c.store.eventLog({ name: "recall.decision" }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    const spread = (row["spread"] ?? {}) as Record<string, number>;
    expect(row["linksReached"]).toBe((spread["pointersShown"] ?? 0) + (spread["liftedShown"] ?? 0));
  });

  test("Association: links laid with none reaching recall is waiting on a young store, amber once it has history; one that reached is green", () => {
    const clock = { now: Date.UTC(2026, 8, 1, 9) };
    const c = brainAt(clock);
    const assoc = (today: number) => mechanismEvidence(c.store, { sinceDay: today - 6, today }).verdicts.find((v) => v.id === "association")!;
    for (let d = 1; d <= 9; d++) c.store.advanceClock(`2026-09-0${String(d)}`);
    let day = c.store.livedDay();
    expect(day).toBeLessThan(14);
    // Rows rewritten are not links laid: `rows` alone proves nothing now.
    c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 40, deposited: 0 } });
    const quiet = assoc(day);
    expect(quiet.fired).toBe(false);
    expect(quiet.starved).toBeUndefined();
    expect(quiet.young).toBeUndefined();
    // A new store: links laid, none reached recall yet — waiting, not amber, even with plenty laid.
    c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 8, deposited: 23 } });
    c.store.appendEvent({ name: "dream.begun", day, ref: "drm_x", payload: { replayLinks: 2 } });
    const young = assoc(day);
    expect(young.fired).toBe(false);
    expect(young.starved).toBeUndefined();
    expect(young.young).toBe("reached");
    const waiting = lightOf(young);
    expect(waiting.status).toBe("waiting");
    expect(waiting.evidence).toBe(
      `23 links laid, 2 faint links a dream's replay laid in the last ${String(MECHANISM_DAYS)} days of use. No memory a link brought to mind yet; that takes a few weeks of use.`,
    );
    const cli = MEMORY_MECHANISMS.find((m) => m.id === "association")!;
    expect(readMechanism(cli, [young], () => undefined)).toEqual({
      light: LIGHT.working,
      says: "25 links laid this week; too early for one to bring a memory to mind (0 links held)",
    });
    // Two weeks of lived days, but only a handful laid this week: still too little to expect one.
    for (let d = 10; d <= 20; d++) c.store.advanceClock(`2026-09-${String(d)}`);
    day = c.store.livedDay();
    expect(day).toBeGreaterThanOrEqual(14);
    c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 8, deposited: 5 } });
    expect(assoc(day).young).toBe("reached");
    expect(lightOf(assoc(day)).status).toBe("waiting");
    // Enough history and enough laid: amber, and it says so.
    c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 30, deposited: 15 } });
    const starved = assoc(day);
    expect(starved.fired).toBe(false);
    expect(starved.young).toBeUndefined();
    expect(starved.starved).toBe("reached");
    const amber = lightOf(starved);
    expect(amber.status).toBe("amber");
    expect(amber.evidence).toBe(`20 links laid in the last ${String(MECHANISM_DAYS)} days of use, but no memory a link brought to mind.`);
    expect(readMechanism(cli, [starved], () => undefined).light).toBe(LIGHT.idle);
    c.store.appendEvent({ name: "recall.decision", day, ref: "s1", payload: { surfacedCount: 0, footnoteCount: 1, linksReached: 1 } });
    const reached = assoc(day);
    expect(reached.fired).toBe(true);
    expect(lightOf(reached).status).toBe("green");
  });
});
