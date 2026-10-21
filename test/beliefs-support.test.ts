/**
 * BELIEFS, BORN WEAK AND EARNED BY LIFE (wave 2 lane C, 2026-10-21; physics
 * §5.13, schemas `fileSupport`).
 *
 * A belief starts at the birth ceiling whoever writes it, and rises only by
 * SUPPORT: lived memories counted once each per belief, weighed by route
 * (testimony and choice read off the memory, use, found, link), by spread (a
 * day, session or folder already on the belief counts less) and by feeling.
 * Its support is its repetition arm and its anchor, on the curve every memory
 * rides. A contrary filing presses it through the pressure arithmetic. And
 * until lanes E and F, no belief is seen: not in a turn's recall, not in
 * facts mode, not across into the core.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES as PHYSICS, height, sal, strength, supportCredit, supportedPhysics } from "../src/core/physics/index.js";
import type { SupportFiling } from "../src/core/physics/index.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { Schemas } from "../src/core/schemas/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { phaseReport } from "../src/core/sleep/index.js";
import { factsRecall } from "../src/adapters/mcp/facts.js";

const NOW = Date.parse("2026-03-02T12:00:00Z");
const SESSION = "bbbbbbbb-1111-2222-3333-444444444444";

let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-beliefs-"));
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function filing(o: Partial<SupportFiling> & { memoryId: string }): SupportFiling {
  return { stance: "support", route: "testimony", day: 1, bornDay: 1, session: null, scope: "/work", feeling: 0, ...o };
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe("the support arithmetic (physics §5.13), pure", () => {
  test("each route at its starting weight; a word that is not a route counts nothing", () => {
    const routes = ["testimony", "choice", "use", "found", "link", "rating"];
    const c = supportCredit(routes.map((route, i) => filing({ memoryId: `m${i}`, route, bornDay: i, session: `s${i}`, scope: `/f${i}` })));
    expect(c.weights).toEqual([1, 1, 0.5, 0.7, 0.25, 0]);
    expect(close(c.uses, 3.45)).toBe(true);
  });

  test("spread: the smallest repetition factor that applies — same session, else same day, else same folder; no folder is one shared unknown", () => {
    const c = supportCredit([
      filing({ memoryId: "a", bornDay: 1, session: "s1", scope: "/a" }),
      filing({ memoryId: "b", bornDay: 1, session: "s1", scope: "/b" }), // same session (and day)
      filing({ memoryId: "c", bornDay: 1, session: "s2", scope: "/c" }), // same day
      filing({ memoryId: "d", bornDay: 2, session: "s3", scope: "/a" }), // same folder
      filing({ memoryId: "e", bornDay: 3, session: "s4", scope: null }), // the unknown folder, first
      filing({ memoryId: "f", bornDay: 4, session: "s5", scope: null }), // unknown again: not new
      filing({ memoryId: "g", bornDay: 5, session: "s6", scope: "/g" }), // all new
    ]);
    expect(c.weights).toEqual([1, PHYSICS.SUPPORT_SAME_SESSION, PHYSICS.SUPPORT_SAME_DAY, PHYSICS.SUPPORT_SAME_FOLDER, 1, PHYSICS.SUPPORT_SAME_FOLDER, 1]);
  });

  test("support and contrary spread on their own; contrary never counts toward the belief", () => {
    const c = supportCredit([
      filing({ memoryId: "a", bornDay: 1, session: "s1" }),
      filing({ memoryId: "b", bornDay: 1, session: "s1", stance: "contrary" }),
    ]);
    expect(c.weights).toEqual([1, 1]);
    expect(c.uses).toBe(1);
  });

  test("feeling adds weight, never required: x (1 + 0.5 x the strongest feeling)", () => {
    const c = supportCredit([filing({ memoryId: "a", feeling: 0.6 })]);
    expect(close(c.weights[0] as number, 1 + PHYSICS.SUPPORT_FEELING * 0.6)).toBe(true);
  });

  test("links: 0.25 each, at most 0.5 together, so a cluster can't hold itself up", () => {
    const c = supportCredit(["x", "y", "z"].map((m) => filing({ memoryId: m, route: "link" })));
    expect(c.weights).toEqual([0.25, 0.25, 0]);
    expect(c.uses).toBe(0.5);
  });

  test("a found filing counts a little less UNTIL life echoes it: a lived filing born on a LATER day lifts it to full", () => {
    // Day 2's found memory; a testimony from day 1 is no echo, one from day 3 is.
    const found = filing({ memoryId: "f", route: "found", bornDay: 2, session: "s2", scope: "/f" });
    const before = filing({ memoryId: "t1", route: "testimony", bornDay: 1, session: "s1", scope: "/t1" });
    const after = filing({ memoryId: "t3", route: "testimony", bornDay: 3, session: "s3", scope: "/t3", day: 3 });
    expect(supportCredit([found]).weights).toEqual([PHYSICS.SUPPORT_FOUND]);
    expect(supportCredit([before, found]).weights).toEqual([1, PHYSICS.SUPPORT_FOUND]);
    expect(supportCredit([before, found, after]).weights).toEqual([1, PHYSICS.SUPPORT_FOUND_ECHOED, 1]);
    // A found filing echoes no other found one.
    expect(supportCredit([found, { ...after, route: "found", memoryId: "f3" }]).weights).toEqual([PHYSICS.SUPPORT_FOUND, PHYSICS.SUPPORT_FOUND]);
  });

  test("the belief's physics move by the difference since the last count: a use from elsewhere is kept; the anchor never moves back", () => {
    const credit = supportCredit([filing({ memoryId: "a", day: 4 }), filing({ memoryId: "b", day: 6, bornDay: 6, session: "s", scope: "/b" })]);
    expect(credit.lastDay).toBe(6);
    expect(credit.days).toBe(2);
    const next = supportedPhysics({ uses: 1.25, lastUsedDay: 5, reinforcedDays: 1 }, credit, { uses: 1, days: 1 });
    expect(next).toEqual({ uses: 1.25 + 2 - 1, lastUsedDay: 6, reinforcedDays: 2 });
    const unfiled = supportedPhysics({ uses: 2.25, lastUsedDay: 6, reinforcedDays: 2 }, supportCredit([filing({ memoryId: "a", day: 4 })]), { uses: 2, days: 2 });
    expect(unfiled).toEqual({ uses: 1.25, lastUsedDay: 6, reinforcedDays: 1 });
  });
});

// ---------------------------------------------------------------------------

function store(): Store {
  const s = Store.open({ dir: join(dir, "store"), now: () => NOW });
  opened.push(s);
  return s;
}

function lived(s: Store, body: string, day: number, opts: Partial<PutInput> & { session?: string; scope?: string } = {}): string {
  const { session, scope, ...rest } = opts;
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    physics: { birthDay: day, lastUsedDay: day },
    origin: { session: session ?? `sess-${day}`, scope: scope ?? `/work/${day}` },
    ...rest,
  });
}

/** A store with a person card and the self subject, then `schemas/` opened over them. */
function world(): { s: Store; schemas: Schemas; wren: string; me: string } {
  const s = store();
  const wren = s.put({ type: "schema", kind: "person", title: "Wren", body: "Wren", meta: { role: "entity", name: "Wren", aliases: [] } });
  const schemas = Schemas.open({ store: s });
  // Made after the open, through schemas/ (lane A's door), as the reflection will.
  const me = schemas.ensureSelfSubject();
  return { s, schemas, wren, me };
}

describe("born weak", () => {
  test("every belief starts at the ceiling or under it, whatever it claims, with no feeling, a birth route and its about mark", () => {
    const { s, schemas, me } = world();
    const out = schemas.addBelief({
      entityId: me,
      statement: "I explain best when I start from the reader's question.",
      day: 1,
      dimensions: { relevance: 0.95, emotional: 0.9, predictive: 0.95 },
      claimedSalience: 0.9,
      birthRoute: "reflection",
      about: "me",
    });
    expect(out.ok).toBe(true);
    const row = s.row(out.id as string);
    expect(row?.birth_route).toBe("reflection");
    expect(row?.about).toBe("me");
    const p = s.physicsOf(out.id as string);
    expect(p.belief).toBe(true);
    expect(sal(p.salience)).toBeLessThanOrEqual(PHYSICS.BELIEF_BIRTH_CEILING + 1e-9);
    expect(height(p)).toBeLessThanOrEqual(PHYSICS.BELIEF_BIRTH_CEILING + 1e-9);
    // A lower claim stays lower.
    const low = schemas.addBelief({ entityId: me, statement: "I like short replies.", day: 1, claimedSalience: 0.1, birthRoute: "session" });
    expect(sal(s.physicsOf(low.id as string).salience)).toBeCloseTo(0.1, 9);
  });
});

describe("filing support (schemas#fileSupport)", () => {
  test("each memory counts ONCE per belief: filing it again is refused and changes nothing", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const m = lived(s, "Wren said she loves the six o'clock ferry.", 2, { saidBy: "owner" });
    const first = schemas.fileSupport({ beliefId: b, memoryId: m, stance: "support", day: 2 });
    expect(first.ok).toBe(true);
    expect(first.route).toBe("testimony");
    const uses = s.row(b)?.uses;
    const again = schemas.fileSupport({ beliefId: b, memoryId: m, stance: "support", route: "use", day: 3 });
    expect(again.reason).toBe("already-counted");
    expect(s.row(b)?.uses).toBe(uses as number);
    expect(s.supportOf(b)).toHaveLength(1);
  });

  test("testimony and choice are read off the memory, never claimed; a claimed one with no said_by is filed found, with a note", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const mine = lived(s, "I chose the early ferry so Wren could sleep on board.", 2, { saidBy: "self" });
    const plain = lived(s, "The ferry left at six.", 3);
    expect(schemas.fileSupport({ beliefId: b, memoryId: mine, stance: "support", route: "found", day: 2 }).route).toBe("choice");
    const claimed = schemas.fileSupport({ beliefId: b, memoryId: plain, stance: "support", route: "testimony", day: 3 });
    expect(claimed.route).toBe("found");
    expect(claimed.note).toContain("said_by");
  });

  test("what is never support: the belief itself, a rating or any word not a route, a dream's words, a reflection's entry, a card", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const m = lived(s, "Wren took the early ferry again.", 2);
    expect(schemas.fileSupport({ beliefId: b, memoryId: b, stance: "support", day: 2 }).reason).toBe("memory-is-the-belief");
    expect(schemas.fileSupport({ beliefId: b, memoryId: m, stance: "support", route: "rating", day: 2 }).reason).toBe("route-unknown");
    expect(schemas.fileSupport({ beliefId: b, memoryId: m, stance: "support", route: "shown", day: 2 }).reason).toBe("route-unknown");
    const dreamed = lived(s, "Dreamed: Wren and the ferries.", 2, { source: "dreamed" });
    const entry = lived(s, "Reflected: the ferries.", 2, { source: "reflection" });
    expect(schemas.fileSupport({ beliefId: b, memoryId: dreamed, stance: "support", day: 2 }).reason).toBe("not-lived");
    expect(schemas.fileSupport({ beliefId: b, memoryId: entry, stance: "support", day: 2 }).reason).toBe("not-lived");
    expect(schemas.fileSupport({ beliefId: b, memoryId: wren, stance: "support", day: 2 }).reason).toBe("not-lived");
    expect(s.supportOf(b)).toEqual([]);
    expect(s.row(b)?.uses).toBe(0);
  });

  test("use backs beliefs about work and people, not beliefs about me or us", () => {
    const { s, schemas, wren, me } = world();
    const aboutMe = schemas.addBelief({ entityId: me, statement: "I write tests first.", day: 1, birthRoute: "reflection", about: "me" }).id as string;
    const aboutWren = schemas.addBelief({ entityId: wren, statement: "Wren reviews carefully.", day: 1, birthRoute: "reflection" }).id as string;
    const m = lived(s, "Asked Wren to review the parser; she caught two bugs.", 2);
    expect(schemas.fileSupport({ beliefId: aboutMe, memoryId: m, stance: "support", route: "use", day: 2 }).reason).toBe("use-not-about-me");
    const ok = schemas.fileSupport({ beliefId: aboutWren, memoryId: m, stance: "support", route: "use", day: 2 });
    expect(ok.ok).toBe(true);
    expect(ok.weight).toBe(PHYSICS.SUPPORT_USE);
  });

  test("a link is another live belief strong enough to lend; a newborn's is not", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const other = schemas.addBelief({ entityId: wren, statement: "Wren is a morning person.", day: 1, birthRoute: "reflection" }).id as string;
    expect(schemas.fileSupport({ beliefId: b, memoryId: other, stance: "support", route: "link", day: 2 }).reason).toBe("link-too-weak");
    const plain = lived(s, "Wren up at five again.", 2);
    expect(schemas.fileSupport({ beliefId: b, memoryId: plain, stance: "support", route: "link", day: 2 }).reason).toBe("link-not-a-belief");
    for (const day of [2, 3, 4, 5, 6, 7]) {
      const m = lived(s, `Wren up before dawn on day ${day}.`, day, { saidBy: "owner" });
      schemas.fileSupport({ beliefId: other, memoryId: m, stance: "support", day });
    }
    expect(strength(s.physicsOf(other), 7)).toBeGreaterThanOrEqual(PHYSICS.SUPPORT_LINK_FLOOR);
    const linked = schemas.fileSupport({ beliefId: b, memoryId: other, stance: "support", route: "link", day: 7 });
    expect(linked.ok).toBe(true);
    expect(linked.weight).toBe(PHYSICS.SUPPORT_LINK);
  });

  test("support lifts the belief on the curve every memory rides — a person's too — and unfiling takes exactly that back", () => {
    const { s, schemas, wren } = world();
    const held = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const bare = schemas.addBelief({ entityId: wren, statement: "Wren dislikes buses.", day: 1, birthRoute: "reflection" }).id as string;
    expect(s.row(held)?.kind).toBe("person");
    const ids: string[] = [];
    for (const day of [2, 3, 4, 5, 6]) {
      ids.push(lived(s, `Wren on the early ferry, day ${day}.`, day, { saidBy: "owner" }));
      schemas.fileSupport({ beliefId: held, memoryId: ids[ids.length - 1] as string, stance: "support", day });
    }
    const p = s.physicsOf(held);
    expect(p.uses).toBeCloseTo(5, 9);
    expect(p.lastUsedDay).toBe(6);
    expect(p.reinforcedDays).toBe(5);
    // Height past the birth ceiling (a person's omega_rep is 0; a belief's support is its repetition arm anyway).
    expect(height(p)).toBeGreaterThan(PHYSICS.BELIEF_BIRTH_CEILING);
    expect(strength(p, 10)).toBeGreaterThan(strength(s.physicsOf(bare), 10) * 2);
    // Unfile the last: its weight comes off exactly; the anchor stays.
    expect(s.unfileSupport(held, ids[4] as string)).toBe(true);
    expect(s.row(held)?.uses).toBeCloseTo(4, 9);
    expect(s.row(held)?.reinforced_days).toBe(4);
    expect(s.row(held)?.last_used_day).toBe(6);
  });

  test("support the reflection found counts 0.7, and rises to full once a lived memory from a later day is filed beside it", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 3, birthRoute: "reflection" }).id as string;
    const old = lived(s, "Months ago Wren chose the dawn crossing.", 1);
    const earlier = lived(s, "Wren: 'mornings on the water are the best part'.", 0, { saidBy: "owner" });
    expect(schemas.fileSupport({ beliefId: b, memoryId: old, stance: "support", day: 3 }).weight).toBe(PHYSICS.SUPPORT_FOUND);
    schemas.fileSupport({ beliefId: b, memoryId: earlier, stance: "support", day: 3 });
    expect(s.supportOf(b).find((r) => r.memoryId === old)?.weight).toBe(PHYSICS.SUPPORT_FOUND);
    const later = lived(s, "Wren booked the dawn ferry again.", 4, { saidBy: "owner" });
    schemas.fileSupport({ beliefId: b, memoryId: later, stance: "support", day: 4 });
    expect(s.supportOf(b).find((r) => r.memoryId === old)?.weight).toBe(PHYSICS.SUPPORT_FOUND_ECHOED);
    expect(s.row(b)?.uses).toBeCloseTo(3, 9);
  });

  test("contrary support presses the belief through the pressure arithmetic at its weight, once a lived day; past the bar it is revised, its history kept", () => {
    const { s, schemas, wren } = world();
    const b = schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day: 1, birthRoute: "reflection" }).id as string;
    const no1 = lived(s, "Wren: honestly the six o'clock ferry wrecks me.", 2, { saidBy: "owner", salience: { claimed: 0.4 } });
    const no2 = lived(s, "Wren asked to switch to the noon crossing.", 2, { salience: { claimed: 0.4 } });
    const r1 = schemas.fileSupport({ beliefId: b, memoryId: no1, stance: "contrary", day: 2 });
    expect(r1.ok).toBe(true);
    expect(r1.revision?.credited).toBe(true);
    // The force is the challenger's own (strength x sal) at the filing's weight.
    expect(r1.revision?.force).toBeCloseTo(strength(s.physicsOf(no1), 2) * sal(s.physicsOf(no1).salience) * r1.weight, 9);
    const r2 = schemas.fileSupport({ beliefId: b, memoryId: no2, stance: "contrary", day: 2 });
    expect(r2.ok).toBe(true);
    expect(r2.revision?.reason).toBe("already-challenged-today");
    // Contrary support never lifts the belief.
    expect(s.row(b)?.uses).toBe(0);
    expect(r1.revision?.verdict).toBe("hold");
    // A second lived day of it: the pressure, decayed a little, plus today's force, past iota x strength.
    const no3 = lived(s, "Wren slept through the early ferry and took the noon one, happier.", 3, { salience: { claimed: 0.4 } });
    const r3 = schemas.fileSupport({ beliefId: b, memoryId: no3, stance: "contrary", day: 3 });
    expect(r3.revision?.verdict).toBe("revise");
    const successor = r3.revision?.successorId as string;
    expect(s.row(b)?.superseded_by).toBe(successor);
    // The revised belief is a belief still, born weak again by correction. The
    // support stays on the belief that lost: the successor starts with none.
    expect(s.row(successor)?.birth_route).toBe("correction");
    expect(sal(s.physicsOf(successor).salience)).toBeLessThanOrEqual(PHYSICS.BELIEF_BIRTH_CEILING + 1e-9);
    expect(s.supportOf(b)).toHaveLength(3);
    expect(s.supportOf(successor)).toEqual([]);
    expect(s.row(successor)?.uses).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("invisible until lanes E and F", () => {
  function brain(): Counterpart {
    const c = Counterpart.open({ dir: join(dir, "store"), now: () => NOW });
    opened.push(c);
    return c;
  }

  test("a belief is never a turn's candidate, footnote or facts-mode result, while a memory in near the same words and salience is", async () => {
    const clock = { now: Date.UTC(2026, 4, 20, 9) };
    const c = Counterpart.open({ dir: join(dir, "store"), now: () => clock.now });
    opened.push(c);
    c.store.advanceClock("2026-05-20");
    for (let i = 0; i < 30; i += 1) c.store.put({ type: "memory", kind: "fact", body: `Filler note ${String(i)} about gardening and tools.`, salience: { claimed: 0.5 } });
    const words = "Wren adores the lighthouse ferry crossing at dawn.";
    const control = c.store.put({ type: "memory", kind: "fact", body: words, salience: { claimed: 0.5 } });
    // A belief row as strong as the control, written straight to the store (not the same words, or the
    // night's dedup would merge them): only the role keeps it out.
    const belief = c.store.put({ type: "schema", kind: "fact", body: `I believe it: ${words}`, salience: { claimed: 0.5 }, meta: { role: "belief", entityId: "x" }, birthRoute: "reflection" });
    await c.sessionEnd({ date: "2026-05-20", budgetBytes: 9000, session: "s-0520" });
    clock.now += 24 * 60 * 60_000;
    c.store.advanceClock("2026-05-21");
    const turn = c.recallForTurn({ sessionId: SESSION, text: "the lighthouse ferry crossing at dawn" });
    const seen = [...turn.decision.surfaced, ...turn.decision.footnotes];
    expect(seen).toContain(control);
    expect(seen).not.toContain(belief);
    const facts = factsRecall({ counterpart: c, sessionId: SESSION, vector: null, semantic: "embedder-off" }, "lighthouse ferry crossing");
    expect(facts.memories.map((m) => m.id)).toContain(control);
    expect(facts.memories.map((m) => m.id)).not.toContain(belief);
  });

  test("a belief about us on a person card (a core kind) never crosses into the core; the cycle says why", async () => {
    const c = brain();
    const wren = c.schemas.mention({ name: "Wren", kind: "person", source: "Wren", chunkRef: "t", day: 1 }).id as string;
    const belief = c.schemas.addBelief({ entityId: wren, statement: "Wren and I work best at dawn.", day: 1, birthRoute: "reflection", about: "us" }).id as string;
    expect(c.store.row(belief)?.kind).toBe("person");
    const report = await c.sessionEnd({ date: "2026-03-02" });
    const consolidate = phaseReport(report.cycle, "consolidate");
    expect(consolidate.skipped["promotion:a-belief"]).toBeGreaterThanOrEqual(1);
    expect(c.store.row(belief)?.promoted_identity).toBe(0);
  });
});
