/**
 * THE SLOT DETECTOR (2026-10-11, Group 2; reviews 04 and 10 C2) — a new
 * memory that reads as the newer state of the same thing as an older one is
 * proposed as such, provisionally: an UNSETTLED pair with source `slot`, the
 * older faded by `SLOT_FADE` meanwhile. The writer can confirm it at once (a
 * settle), the dream confirms or undoes it (`slot {pair, same}`), and every
 * step is exact: confirmed lands at `CHANGED_FADE` in all, undone puts the
 * provisional cut back, withdrawn puts it all back.
 *
 * Since 2026-10-19 (an experiment; check ~10-22) a proposal makes no cut
 * (`SLOT_FADE` 1): it flags the older only, and the fade comes with a
 * confirmation. "flag only" below proves that; the describes before it run at
 * the old cut (`LEGACY_SLOT_FADE`), which the live store's earlier proposals
 * still carry and a revert restores.
 *
 * Most cases run on a small fake embedder (topic buckets) so they run
 * everywhere; the bench's own case runs on the real table where it is
 * installed. Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contradictionFindings } from "../src/adapters/claude-code/doctor.js";
import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { mindRanked } from "../src/core/dream/mind.js";
import { resolveStaticWeights } from "../src/core/embed/static.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { standingOf } from "../src/core/recall/index.js";
import {
  CONTRADICTION_PROPOSED_EVENT,
  CONTRADICTION_TUNABLES,
  SLOT_HINT,
  SLOT_SOURCE,
  detectSlot,
  proposeSlot,
  settle,
  undo,
  withdrawSlot,
} from "../src/core/reconsolidation.js";
import type { Embedder, Store } from "../src/core/store/index.js";
import { LEGACY_SLOT_FADE, setSlotFade, useSlotFade } from "./slot-fade-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const SESSION = "sess_slot";
const WEIGHTS = resolveStaticWeights({ env: {} });
const T = CONTRADICTION_TUNABLES;

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-slot-"));
  process.env[ENV] = dir;
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
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A FAKE EMBEDDER: one dimension per topic word; `nudge` words lean a text a
 * little off its topic, so two texts on one topic read at a chosen closeness.
 */
const TOPIC: Record<string, number> = { release: 0, published: 0, npm: 0, followers: 1, instagram: 1, lantern: 2, sketch: 2, fern: 3, water: 3, sonnet: 4, poem: 4 };
const NUDGE: Record<string, number> = { draft: 5, rules: 6, wave: 7 };
const fakeEmbed: Embedder = (text: string): number[] | null => {
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0.05];
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    const d = TOPIC[w];
    if (d !== undefined) v[d] = (v[d] ?? 0) + 1;
    const n = NUDGE[w];
    if (n !== undefined) v[n] = (v[n] ?? 0) + 0.95;
  }
  return v;
};

function server(opts: { embed?: Embedder } = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, embed: opts.embed ?? fakeEmbed });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

function aged(store: Store): number {
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
  return store.livedDay();
}

async function remember(s: McpServer, text: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return payload(await s.call("remember", { text, ...extra }));
}

function fade(store: Store, id: string): number {
  return Math.round((store.row(id)?.fade ?? 1) * 1e9) / 1e9;
}

describe("the detector at the write", () => {
  // The provisional cut, at the cut a revert restores (flag only since 2026-10-19; see below).
  useSlotFade(LEGACY_SLOT_FADE);

  test("the newer state of the same thing is proposed: an unsettled slot pair, the older faded provisionally and labelled, the writer told", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const older = String((await remember(s, "Release 0.3.15 published on npm this morning."))["id"]);
    const r = await remember(s, "Release 0.3.16 published on npm, the self page ladder rides it.");
    const newer = String(r["id"]);
    expect(r["slot"]).toMatchObject({ over: older, rule: "cosine" });
    expect(r["slotHint"]).toBe(SLOT_HINT);
    // Not listed twice: the slot's older is not among the neighbours.
    expect(((r["neighbours"] as { id: string }[] | undefined) ?? []).map((n) => n.id)).not.toContain(older);
    const pair = store.contradictionBetween(older, newer);
    expect(pair).toMatchObject({ state: "unsettled", source: SLOT_SOURCE, a: older, b: newer });
    expect(fade(store, older)).toBe(T.SLOT_FADE);
    expect(fade(store, newer)).toBe(1);
    expect(standingOf(store, older)?.prefix).toContain("may be out of date");
    expect(store.eventLog({ name: CONTRADICTION_PROPOSED_EVENT })).toHaveLength(1);
    // Doctor counts it on its own, not as a disagreement.
    const f = contradictionFindings(store)[0];
    expect(f?.data?.["standingUnsettled"]).toBe(0);
    expect(f?.data?.["standingProposed"]).toBe(1);
  });

  test("nothing is proposed for a different thing, a dated memory, a reading or world memory, another kind, or past the window", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    await remember(s, "Lantern sketch round one is ready for review.");
    const far = await remember(s, "Release 0.3.15 published on npm this morning.");
    expect(far["slot"]).toBeUndefined();
    // A reminder is its own thing: the first of three is not an earlier second.
    await remember(s, "Reminder one of three: water the fern.", { eventDate: "2099-10-14" });
    expect((await remember(s, "Reminder two of three: water the fern unless done."))["slot"]).toBeUndefined();
    // A reading, and a world memory.
    await remember(s, "Reading: a sonnet, poem fourteen.");
    expect((await remember(s, "Reading: a sonnet, poem eighteen."))["slot"]).toBeUndefined();
    await remember(s, "The poem anthology sonnet sequence is in the public domain.", { about: "world" });
    expect((await remember(s, "The sonnet poem anthology has a second edition.", { about: "world" }))["slot"]).toBeUndefined();
    // Another kind.
    await remember(s, "Instagram followers reached 1250 this week.", { kind: "fact" });
    expect((await remember(s, "Instagram followers near 1300.", { kind: "skill" }))["slot"]).toBeUndefined();
    // Past the window: eight lived days later the old one is not a candidate.
    for (let d = 5; d <= 13; d += 1) store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const late = await remember(s, "Instagram followers now near 1400 this week.", { kind: "fact" });
    expect(late["slot"]).toBeUndefined();
  });

  test("status lineage: planned, now done, is a slot at the lower bar; proposed is not lineage", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    // The nudge words keep these two under SLOT_COSINE and over SLOT_LINEAGE_COSINE.
    const plan = String((await remember(s, "Lantern sketch wave planned for tonight.", { status: "planned" }))["id"]);
    const cos = (a: string, b: string): number => {
      const x = fakeEmbed(a) as number[];
      const y = fakeEmbed(b) as number[];
      const dot = x.reduce((n, v, i) => n + v * (y[i] ?? 0), 0);
      return dot / (Math.hypot(...x) * Math.hypot(...y));
    };
    const c = cos("Lantern sketch wave planned for tonight.", "Lantern sketch rules done.");
    expect(c).toBeGreaterThanOrEqual(T.SLOT_LINEAGE_COSINE);
    expect(c).toBeLessThan(T.SLOT_COSINE);
    const done = await remember(s, "Lantern sketch rules done.", { status: "done" });
    expect(done["slot"]).toMatchObject({ over: plan, rule: "lineage" });
  });

  test("the same closeness from a `proposed` one is not lineage, and stays under the bar", async () => {
    const s = server();
    aged(s.counterpart.store);
    await remember(s, "Lantern sketch wave proposed for tonight.", { status: "proposed" });
    expect((await remember(s, "Lantern sketch rules done.", { status: "done" }))["slot"]).toBeUndefined();
  });

  test("a memory already waiting as the older of a proposal is not proposed under a second one", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const a = String((await remember(s, "Instagram followers reached 1250."))["id"]);
    const b = await remember(s, "Instagram followers now close to 1300.");
    expect(b["slot"]).toMatchObject({ over: a });
    const c = await remember(s, "Instagram followers now close to 1350.");
    expect(c["slot"]).toMatchObject({ over: String(b["id"]) });
    expect(fade(store, a)).toBe(T.SLOT_FADE);
  });

  test("a memory already settled over is not proposed again; the head is", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const a = String((await remember(s, "Release 0.3.14 published on npm."))["id"]);
    const b = String((await remember(s, "Release 0.3.15 published on npm.", { updates: a, how: "changed" }))["id"]);
    const c = await remember(s, "Release 0.3.16 published on npm.");
    expect(c["slot"]).toMatchObject({ over: b });
    expect(store.contradictionBetween(a, String(c["id"]))).toBeUndefined();
  });
});

describe("the arithmetic of a proposal, exact through every step", () => {
  // The provisional cut, at the cut a revert restores (flag only since 2026-10-19; see below).
  useSlotFade(LEGACY_SLOT_FADE);

  async function proposed(): Promise<{ s: McpServer; store: Store; older: string; newer: string; pair: string }> {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const older = String((await remember(s, "Instagram followers reached 1250."))["id"]);
    const r = await remember(s, "Instagram followers now close to 1300.");
    const newer = String(r["id"]);
    const pair = String((r["slot"] as { pair: string }).pair);
    expect(fade(store, older)).toBe(T.SLOT_FADE);
    return { s, store, older, newer, pair };
  }

  test("confirm → undo → confirm again: CHANGED_FADE each time, the provisional cut between", async () => {
    const { s, store, older, newer, pair } = await proposed();
    const conf = await s.call("remember", { settle: { holds: newer, over: older, how: "changed", why: "the newer count" } });
    expect((payload(conf)["settle"] as Record<string, unknown>)["ok"]).toBe(true);
    expect(store.contradiction(pair)?.state).toBe("settled");
    expect(fade(store, older)).toBe(PHYSICS.CHANGED_FADE);
    const u = undo(store, { pair, actor: "owner" });
    expect(u).toMatchObject({ ok: true, state: "unsettled" });
    expect(fade(store, older)).toBe(T.SLOT_FADE);
    expect(settle(store, { pair, holds: newer, how: "changed", actor: "dream", why: "again" }).ok).toBe(true);
    expect(fade(store, older)).toBe(PHYSICS.CHANGED_FADE);
  });

  test("open lifts the provisional cut (both stand); its undo puts it back", async () => {
    const { store, older, newer, pair } = await proposed();
    expect(settle(store, { holds: newer, over: older, how: "open", actor: "session", why: "both true" }).ok).toBe(true);
    expect(fade(store, older)).toBe(1);
    expect(undo(store, { pair, actor: "owner" }).ok).toBe(true);
    expect(fade(store, older)).toBe(T.SLOT_FADE);
    expect(store.contradiction(pair)?.state).toBe("unsettled");
  });

  test("the other way round: the older holds, the newer is over — the cut moves, and the undo moves it back", async () => {
    const { store, older, newer, pair } = await proposed();
    expect(settle(store, { pair, holds: older, how: "changed", actor: "owner", why: "the older count was the real one" }).ok).toBe(true);
    expect(fade(store, older)).toBe(1);
    expect(fade(store, newer)).toBe(PHYSICS.CHANGED_FADE);
    expect(undo(store, { pair, actor: "owner" }).ok).toBe(true);
    expect(fade(store, older)).toBe(T.SLOT_FADE);
    expect(fade(store, newer)).toBe(1);
  });

  test("withdrawn: the cut put back, the pair withdrawn, and the two are never proposed again", async () => {
    const { s, store, older, newer, pair } = await proposed();
    const w = withdrawSlot(store, { pair, actor: "owner", why: "two different accounts" });
    expect(w.ok).toBe(true);
    expect(fade(store, older)).toBe(1);
    expect(store.contradiction(pair)?.state).toBe("withdrawn");
    expect(detectSlot(store, { id: newer, session: SESSION })).toBeNull();
    // The owner's undo of a waiting proposal is the same withdrawal.
    const again = await remember(s, "Instagram followers now nearly 1350.");
    const p2 = String((again["slot"] as { pair: string }).pair);
    expect(undo(store, { pair: p2, actor: "owner" })).toMatchObject({ ok: true, state: "withdrawn" });
  });

  test("a newer memory that settles the older through `updates` closes the proposal and lifts its cut", async () => {
    const { s, store, older, pair } = await proposed();
    const c = await remember(s, "Instagram followers: 1310 exactly.", { updates: older, how: "changed" });
    expect((c["settled"] as Record<string, unknown>)["ok"]).toBe(true);
    expect(store.contradiction(pair)?.via).not.toBeNull();
    expect(fade(store, older)).toBe(PHYSICS.CHANGED_FADE);
  });
});

describe("the dream confirms or undoes, on a budget", () => {
  // The provisional cut, at the cut a revert restores (flag only since 2026-10-19; see below).
  useSlotFade(LEGACY_SLOT_FADE);

  function lived(c: Counterpart): { day: number } {
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 14; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    return { day: c.store.livedDay() };
  }
  function mk(c: Counterpart, body: string): string {
    const day = c.store.livedDay();
    return c.store.put({ type: "memory", kind: "fact", body, source: "authored", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
  }

  test("to-confirm items sit beside the ranked ones, at most SLOT_PER_NIGHT, never as a disagreement, never raised awake", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, embed: fakeEmbed });
    open.push(c);
    lived(c);
    const pairs: string[] = [];
    for (let i = 0; i < T.SLOT_PER_NIGHT + 2; i += 1) {
      const a = mk(c, `Release note ${String(i)}: npm release published.`);
      const b = mk(c, `Release note ${String(i)}: npm release published again, later.`);
      const out = proposeSlot(c.store, { holds: b, candidate: { over: a, cosine: 0.9, rule: "cosine", sameSession: false } });
      if (!out.ok) throw new Error(out.detail);
      pairs.push(out.pair);
    }
    const read = mindRanked(c.store, { today: "2026-09-14", day: c.store.livedDay(), showable: () => true, owner: true, slots: true });
    const confirm = read.items.filter((i) => i.kind === "to-confirm");
    expect(confirm).toHaveLength(T.SLOT_PER_NIGHT);
    expect(confirm[0]?.pair).toBe(pairs[0]);
    expect(read.slotsMore).toBe(2);
    expect(read.items.some((i) => i.kind === "unsettled")).toBe(false);
    // The reflection's read has none of them.
    expect(mindRanked(c.store, { today: "2026-09-14", day: c.store.livedDay(), showable: () => true, owner: true }).items).toHaveLength(0);
    expect(c.dreams.raiseLines({ session: "s-next" })).toEqual([]);
  });

  test("slot {same: true} confirms, slot {same: false} withdraws; undoing the dream puts both back as proposals", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, embed: fakeEmbed });
    open.push(c);
    lived(c);
    const a1 = mk(c, "Follower count 1250 on instagram.");
    const b1 = mk(c, "Follower count close to 1300 on instagram.");
    const a2 = mk(c, "Lantern sketch round one.");
    const b2 = mk(c, "Lantern sketch round two.");
    const p1 = proposeSlot(c.store, { holds: b1, candidate: { over: a1, cosine: 0.9, rule: "cosine", sameSession: false } });
    const p2 = proposeSlot(c.store, { holds: b2, candidate: { over: a2, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p1.ok || !p2.ok) throw new Error("not proposed");
    const begun = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.dream;
    expect(begun.bundle.onMind.filter((i) => i.kind === "to-confirm").map((i) => i.pair)).toEqual([p1.pair, p2.pair]);
    const r = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "slot", pair: p1.pair, same: true, why: "the newer count" },
        { action: "slot", pair: p2.pair, same: false, why: "two rounds, both kept" },
        { action: "slot", pair: p2.pair },
      ],
    });
    if (!r.ok) throw new Error("propose refused");
    expect(r.results.map((x) => x.reason)).toEqual(["confirmed", "two-things", "not-a-proposal"]);
    expect(c.store.contradiction(p1.pair)?.state).toBe("settled");
    expect(fade(c.store, a1)).toBe(PHYSICS.CHANGED_FADE);
    expect(c.store.contradiction(p2.pair)?.state).toBe("withdrawn");
    expect(fade(c.store, a2)).toBe(1);
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    c.dreams.undo(id);
    expect(c.store.contradiction(p1.pair)?.state).toBe("unsettled");
    expect(fade(c.store, a1)).toBe(T.SLOT_FADE);
    expect(c.store.contradiction(p2.pair)?.state).toBe("unsettled");
    expect(fade(c.store, a2)).toBe(T.SLOT_FADE);
  });
});

describe("flag only (SLOT_FADE 1, an experiment since 2026-10-19): no cut until the dream confirms", () => {
  useSlotFade(1);

  function lived(c: Counterpart): void {
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 14; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  }
  function mk(c: Counterpart, body: string): string {
    const day = c.store.livedDay();
    return c.store.put({ type: "memory", kind: "fact", body, source: "authored", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
  }
  function brain(): Counterpart {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, embed: fakeEmbed });
    open.push(c);
    lived(c);
    return c;
  }

  test("at the write: the pair is proposed and the older labelled, but neither fades; the writer is not told it faded", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const older = String((await remember(s, "Release 0.3.15 published on npm this morning."))["id"]);
    const r = await remember(s, "Release 0.3.16 published on npm, the self page ladder rides it.");
    const newer = String(r["id"]);
    expect(r["slot"]).toMatchObject({ over: older });
    expect(String(r["slotHint"])).not.toContain("faded");
    expect(store.contradictionBetween(older, newer)).toMatchObject({ state: "unsettled", source: SLOT_SOURCE });
    expect(fade(store, older)).toBe(1);
    expect(fade(store, newer)).toBe(1);
    expect(standingOf(store, older)?.prefix).toContain("may be out of date");
    const ev = store.eventLog({ name: CONTRADICTION_PROPOSED_EVENT });
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]?.payload ?? "{}")).toMatchObject({ faded: false, bandDrop: false });
  });

  test("proposeSlot reports no cut; the dream's same: true is the only fade, same: false has nothing to put back, and the dream's undo leaves both unfaded", () => {
    const c = brain();
    const a1 = mk(c, "Follower count 1250 on instagram.");
    const b1 = mk(c, "Follower count close to 1300 on instagram.");
    const a2 = mk(c, "Lantern sketch round one.");
    const b2 = mk(c, "Lantern sketch round two.");
    const p1 = proposeSlot(c.store, { holds: b1, candidate: { over: a1, cosine: 0.9, rule: "cosine", sameSession: false } });
    const p2 = proposeSlot(c.store, { holds: b2, candidate: { over: a2, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p1.ok || !p2.ok) throw new Error("not proposed");
    expect(p1.faded).toBeNull();
    expect(fade(c.store, a1)).toBe(1);
    const begun = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.dream;
    expect(begun.bundle.onMind.filter((i) => i.kind === "to-confirm").map((i) => i.pair)).toEqual([p1.pair, p2.pair]);
    const r = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "slot", pair: p1.pair, same: true, why: "the newer count" },
        { action: "slot", pair: p2.pair, same: false, why: "two rounds, both kept" },
      ],
    });
    if (!r.ok) throw new Error("propose refused");
    expect(r.results.map((x) => x.reason)).toEqual(["confirmed", "two-things"]);
    expect(fade(c.store, a1)).toBe(PHYSICS.CHANGED_FADE);
    expect(c.store.contradiction(p2.pair)?.state).toBe("withdrawn");
    expect(fade(c.store, a2)).toBe(1);
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    c.dreams.undo(id);
    expect(c.store.contradiction(p1.pair)?.state).toBe("unsettled");
    expect(c.store.contradiction(p2.pair)?.state).toBe("unsettled");
    expect(fade(c.store, a1)).toBe(1);
    expect(fade(c.store, a2)).toBe(1);
  });

  test("the writer's own settle confirms it at the full fade; a withdrawal restores nothing", () => {
    const c = brain();
    const a = mk(c, "Follower count 1250 on instagram.");
    const b = mk(c, "Follower count close to 1300 on instagram.");
    const p = proposeSlot(c.store, { holds: b, candidate: { over: a, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!p.ok) throw new Error(p.detail);
    expect(settle(c.store, { pair: p.pair, holds: b, how: "changed", actor: "session", why: "the newer count" }).ok).toBe(true);
    expect(fade(c.store, a)).toBe(PHYSICS.CHANGED_FADE);
    const x = mk(c, "Lantern sketch round one.");
    const y = mk(c, "Lantern sketch round two.");
    const q = proposeSlot(c.store, { holds: y, candidate: { over: x, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!q.ok) throw new Error(q.detail);
    const w = withdrawSlot(c.store, { pair: q.pair, actor: "owner", why: "two rounds" });
    expect(w).toMatchObject({ ok: true, restored: null });
    expect(fade(c.store, x)).toBe(1);
  });

  test("a proposal made before, with its cut on the trail: withdrawn, the cut is put back; confirmed, it lands at the full fade, not cut twice", () => {
    const c = brain();
    const a = mk(c, "Follower count 1250 on instagram.");
    const b = mk(c, "Follower count close to 1300 on instagram.");
    const x = mk(c, "Lantern sketch round one.");
    const y = mk(c, "Lantern sketch round two.");
    const prior = setSlotFade(LEGACY_SLOT_FADE);
    let p: ReturnType<typeof proposeSlot>;
    let q: ReturnType<typeof proposeSlot>;
    try {
      p = proposeSlot(c.store, { holds: b, candidate: { over: a, cosine: 0.9, rule: "cosine", sameSession: false } });
      q = proposeSlot(c.store, { holds: y, candidate: { over: x, cosine: 0.9, rule: "cosine", sameSession: false } });
    } finally {
      setSlotFade(prior);
    }
    if (!p.ok || !q.ok) throw new Error("not proposed");
    expect(fade(c.store, a)).toBeLessThan(1);
    expect(fade(c.store, x)).toBeLessThan(1);
    // Now flag only: the old cuts are still lifted or put back exactly.
    expect(settle(c.store, { pair: p.pair, holds: b, how: "changed", actor: "dream", why: "the newer count" }).ok).toBe(true);
    expect(fade(c.store, a)).toBe(PHYSICS.CHANGED_FADE);
    expect(withdrawSlot(c.store, { pair: q.pair, actor: "dream", why: "two rounds" })).toMatchObject({ ok: true, restored: x });
    expect(fade(c.store, x)).toBe(1);
  });
});

describe.skipIf(WEIGHTS === null)("the real table (potion-base-8M)", () => {
  // The bench's a2f3aa27 (LongMemEval, public): two counts the same day, in
  // two conversations. Every reader treated them as a tie; the second must
  // come out as the newer state of the first.
  test("the bench case: \"1250 followers\" then \"close to 1300\" — the second is the newer state of the first; the Insights one is not", async () => {
    const table = openStaticEmbedder({ env: {} });
    const s = server({ embed: table.embed });
    const store = s.counterpart.store;
    aged(store);
    const first = String(
      (await remember(s, "On 2023-05-25, the user said they have 1250 followers on Instagram now. I congratulated them on the milestone.", { title: "User's Instagram follower count" }))["id"],
    );
    const insights = await remember(
      s,
      "On 2023-05-25, the user asked whether Instagram Insights can show which posts perform well and which do not, and wanted tips for optimizing content for their 1250 followers.",
      { title: "User's interest in Instagram Insights" },
    );
    expect(insights["slot"]).toBeUndefined();
    const second = await remember(
      s,
      "On 2023-05-25 the user said they think they are close to 1300 Instagram followers now and had been meaning to check the exact count. The user's audience is mostly from the US, UK, and Australia.",
      { title: "User's Instagram follower count near 1300" },
    );
    expect(second["slot"]).toMatchObject({ over: first });
  });
});
